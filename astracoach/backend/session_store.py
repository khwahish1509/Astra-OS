"""
Session Store — Hybrid Firestore / In-Memory
=============================================
Holds state for each active agent session AND cross-session user profiles.

Backend selection (auto, based on env var):
  FIRESTORE_PROJECT_ID set  → FirestoreSessionStore
    • Persists to Google Cloud Firestore
    • Safe across Cloud Run scale-to-zero / container restarts
    • Hybrid: in-process cache for the hot path, Firestore for durability

  FIRESTORE_PROJECT_ID absent → InMemorySessionStore
    • Pure in-memory dict, zero extra dependencies
    • Good for local dev and testing

Public interface (identical for both backends):
  store.create(session_id, persona_name, system_prompt, voice, user_name)
  store.get(session_id) → AgentSession | None
  store.add_transcript(session_id, role, text)
  store.add_memory(session_id, key, value)
  store.update_vision(session_id, note)
  store.get_vision(session_id, max_age) → str
  store.delete(session_id)
  store.active_count() → int

  # ── Long-Term Memory (cross-session user profiles) ──────────────
  store.get_user_profile(user_id) → UserProfile | None
  store.save_user_profile(profile: UserProfile)

Module-level helper (call as background task):
  await summarize_and_persist(session_id, user_id, api_key, store)

Usage:
  from session_store import SessionStore, summarize_and_persist
  store = SessionStore()   # auto-selects backend
"""

import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Optional


# ──────────────────────────────────────────────────────────────────────────────
# Noise-detection helper
# ──────────────────────────────────────────────────────────────────────────────

# Gemini's VAD / input-transcription emits tokens like "<noise>", "(noise)",
# "[noise]", or bare "noise" when it hears background sound with no speech.
# These entries are useless for summarization and inflate the transcript count.
_NOISE_RE = re.compile(
    r"^[\[\(<]?\s*noise\s*[\]\)>]?$",
    re.IGNORECASE,
)

def _is_noise(text: str) -> bool:
    """Return True if a transcript entry is purely a noise marker (no real speech)."""
    return bool(_NOISE_RE.match(text.strip()))


# ──────────────────────────────────────────────────────────────────────────────
# Session dataclass (shared by both backends)
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class AgentSession:
    session_id: str

    # ── Persona ───────────────────────────────────────────────────────────────
    persona_name:  str    # display name e.g. "Interview Coach", "Spanish Tutor"
    system_prompt: str    # the FULL agent system prompt written by the user
    voice:         str    # Gemini voice name
    user_name:     str    # optional — for personalised responses

    # ── Runtime state ─────────────────────────────────────────────────────────
    created_at:    float = field(default_factory=time.time)
    transcript:    list  = field(default_factory=list)   # [{role, text, ts}]
    memories:      dict  = field(default_factory=dict)   # key→value from remember_context
    latest_vision: str   = ""
    vision_ts:     float = 0.0
    is_active:     bool  = True


# ──────────────────────────────────────────────────────────────────────────────
# UserProfile dataclass — cross-session memory (persists BETWEEN sessions)
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class UserProfile:
    """
    Stores the distilled knowledge about a user across ALL their sessions.

    Written by: summarize_and_persist() (background task at session end)
    Read by:    GeminiLiveBridge.run() (injected into system prompt at session start)
    """
    user_id: str

    sessions_count:  int   = 0
    last_updated:    float = 0.0
    strengths:       list  = field(default_factory=list)   # ["strength 1", ...]
    weaknesses:      list  = field(default_factory=list)   # ["weakness 1", ...]
    topics_covered:  list  = field(default_factory=list)   # deduplicated topic history
    overall_summary: str   = ""   # 1-2 sentence Gemini-generated summary

    def to_recall_prompt(self) -> str:
        """
        Format as a contextual recall block for VoiceAgent system prompt injection.

        Returns an empty string if there is no useful data yet (e.g. first session).
        """
        if not self.weaknesses and not self.strengths and not self.overall_summary:
            return ""

        parts = [
            "\n─── Contextual Memory: User's Past Performance ───────────────",
            f"(From {self.sessions_count} previous session(s). "
            "Use this to personalise coaching without being robotic about it.)",
        ]

        if self.weaknesses:
            w_str = "; ".join(self.weaknesses[:4])
            parts.append(
                f"Areas needing improvement: {w_str}\n"
                "→ Proactively revisit these topics to measure their improvement. "
                "If the user demonstrates growth, celebrate it explicitly."
            )

        if self.strengths:
            s_str = "; ".join(self.strengths[:4])
            parts.append(
                f"Known strengths: {s_str}\n"
                "→ Build on these to keep the user motivated and confident."
            )

        if self.topics_covered:
            t_str = ", ".join(self.topics_covered[-8:])
            parts.append(f"Topics covered in past sessions: {t_str}")

        if self.overall_summary:
            parts.append(f"Overall profile: {self.overall_summary}")

        parts.append("──────────────────────────────────────────────────────────")
        return "\n".join(parts)


