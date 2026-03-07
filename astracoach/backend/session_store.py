"""
Session Store
=============
Holds in-memory state for each active agent session.
Sessions are now persona-driven — any system prompt, any role.
"""

import time
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AgentSession:
    session_id: str

    # ── Persona (fully user-defined) ─────────────────
    persona_name:  str    # display name e.g. "Interview Coach", "Spanish Tutor"
    system_prompt: str    # the FULL agent system prompt written by the user
    voice:         str    # Gemini voice name
    user_name:     str    # optional — for personalised responses

    # ── Runtime state ─────────────────────────────────
    created_at:    float = field(default_factory=time.time)
    transcript:    list  = field(default_factory=list)   # [{role, text, ts}]
    memories:      dict  = field(default_factory=dict)   # from remember_context tool
    latest_vision: str   = ""
    vision_ts:     float = 0.0
    is_active:     bool  = True


class SessionStore:
    def __init__(self):
        self._store: dict[str, AgentSession] = {}

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
