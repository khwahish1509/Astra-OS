"""
Session Store — Hybrid Firestore / In-Memory
=============================================
Holds state for each active agent session.

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

Usage:
  from session_store import SessionStore
  store = SessionStore()   # auto-selects backend
"""

import os
import time
from dataclasses import dataclass, field
from typing import Optional


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
# In-memory backend (local dev / testing)
# ──────────────────────────────────────────────────────────────────────────────

class InMemorySessionStore:
    """Pure in-memory session store. Resets on process restart."""

    def __init__(self):
        self._store: dict[str, AgentSession] = {}
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
        if s and text.strip():
            s.transcript.append({"role": role, "text": text.strip(), "ts": time.time()})

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


# ──────────────────────────────────────────────────────────────────────────────
# Firestore backend (Cloud Run production)
# ──────────────────────────────────────────────────────────────────────────────

class FirestoreSessionStore:
    """
    Persists sessions to Google Cloud Firestore.

    Collection:  astra_sessions/{session_id}
    Fields:      All AgentSession fields are mirrored.
    Cache:       In-process dict for hot-path reads (avoids Firestore RTT on
                 every audio packet). Firestore is the source of truth and
                 survives container restarts / scale-to-zero.

    Memories are stored as a flat map inside the session doc:
      { memories: { key: value, ... } }

    Transcript is stored as a Firestore array (last ~100 entries):
      { transcript: [{role, text, ts}, ...] }
    """

    COLLECTION = "astra_sessions"

    def __init__(self, project_id: str):
        from google.cloud import firestore
        self._db    = firestore.AsyncClient(project=project_id) if False else firestore.Client(project=project_id)
        self._cache: dict[str, AgentSession] = {}
        print(f"[SessionStore] 🔥 Firestore backend active (project={project_id})")

    def _ref(self, session_id: str):
        return self._db.collection(self.COLLECTION).document(session_id)

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
        if not s or not text.strip():
            return
        entry = {"role": role, "text": text.strip(), "ts": time.time()}
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