# ──────────────────────────────────────────────────────────────────────────────
# Post-session summarization (module-level async helper)
# ──────────────────────────────────────────────────────────────────────────────

async def summarize_and_persist(
    session_id: str,
    user_id: str,
    api_key: str,
    store,
    session=None,   # Pass the session object directly to avoid store-deletion race condition.
                    # If None, falls back to store.get(session_id).
) -> None:
    """
    Background task: summarize the completed session transcript using Gemini Flash,
    then merge the results into the user's cross-session UserProfile in the store.

    Call this as a fire-and-forget asyncio task on session end:
        asyncio.create_task(summarize_and_persist(
            session_id, user_id, api_key, store, session=self.session
        ))

    IMPORTANT: Always pass session= directly from the bridge (self.session).
    Do NOT rely on store.get() — the session may already be deleted from the
    store by the time this background task runs.

    Requirements:
        • session_id: used for logging only when session= is provided
        • user_id:    normalised user identifier (e.g. user_name.lower().replace(" ", "_"))
        • api_key:    Google API key (same one used for Gemini Live)
        • store:      InMemorySessionStore or FirestoreSessionStore instance
        • session:    AgentSession object (pass directly to avoid race condition)
    """
    # Use the passed session object directly — avoids race condition where
    # store.delete(session_id) has already been called before this task runs.
    if session is None:
        session = store.get(session_id)
    if not session:
        print(f"[Memory] Skipping summarization: session {session_id} not found in store")
        return

    # ── Filter noise-only entries (e.g. Gemini VAD emits "<noise>" tokens) ──
    real_entries = [
        e for e in session.transcript
        if e.get("text") and not _is_noise(e["text"])
    ]

    print(f"[Memory] Session {session_id}: {len(session.transcript)} total transcript entries, "
          f"{len(real_entries)} real (non-noise) entries for user '{user_id}'")

    if len(real_entries) < 2:
        print(f"[Memory] Skipping summarization: only {len(real_entries)} real transcript entries "
              f"(need ≥2) for session {session_id}")
        return

    # ── Format transcript for the LLM ──────────────────────────────────────
    MAX_TURNS = 80   # limit context window usage
    lines = []
    for entry in real_entries[-MAX_TURNS:]:
        label = "User" if entry.get("role") == "user" else "Coach"
        lines.append(f"{label}: {entry.get('text', '').strip()}")
    transcript_text = "\n".join(lines)

    prompt = f"""You are analyzing a coaching/tutoring session to extract a structured performance summary.

Persona: {session.persona_name}

Transcript:
{transcript_text}

Extract a JSON object with EXACTLY these fields:
{{
  "strengths": ["specific strength 1", "specific strength 2"],
  "weaknesses": ["specific area for improvement 1", "specific area for improvement 2"],
  "topics_covered": ["topic 1", "topic 2", "topic 3"],
  "overall_summary": "1-2 sentence summary of the user's performance and the most important takeaway"
}}

Rules:
- strengths: 2-4 SPECIFIC things the user demonstrated well (not generic praise)
- weaknesses: 2-4 SPECIFIC, CONCRETE areas to improve (name the actual skill/topic)
- topics_covered: list of subjects/skills discussed in the session
- overall_summary: concise, actionable, written in third person
- Return ONLY valid JSON — no markdown fences, no extra text"""

    import google.genai as genai

    client = genai.Client(api_key=api_key)

    # ── Model fallback chain ────────────────────────────────────────────────
    # gemini-2.0-flash is preferred (fast + cheap), but falls back to
    # gemini-1.5-flash if the free-tier quota is exhausted on the first model.
    SUMMARIZE_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"]
    MAX_RETRIES = 2    # attempts per model before giving up on that model
    RETRY_CAP   = 65   # max seconds to wait between retries

    raw_text = ""
    data = None

    for model_name in SUMMARIZE_MODELS:
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                print(f"[Memory] Calling {model_name} (attempt {attempt}/{MAX_RETRIES}) "
                      f"for session {session_id}")
                response = await asyncio.to_thread(
                    client.models.generate_content,
                    model=model_name,
                    contents=prompt,
                )
                raw_text = (response.text or "").strip()
                # Strip markdown code fences if model included them
                raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
                raw_text = re.sub(r"\s*```$", "", raw_text).strip()
                data = json.loads(raw_text)
                break   # ← success, exit retry loop

            except json.JSONDecodeError as e:
                print(f"[Memory] ❌ JSON parse failed ({model_name} attempt {attempt}): "
                      f"{e} | raw: {raw_text[:200]!r}")
                break   # JSON error won't be fixed by retrying same model

            except Exception as e:
                err_str = str(e)
                is_rate_limit = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str

                if is_rate_limit and attempt < MAX_RETRIES:
                    # Extract suggested retry delay from error details if present
                    delay_match = re.search(r"retry[^\d]*(\d+)", err_str, re.IGNORECASE)
                    wait_secs = min(int(delay_match.group(1)) + 5, RETRY_CAP) if delay_match else 65
                    print(f"[Memory] ⏳ Rate-limited on {model_name} — "
                          f"waiting {wait_secs}s then retrying...")
                    await asyncio.sleep(wait_secs)
                    continue   # retry same model after backoff

                elif is_rate_limit:
                    # Exhausted retries on this model — try the next one
                    print(f"[Memory] ⚠️  {model_name} quota exhausted after {attempt} attempt(s). "
                          f"Trying next model...")
                    break

                else:
                    # Non-rate-limit error — no point retrying
                    print(f"[Memory] ❌ Summarization failed ({model_name}): {e}")
                    break

        if data is not None:
            break   # got a result — no need to try remaining models

    if data is None:
        print(f"[Memory] ❌ All summarization models failed for session {session_id}. "
              f"Profile NOT updated.")
        return

    # ── Merge into existing UserProfile ────────────────────────────────────
    try:
        profile = store.get_user_profile(user_id) or UserProfile(user_id=user_id)
        profile.sessions_count += 1
        profile.last_updated    = time.time()

        # Overwrite with latest session results (most recent assessment is most relevant)
        profile.strengths       = data.get("strengths", [])[:6]
        profile.weaknesses      = data.get("weaknesses", [])[:6]
        profile.overall_summary = data.get("overall_summary", "")

        # Accumulate unique topics across all sessions (keep last 20)
        new_topics = data.get("topics_covered", [])
        all_topics = list(dict.fromkeys(profile.topics_covered + new_topics))
        profile.topics_covered = all_topics[-20:]

        store.save_user_profile(profile)

        print(
            f"[Memory] ✅ Session {session_id} summarized → "
            f"user '{user_id}' | "
            f"strengths={len(profile.strengths)} | "
            f"weaknesses={len(profile.weaknesses)} | "
            f"topics={len(profile.topics_covered)} total"
        )

    except Exception as e:
        print(f"[Memory] ❌ Failed to save UserProfile for '{user_id}': {e}")


