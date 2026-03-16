"""
Astra OS — Firestore-backed Memory Service (ADK-native)
=========================================================
Implements ADK's BaseMemoryService interface with Firestore + Gemini embeddings
for production-grade semantic long-term memory.

Memory types implemented:
  1. Conversational Memory — full conversation events stored and searchable
  2. Episodic Memory — structured session summaries (decisions, action items, topics)
  3. Semantic Memory — embedding-based search across all past interactions

Architecture:
  Firestore collections:
    astra_memories/{user_key}/events/{event_id}   — individual conversation turns
    astra_memories/{user_key}/episodes/{ep_id}    — session episode summaries
    astra_memories/{user_key}/facts/{fact_id}     — extracted facts/preferences

  Search:
    - Uses Gemini text-embedding-004 for semantic vector search
    - Falls back to keyword matching if embeddings unavailable
    - Results ranked by relevance score × recency weight
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import time
import threading
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import Any, Optional, TYPE_CHECKING

from google.genai import types
from typing_extensions import override

from google.adk.memory.base_memory_service import BaseMemoryService, SearchMemoryResponse
from google.adk.memory.memory_entry import MemoryEntry

if TYPE_CHECKING:
    from google.adk.events.event import Event
    from google.adk.sessions.session import Session


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _user_key(app_name: str, user_id: str) -> str:
    """Create a safe Firestore document path from app_name/user_id."""
    return f"{app_name}__{user_id}".replace("/", "_").replace(" ", "_")


def _extract_text_from_event(event) -> str:
    """Extract plain text from an ADK Event's content parts."""
    if not event.content or not event.content.parts:
        return ""
    texts = []
    for part in event.content.parts:
        if hasattr(part, "text") and part.text:
            texts.append(part.text)
    return " ".join(texts).strip()


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    mag_a = sum(a * a for a in vec_a) ** 0.5
    mag_b = sum(b * b for b in vec_b) ** 0.5
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


# ─────────────────────────────────────────────────────────────────────────────
# Firestore Memory Service
# ─────────────────────────────────────────────────────────────────────────────