# ──────────────────────────────────────────────────────────────────────────────
# In-memory backend (local dev / testing)
# ──────────────────────────────────────────────────────────────────────────────

class InMemorySessionStore:
    """Pure in-memory session store. Resets on process restart."""

    def __init__(self):
        self._store: dict[str, AgentSession] = {}
        self._profiles: dict[str, UserProfile] = {}
        print("[SessionStore] ⚡ In-memory store active (set FIRESTORE_PROJECT_ID for persistence)")

    def create(
        self,
        session_id: str,
        persona_name: str,
        system_prompt: str,
        voice: str = "Aoede",
        user_name: str = "",
    ) -> AgentSession:
        s = AgentSession(
            session_id=session_id,
            persona_name=persona_name,
            system_prompt=system_prompt,
            voice=voice,
            user_name=user_name,
        )
        self._store[session_id] = s
        return s

    def get(self, session_id: str) -> Optional[AgentSession]:
        return self._store.get(session_id)

    def add_transcript(self, session_id: str, role: str, text: str):
        s = self._store.get(session_id)
        cleaned = text.strip()
        if s and cleaned and not _is_noise(cleaned):
            s.transcript.append({"role": role, "text": cleaned, "ts": time.time()})

    def add_memory(self, session_id: str, key: str, value: str):
        s = self._store.get(session_id)
        if s:
            s.memories[key] = value

    def update_vision(self, session_id: str, note: str):
        s = self._store.get(session_id)
        if s:
            s.latest_vision = note
            s.vision_ts = time.time()

    def get_vision(self, session_id: str, max_age: float = 8.0) -> str:
        s = self._store.get(session_id)
        if not s or not s.latest_vision:
            return ""
        if time.time() - s.vision_ts > max_age:
            return ""
        return s.latest_vision

    def delete(self, session_id: str):
        self._store.pop(session_id, None)

    def active_count(self) -> int:
        return sum(1 for s in self._store.values() if s.is_active)

    # ── Long-Term Memory (UserProfile) ────────────────────────────────────────

    def get_user_profile(self, user_id: str) -> Optional[UserProfile]:
        return self._profiles.get(user_id)

    def save_user_profile(self, profile: UserProfile) -> None:
        self._profiles[profile.user_id] = profile
        print(f"[SessionStore] UserProfile saved in-memory for '{profile.user_id}'")


# ──────────────────────────────────────────────────────────────────────────────
# Firestore backend (Cloud Run production)
# ──────────────────────────────────────────────────────────────────────────────

class FirestoreSessionStore:
    """
    Persists sessions to Google Cloud Firestore.

    Collections:
      astra_sessions/{session_id}           — per-session data
      astra_user_profiles/{user_id}         — cross-session user profiles

    Cache:       In-process dict for hot-path reads (avoids Firestore RTT on
                 every audio packet). Firestore is the source of truth and
                 survives container restarts / scale-to-zero.

    Memories are stored as a flat map inside the session doc:
      { memories: { key: value, ... } }

    Transcript is stored as a Firestore array (last ~100 entries):
      { transcript: [{role, text, ts}, ...] }
    """

    COLLECTION         = "astra_sessions"
    PROFILES_COLLECTION = "astra_user_profiles"

    def __init__(self, project_id: str):
        from google.cloud import firestore
        self._db    = firestore.Client(project=project_id)
        self._cache: dict[str, AgentSession] = {}
        self._profile_cache: dict[str, UserProfile] = {}
        print(f"[SessionStore] 🔥 Firestore backend active (project={project_id})")

    def _ref(self, session_id: str):
        return self._db.collection(self.COLLECTION).document(session_id)

    def _profile_ref(self, user_id: str):
        return self._db.collection(self.PROFILES_COLLECTION).document(user_id)

    def create(
        self,
        session_id: str,
        persona_name: str,
        system_prompt: str,
        voice: str = "Aoede",
        user_name: str = "",
    ) -> AgentSession:
        s = AgentSession(
            session_id=session_id,
            persona_name=persona_name,
            system_prompt=system_prompt,
            voice=voice,
            user_name=user_name,
        )
        self._cache[session_id] = s

        # Write initial document to Firestore (best-effort, non-blocking)
        try:
            self._ref(session_id).set({
                "session_id":    session_id,
                "persona_name":  persona_name,
                "system_prompt": system_prompt,
                "voice":         voice,
                "user_name":     user_name,
                "created_at":    s.created_at,
                "is_active":     True,
                "transcript":    [],
                "memories":      {},
                "latest_vision": "",
                "vision_ts":     0.0,
            })
            print(f"[SessionStore] Firestore session created: {session_id}")
        except Exception as e:
            print(f"[SessionStore] Firestore create warning: {e}")

        return s

    def get(self, session_id: str) -> Optional[AgentSession]:
        # Hot path: serve from in-process cache
        if session_id in self._cache:
            return self._cache[session_id]

        # Cold load: read from Firestore (e.g. after container restart)
        try:
            doc = self._ref(session_id).get()
            if not doc.exists:
                return None
            d = doc.to_dict()
            s = AgentSession(
                session_id=d["session_id"],
                persona_name=d.get("persona_name", ""),
                system_prompt=d.get("system_prompt", ""),
                voice=d.get("voice", "Aoede"),
                user_name=d.get("user_name", ""),
                created_at=d.get("created_at", time.time()),
                transcript=d.get("transcript", []),
                memories=d.get("memories", {}),
                latest_vision=d.get("latest_vision", ""),
                vision_ts=d.get("vision_ts", 0.0),
                is_active=d.get("is_active", True),
            )
            self._cache[session_id] = s
            print(f"[SessionStore] Firestore cold-loaded session: {session_id}")
            return s
        except Exception as e:
            print(f"[SessionStore] Firestore get error: {e}")
            return None

    def add_transcript(self, session_id: str, role: str, text: str):
        s = self._cache.get(session_id)
        cleaned = text.strip()
        if not s or not cleaned or _is_noise(cleaned):
            return
        entry = {"role": role, "text": cleaned, "ts": time.time()}
        s.transcript.append(entry)

        # Persist to Firestore (array union — appends without overwriting)
        try:
            from google.cloud import firestore as _fs
            self._ref(session_id).update({"transcript": _fs.ArrayUnion([entry])})
        except Exception as e:
            print(f"[SessionStore] Firestore transcript error: {e}")

    def add_memory(self, session_id: str, key: str, value: str):
        s = self._cache.get(session_id)
        if not s:
            return
        s.memories[key] = value

        # Persist using dot-notation field path to avoid overwriting other memories
        try:
            self._ref(session_id).update({f"memories.{key}": value})
        except Exception as e:
            print(f"[SessionStore] Firestore memory error: {e}")

    def update_vision(self, session_id: str, note: str):
        s = self._cache.get(session_id)
        if s:
            s.latest_vision = note
            s.vision_ts = time.time()
        # Vision is ephemeral; don't persist to Firestore (high-write, low-value)

    def get_vision(self, session_id: str, max_age: float = 8.0) -> str:
        s = self._cache.get(session_id)
        if not s or not s.latest_vision:
            return ""
        if time.time() - s.vision_ts > max_age:
            return ""
        return s.latest_vision

    def delete(self, session_id: str):
        self._cache.pop(session_id, None)
        try:
            # Mark inactive rather than hard delete (preserve transcript)
            self._ref(session_id).update({"is_active": False})
        except Exception as e:
            print(f"[SessionStore] Firestore delete warning: {e}")

    def active_count(self) -> int:
        return sum(1 for s in self._cache.values() if s.is_active)

    # ── Long-Term Memory (UserProfile) ────────────────────────────────────────

    def get_user_profile(self, user_id: str) -> Optional[UserProfile]:
        # Hot path: serve from in-process cache
        if user_id in self._profile_cache:
            return self._profile_cache[user_id]

        # Cold load from Firestore
        try:
            doc = self._profile_ref(user_id).get()
            if not doc.exists:
                return None
            d = doc.to_dict()
            profile = UserProfile(
                user_id=d.get("user_id", user_id),
                sessions_count=d.get("sessions_count", 0),
                last_updated=d.get("last_updated", 0.0),
                strengths=d.get("strengths", []),
                weaknesses=d.get("weaknesses", []),
                topics_covered=d.get("topics_covered", []),
                overall_summary=d.get("overall_summary", ""),
            )
            self._profile_cache[user_id] = profile
            print(f"[SessionStore] UserProfile cold-loaded for '{user_id}' "
                  f"({profile.sessions_count} sessions)")
            return profile
        except Exception as e:
            print(f"[SessionStore] Firestore get_user_profile error: {e}")
            return None

    def save_user_profile(self, profile: UserProfile) -> None:
        """Persist UserProfile to both in-process cache and Firestore."""
        self._profile_cache[profile.user_id] = profile
        try:
            self._profile_ref(profile.user_id).set({
                "user_id":        profile.user_id,
                "sessions_count": profile.sessions_count,
                "last_updated":   profile.last_updated,
                "strengths":      profile.strengths,
                "weaknesses":     profile.weaknesses,
                "topics_covered": profile.topics_covered,
                "overall_summary": profile.overall_summary,
            })
            print(f"[SessionStore] ✅ UserProfile persisted to Firestore for '{profile.user_id}'")
        except Exception as e:
            print(f"[SessionStore] Firestore save_user_profile error: {e}")


# ──────────────────────────────────────────────────────────────────────────────
# Factory — auto-selects backend from environment
# ──────────────────────────────────────────────────────────────────────────────

def SessionStore():
    """
    Returns a FirestoreSessionStore if FIRESTORE_PROJECT_ID env var is set,
    otherwise returns an InMemorySessionStore.

    Example .env:
      FIRESTORE_PROJECT_ID=my-gcp-project-id
    """
    project_id = os.getenv("FIRESTORE_PROJECT_ID", "").strip()
    if project_id:
        try:
            return FirestoreSessionStore(project_id)
        except Exception as e:
            print(f"[SessionStore] Firestore init failed ({e}), falling back to in-memory")
    return InMemorySessionStore()