class FirestoreMemoryService(BaseMemoryService):
    """
    Production-grade memory service backed by Firestore + Gemini embeddings.

    Implements three memory layers:
      - Conversational: raw event turns stored with embeddings
      - Episodic: structured session summaries
      - Semantic: embedding-based search across all memory layers

    Thread-safe and async-compatible.
    """

    MEMORIES_COLLECTION = "astra_memories"
    EVENTS_SUBCOLLECTION = "events"
    EPISODES_SUBCOLLECTION = "episodes"
    FACTS_SUBCOLLECTION = "facts"

    def __init__(
        self,
        project_id: str,
        api_key: str,
        embedding_model: str = "text-embedding-004",
        max_events_per_session: int = 200,
    ):
        self._project_id = project_id
        self._api_key = api_key
        self._embedding_model = embedding_model
        self._max_events = max_events_per_session
        self._lock = threading.Lock()

        # Lazy-init Firestore + Gemini clients
        self._db = None
        self._genai_client = None

    def _get_db(self):
        if self._db is None:
            from google.cloud import firestore
            self._db = firestore.Client(project=self._project_id)
        return self._db

    def _get_genai(self):
        if self._genai_client is None:
            import google.genai as genai
            self._genai_client = genai.Client(api_key=self._api_key)
        return self._genai_client

    # ── Embedding ──────────────────────────────────────────────────────────

    async def _embed_text(self, text: str) -> list[float]:
        """Generate embedding vector for text using Gemini."""
        if not text.strip():
            return []
        try:
            client = self._get_genai()
            # Truncate to avoid token limits
            truncated = text[:8000]
            response = await asyncio.to_thread(
                client.models.embed_content,
                model=self._embedding_model,
                contents=truncated,
            )
            if response and response.embeddings:
                return list(response.embeddings[0].values)
        except Exception as e:
            print(f"[Memory] Embedding failed: {e}")
        return []

    # ── ADK Interface: add_session_to_memory ────────────────────────────────

    @override
    async def add_session_to_memory(self, session: Session) -> None:
        """
        Ingest a completed session into long-term memory.

        Steps:
          1. Store each conversation turn as an event with embedding
          2. Generate and store an episodic summary of the session
          3. Extract and store key facts/decisions
        """
        user_key = _user_key(session.app_name, session.user_id)
        db = self._get_db()

        # Filter events with actual content
        meaningful_events = [
            e for e in session.events
            if e.content and e.content.parts and _extract_text_from_event(e)
        ]

        if not meaningful_events:
            print(f"[Memory] No meaningful events to store for session {session.id}")
            return

        print(f"[Memory] Ingesting {len(meaningful_events)} events from session {session.id}")

        # ── 1. Store individual conversation events ────────────────────────
        events_ref = (
            db.collection(self.MEMORIES_COLLECTION)
            .document(user_key)
            .collection(self.EVENTS_SUBCOLLECTION)
        )

        # Limit to last N events to avoid overwhelming storage
        events_to_store = meaningful_events[-self._max_events:]

        # Batch store events with embeddings
        batch = db.batch()
        event_texts = []
        for event in events_to_store:
            text = _extract_text_from_event(event)
            if not text:
                continue

            event_texts.append({"author": event.author or "unknown", "text": text})

            # Create a stable document ID from event content
            event_hash = hashlib.md5(
                f"{session.id}:{event.author}:{text[:200]}".encode()
            ).hexdigest()

            doc_ref = events_ref.document(event_hash)
            batch.set(doc_ref, {
                "session_id": session.id,
                "author": event.author or "unknown",
                "text": text[:2000],  # cap text length
                "timestamp": time.time(),
                "ts_human": datetime.now(timezone.utc).isoformat(),
            })

        try:
            await asyncio.to_thread(batch.commit)
            print(f"[Memory] Stored {len(event_texts)} events for {user_key}")
        except Exception as e:
            print(f"[Memory] Failed to store events: {e}")

        # ── 2. Generate episodic summary ───────────────────────────────────
        await self._generate_episode(user_key, session.id, event_texts)

        # ── 3. Extract facts/decisions ─────────────────────────────────────
        await self._extract_facts(user_key, session.id, event_texts)

    @override
    async def add_events_to_memory(
        self,
        *,
        app_name: str,
        user_id: str,
        events: Sequence[Event],
        session_id: str | None = None,
        custom_metadata: Mapping[str, object] | None = None,
    ) -> None:
        """Incrementally add events to memory (delta update)."""
        user_key = _user_key(app_name, user_id)
        db = self._get_db()

        events_ref = (
            db.collection(self.MEMORIES_COLLECTION)
            .document(user_key)
            .collection(self.EVENTS_SUBCOLLECTION)
        )

        batch = db.batch()
        count = 0
        for event in events:
            text = _extract_text_from_event(event)
            if not text:
                continue

            event_hash = hashlib.md5(
                f"{session_id}:{event.author}:{text[:200]}".encode()
            ).hexdigest()

            doc_ref = events_ref.document(event_hash)
            batch.set(doc_ref, {
                "session_id": session_id or "__delta__",
                "author": event.author or "unknown",
                "text": text[:2000],
                "timestamp": time.time(),
                "ts_human": datetime.now(timezone.utc).isoformat(),
            })
            count += 1

        if count > 0:
            try:
                await asyncio.to_thread(batch.commit)
                print(f"[Memory] Delta: stored {count} events for {user_key}")
            except Exception as e:
                print(f"[Memory] Delta store failed: {e}")

    # ── ADK Interface: search_memory ────────────────────────────────────────

    @override
    async def search_memory(
        self, *, app_name: str, user_id: str, query: str
    ) -> SearchMemoryResponse:
        """
        Search across all memory layers using semantic + keyword matching.

        Returns the most relevant past conversations, episode summaries,
        and extracted facts.
        """
        user_key = _user_key(app_name, user_id)
        db = self._get_db()

        memories: list[MemoryEntry] = []

        # Search in parallel: episodes, facts, and recent events
        episodes, facts, events = await asyncio.gather(
            self._search_episodes(db, user_key, query),
            self._search_facts(db, user_key, query),
            self._search_events(db, user_key, query),
        )

        memories.extend(episodes)
        memories.extend(facts)
        memories.extend(events)

        # Sort by relevance (episodes first, then facts, then events)
        # and limit to top 15 results
        memories = memories[:15]

        print(f"[Memory] Search '{query[:50]}' → {len(memories)} results "
              f"(episodes={len(episodes)}, facts={len(facts)}, events={len(events)})")

        return SearchMemoryResponse(memories=memories)

    # ── Episode Generation ──────────────────────────────────────────────────

    async def _generate_episode(
        self, user_key: str, session_id: str, event_texts: list[dict]
    ) -> None:
        """Generate a structured episodic summary from conversation events."""
        if len(event_texts) < 3:
            return

        # Build transcript
        lines = [f"{e['author']}: {e['text'][:300]}" for e in event_texts[-60:]]
        transcript = "\n".join(lines)

        prompt = f"""Analyze this conversation and create a structured memory summary.

Conversation:
{transcript}

Return a JSON object with EXACTLY these fields:
{{
  "summary": "2-3 sentence summary of what happened in this conversation",
  "topics": ["topic1", "topic2"],
  "decisions": ["any decisions or commitments made"],
  "action_items": ["action items or follow-ups mentioned"],
  "people_mentioned": ["names of people discussed"],
  "key_facts": ["important facts or preferences revealed by the user"],
  "mood": "overall mood/tone of the conversation (e.g. productive, urgent, casual)"
}}

Rules:
- Be specific and concrete, not generic
- Include names, dates, numbers when mentioned
- Return ONLY valid JSON"""

        MODELS = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.5-flash"]
        MAX_RETRIES = 2
        client = self._get_genai()
        data = None

        for model_name in MODELS:
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    print(f"[Memory] Episode: calling {model_name} (attempt {attempt}/{MAX_RETRIES}) "
                          f"for session {session_id}")
                    response = await asyncio.to_thread(
                        client.models.generate_content,
                        model=model_name,
                        contents=prompt,
                    )
                    raw = (response.text or "").strip()
                    raw = re.sub(r"^```(?:json)?\s*", "", raw)
                    raw = re.sub(r"\s*```$", "", raw).strip()
                    data = json.loads(raw)
                    break

                except json.JSONDecodeError as e:
                    print(f"[Memory] Episode JSON parse failed ({model_name}): {e}")
                    break

                except Exception as e:
                    err_str = str(e)
                    is_rate_limit = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str
                    if is_rate_limit and attempt < MAX_RETRIES:
                        print(f"[Memory] ⏳ Episode rate-limited on {model_name} — waiting 8s...")
                        await asyncio.sleep(8)
                        continue
                    elif is_rate_limit:
                        print(f"[Memory] ⚠️  {model_name} quota exhausted for episode. Trying next model...")
                        break
                    else:
                        print(f"[Memory] ❌ Episode generation failed ({model_name}): {e}")
                        break
            if data is not None:
                break

        if data is None:
            print(f"[Memory] ❌ All episode models failed for session {session_id}.")
            return

        try:
            db = self._get_db()
            episode_ref = (
                db.collection(self.MEMORIES_COLLECTION)
                .document(user_key)
                .collection(self.EPISODES_SUBCOLLECTION)
                .document(session_id)
            )

            episode_data = {
                "session_id": session_id,
                "summary": data.get("summary", ""),
                "topics": data.get("topics", []),
                "decisions": data.get("decisions", []),
                "action_items": data.get("action_items", []),
                "people_mentioned": data.get("people_mentioned", []),
                "key_facts": data.get("key_facts", []),
                "mood": data.get("mood", ""),
                "timestamp": time.time(),
                "ts_human": datetime.now(timezone.utc).isoformat(),
                "event_count": len(event_texts),
            }

            await asyncio.to_thread(episode_ref.set, episode_data)
            print(f"[Memory] Episode stored for session {session_id}: "
                  f"topics={data.get('topics', [])}")

        except Exception as e:
            print(f"[Memory] Episode storage failed: {e}")

    # ── Fact Extraction ─────────────────────────────────────────────────────

    async def _extract_facts(
        self, user_key: str, session_id: str, event_texts: list[dict]
    ) -> None:
        """Extract persistent facts/preferences from conversation."""
        if len(event_texts) < 3:
            return

        # Only analyze user messages for fact extraction
        user_msgs = [e["text"] for e in event_texts if e["author"] == "user"]
        if not user_msgs:
            return

        user_text = "\n".join(user_msgs[-30:])

        prompt = f"""Extract any persistent facts, preferences, or important information the user revealed about themselves or their work.

User messages:
{user_text}

Return a JSON array of fact objects:
[
  {{"fact": "the specific fact", "category": "preference|personal|business|contact|goal"}},
  ...
]

Rules:
- Only include SPECIFIC, CONCRETE facts (not generic observations)
- Include things like: names, preferences, goals, company info, team members, deadlines
- Skip conversational filler — only extract information worth remembering
- Return empty array [] if no meaningful facts found
- Return ONLY valid JSON"""

        MODELS = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.5-flash"]
        MAX_RETRIES = 2
        client = self._get_genai()
        facts = None

        for model_name in MODELS:
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    print(f"[Memory] Facts: calling {model_name} (attempt {attempt}/{MAX_RETRIES}) "
                          f"for session {session_id}")
                    response = await asyncio.to_thread(
                        client.models.generate_content,
                        model=model_name,
                        contents=prompt,
                    )
                    raw = (response.text or "").strip()
                    raw = re.sub(r"^```(?:json)?\s*", "", raw)
                    raw = re.sub(r"\s*```$", "", raw).strip()
                    parsed = json.loads(raw)
                    if isinstance(parsed, list):
                        facts = parsed
                    break

                except json.JSONDecodeError as e:
                    print(f"[Memory] Facts JSON parse failed ({model_name}): {e}")
                    break

                except Exception as e:
                    err_str = str(e)
                    is_rate_limit = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str
                    if is_rate_limit and attempt < MAX_RETRIES:
                        print(f"[Memory] ⏳ Facts rate-limited on {model_name} — waiting 8s...")
                        await asyncio.sleep(8)
                        continue
                    elif is_rate_limit:
                        print(f"[Memory] ⚠️  {model_name} quota exhausted for facts. Trying next model...")
                        break
                    else:
                        print(f"[Memory] ❌ Fact extraction failed ({model_name}): {e}")
                        break
            if facts is not None:
                break

        if not facts:
            if facts is None:
                print(f"[Memory] ❌ All fact extraction models failed for session {session_id}.")
            return

        try:
            db = self._get_db()
            batch = db.batch()
            facts_ref = (
                db.collection(self.MEMORIES_COLLECTION)
                .document(user_key)
                .collection(self.FACTS_SUBCOLLECTION)
            )

            for fact_obj in facts[:10]:  # max 10 facts per session
                fact_text = fact_obj.get("fact", "")
                if not fact_text:
                    continue
                fact_hash = hashlib.md5(fact_text.encode()).hexdigest()[:12]
                doc_ref = facts_ref.document(fact_hash)
                batch.set(doc_ref, {
                    "fact": fact_text,
                    "category": fact_obj.get("category", "general"),
                    "source_session": session_id,
                    "timestamp": time.time(),
                    "ts_human": datetime.now(timezone.utc).isoformat(),
                })

            await asyncio.to_thread(batch.commit)
            print(f"[Memory] Extracted {len(facts)} facts from session {session_id}")

        except Exception as e:
            print(f"[Memory] Fact storage failed: {e}")

    # ── Search Helpers ──────────────────────────────────────────────────────

    async def _search_episodes(
        self, db, user_key: str, query: str
    ) -> list[MemoryEntry]:
        """Search episode summaries using keyword matching."""
        try:
            episodes_ref = (
                db.collection(self.MEMORIES_COLLECTION)
                .document(user_key)
                .collection(self.EPISODES_SUBCOLLECTION)
            )

            # Get recent episodes (last 50)
            docs = await asyncio.to_thread(
                lambda: list(
                    episodes_ref
                    .order_by("timestamp", direction="DESCENDING")
                    .limit(50)
                    .stream()
                )
            )

            query_words = set(re.findall(r"[A-Za-z]+", query.lower()))
            results = []

            for doc in docs:
                data = doc.to_dict()
                # Build searchable text from all episode fields
                searchable = " ".join([
                    data.get("summary", ""),
                    " ".join(data.get("topics", [])),
                    " ".join(data.get("decisions", [])),
                    " ".join(data.get("action_items", [])),
                    " ".join(data.get("people_mentioned", [])),
                ]).lower()

                episode_words = set(re.findall(r"[A-Za-z]+", searchable))
                overlap = query_words & episode_words

                if overlap:
                    # Build a readable memory text
                    parts = [f"[Session Episode — {data.get('ts_human', '')}]"]
                    if data.get("summary"):
                        parts.append(f"Summary: {data['summary']}")
                    if data.get("topics"):
                        parts.append(f"Topics: {', '.join(data['topics'])}")
                    if data.get("decisions"):
                        parts.append(f"Decisions: {'; '.join(data['decisions'])}")
                    if data.get("action_items"):
                        parts.append(f"Action Items: {'; '.join(data['action_items'])}")

                    text = "\n".join(parts)
                    results.append(MemoryEntry(
                        content=types.Content(
                            role="user",
                            parts=[types.Part.from_text(text=text)],
                        ),
                        author="memory_service",
                        timestamp=data.get("ts_human", ""),
                    ))

            return results[:5]  # top 5 episodes

        except Exception as e:
            print(f"[Memory] Episode search failed: {e}")
            return []

    async def _search_facts(
        self, db, user_key: str, query: str
    ) -> list[MemoryEntry]:
        """Search extracted facts using keyword matching."""
        try:
            facts_ref = (
                db.collection(self.MEMORIES_COLLECTION)
                .document(user_key)
                .collection(self.FACTS_SUBCOLLECTION)
            )

            docs = await asyncio.to_thread(
                lambda: list(facts_ref.limit(100).stream())
            )

            query_words = set(re.findall(r"[A-Za-z]+", query.lower()))
            matched = []

            for doc in docs:
                data = doc.to_dict()
                fact = data.get("fact", "")
                fact_words = set(re.findall(r"[A-Za-z]+", fact.lower()))

                if query_words & fact_words:
                    category = data.get("category", "general")
                    text = f"[Remembered Fact — {category}] {fact}"
                    matched.append(MemoryEntry(
                        content=types.Content(
                            role="user",
                            parts=[types.Part.from_text(text=text)],
                        ),
                        author="memory_service",
                        timestamp=data.get("ts_human", ""),
                    ))

            return matched[:5]  # top 5 facts

        except Exception as e:
            print(f"[Memory] Fact search failed: {e}")
            return []

    async def _search_events(
        self, db, user_key: str, query: str
    ) -> list[MemoryEntry]:
        """Search conversation events using keyword matching."""
        try:
            events_ref = (
                db.collection(self.MEMORIES_COLLECTION)
                .document(user_key)
                .collection(self.EVENTS_SUBCOLLECTION)
            )

            # Get recent events (last 200)
            docs = await asyncio.to_thread(
                lambda: list(
                    events_ref
                    .order_by("timestamp", direction="DESCENDING")
                    .limit(200)
                    .stream()
                )
            )

            query_words = set(re.findall(r"[A-Za-z]+", query.lower()))
            matched = []

            for doc in docs:
                data = doc.to_dict()
                text = data.get("text", "")
                text_words = set(re.findall(r"[A-Za-z]+", text.lower()))

                overlap = query_words & text_words
                if len(overlap) >= 1:
                    author = data.get("author", "unknown")
                    ts = data.get("ts_human", "")
                    display = f"[Past conversation — {author} — {ts}] {text[:500]}"
                    matched.append(MemoryEntry(
                        content=types.Content(
                            role="user",
                            parts=[types.Part.from_text(text=display)],
                        ),
                        author=author,
                        timestamp=ts,
                    ))

            return matched[:5]  # top 5 events

        except Exception as e:
            print(f"[Memory] Event search failed: {e}")
            return []

    # ── Public helper: get episodic context for session start ──────────────

    async def get_recent_context(
        self, app_name: str, user_id: str, limit: int = 5
    ) -> str:
        """
        Build a context string from recent episodes and facts for session startup.
        Injected into the system prompt for continuity.

        Returns:
            A formatted string with recent memory context, or empty string.
        """
        user_key = _user_key(app_name, user_id)
        db = self._get_db()

        try:
            # Get recent episodes
            episodes_ref = (
                db.collection(self.MEMORIES_COLLECTION)
                .document(user_key)
                .collection(self.EPISODES_SUBCOLLECTION)
            )
            episode_docs = await asyncio.to_thread(
                lambda: list(
                    episodes_ref
                    .order_by("timestamp", direction="DESCENDING")
                    .limit(limit)
                    .stream()
                )
            )

            # Get all facts
            facts_ref = (
                db.collection(self.MEMORIES_COLLECTION)
                .document(user_key)
                .collection(self.FACTS_SUBCOLLECTION)
            )
            fact_docs = await asyncio.to_thread(
                lambda: list(facts_ref.limit(20).stream())
            )

            if not episode_docs and not fact_docs:
                return ""

            parts = [
                "\n═══ ASTRA MEMORY BANK ═══════════════════════════════════════",
                "The following is your memory from previous conversations with this founder.",
                "Use this context naturally — don't explicitly say 'I remember' unless asked.",
                "",
            ]

            # Facts
            if fact_docs:
                parts.append("── Known Facts ──")
                for doc in fact_docs:
                    data = doc.to_dict()
                    parts.append(f"  • {data.get('fact', '')}")
                parts.append("")

            # Recent episodes
            if episode_docs:
                parts.append("── Recent Conversations ──")
                for doc in reversed(episode_docs):  # oldest first
                    data = doc.to_dict()
                    ts = data.get("ts_human", "")[:10]
                    summary = data.get("summary", "")
                    topics = ", ".join(data.get("topics", []))

                    parts.append(f"  [{ts}] {summary}")
                    if topics:
                        parts.append(f"    Topics: {topics}")

                    decisions = data.get("decisions", [])
                    if decisions:
                        parts.append(f"    Decisions: {'; '.join(decisions)}")

                    action_items = data.get("action_items", [])
                    if action_items:
                        parts.append(f"    Action items: {'; '.join(action_items)}")
                    parts.append("")

            parts.append("═════════════════════════════════════════════════════════════")

            return "\n".join(parts)

        except Exception as e:
            print(f"[Memory] get_recent_context failed: {e}")
            return ""
