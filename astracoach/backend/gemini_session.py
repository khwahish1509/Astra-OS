"""
Gemini Live Session Manager — Dual-Agent Architecture
======================================================
Manages a single Gemini Live session using Google ADK.

Architecture:
  ┌──────────────────────────────────────────────────────────────────────┐
  │  VoiceAgent  (gemini-2.5-flash-native-audio, bidi streaming)        │
  │  ├── Tools: google_search (ADK native grounding ✦ NEW),             │
  │  │          evaluate_response, give_live_coaching,                   │
  │  │          remember_context, get_structured_plan                   │
  │  └── Tool:  analyze_screen_content  (closure → regular genAI)       │
  └──────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────┐
  │  Grounding & Memory Bank (NEW)                                       │
  │  ├── Google Search Grounding: ADK native google_search built-in     │
  │  │   tool replaces stub web_search — provides real-time search       │
  │  │   results grounded in live Google Search.                         │
  │  ├── Long-Term Memory: summarize_and_persist() runs as a            │
  │  │   background asyncio task at session close. Uses Gemini Flash      │
  │  │   to extract Strengths/Weaknesses/Topics from the transcript and  │
  │  │   writes to Firestore astra_user_profiles/{user_id}.             │
  │  └── Contextual Recall: at session start, retrieves the user's past  │
  │      profile from Firestore and injects it into the VoiceAgent       │
  │      system prompt so the coach immediately knows what to target.    │
  └──────────────────────────────────────────────────────────────────────┘

WHY NO sub_agents:
  ADK's run_live() propagates bidiGenerateContent to ALL sub-agents in
  the tree.  Only dedicated Live API models (gemini-2.0-flash-live-001,
  native-audio variants) support bidi on v1alpha.  Using sub_agents with
  a text model always causes a 1008 crash at session start.

  Instead, analyze_screen_content is a plain async FunctionTool that
  makes a regular client.models.generate_content() call internally.
  It can therefore use any model, has zero bidi requirement, and keeps
  the VoiceAgent's live session intact.

Audio format contract:
  Browser → Backend:  PCM16, 16 kHz, mono  (binary WS frames)
  Backend → Browser:  PCM16, 24 kHz, mono  (binary WS frames)
"""

import asyncio
import json
import os
import re
import uuid

from google.genai import types

from google.adk import Runner
from google.adk.agents import LlmAgent, LiveRequestQueue, RunConfig
from google.adk.agents.run_config import StreamingMode
from google.adk.sessions import InMemorySessionService
from google.adk.sessions import DatabaseSessionService
from agent_tools import ALL_TOOLS

from session_store import summarize_and_persist

# ──────────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────────

MODEL_VOICE    = os.getenv("GEMINI_MODEL",    "gemini-2.5-flash-native-audio-preview-12-2025")
MODEL_ANALYSIS = os.getenv("ANALYSIS_MODEL",  "gemini-2.0-flash")   # used by analyze_screen_content tool (regular generate_content, NOT bidi)
APP_NAME       = "astra_coach"
USER_ID        = "default_user"   # fallback when no user_name is provided

# ──────────────────────────────────────────────────────────────────────────────
# Google Search Grounding — ADK Native Built-In Tool
# ──────────────────────────────────────────────────────────────────────────────
# ADK v0.4.0+ exposes google_search as a first-class BuiltInTool.
# When added to an LlmAgent, ADK instructs the Gemini API to enable native
# Google Search grounding — results are fetched live and injected as grounding
# context before the model generates its response. This is significantly more
# powerful than a custom FunctionTool because:
#   1. Search happens server-side (lower latency, no round-trip to Python)
#   2. Gemini cites sources inline in its response
#   3. Works seamlessly with streaming / bidi sessions

try:
    from google.adk.tools import google_search as _adk_google_search
    GOOGLE_SEARCH_TOOL = _adk_google_search
    print("[GeminiLive] ✅ ADK native google_search grounding tool loaded")
except ImportError:
    GOOGLE_SEARCH_TOOL = None
    print("[GeminiLive] ⚠️  google_search not available in this ADK version "
          "— falling back to custom web_search FunctionTool")

# ──────────────────────────────────────────────────────────────────────────────
# System prompts
# ──────────────────────────────────────────────────────────────────────────────

UNIVERSAL_VOICE_SUFFIX = """

─── VOICE DELIVERY RULES (non-negotiable) ───
- Speak like a human in a real conversation. No bullet points. No markdown. No lists.
- Maximum 4 sentences per turn. If you need more, pause and ask "want me to continue?"
- Handle interruptions gracefully — stop immediately, acknowledge, pivot
- Never say "certainly", "absolutely", "great question", "I'd be happy to"
- Never narrate your own actions. Don't say "I'm going to search for..." — just do it
- When calling a tool, say ONE short phrase ("Let me check." / "Pulling that up." / "One sec.") then go silent until the tool returns
- After a tool returns, synthesize the result naturally. Don't read raw data aloud — interpret it
- Stay in character. Always.

─── TOOL EXECUTION RULES ───
Google Search: Use for any factual question about companies, people, market trends, current events. Don't say "let me search" — say "let me check that" then call google_search.

Astra Brain Tools (when active — 51 tools):
  Memory: search_memory, get_active_commitments, get_overdue_commitments, get_active_risks, resolve_insight, dismiss_insight
  People: get_relationship_health, get_at_risk_relationships, get_all_relationships
  Tasks: get_open_tasks, create_task, update_task, get_team_tasks, mark_task_done, mark_task_blocked
  Alerts: get_pending_alerts, dismiss_alert, mark_alert_surfaced
  Email: get_recent_emails, get_email_thread, send_email, reply_to_email, search_emails, get_emails_from_sender, get_unread_email_count
  Calendar: get_upcoming_meetings, get_todays_schedule, get_meeting_with_contact, create_calendar_event, quick_schedule
  Drive: search_drive, list_recent_drive_files, search_drive_by_type, get_drive_file_info, create_google_doc
  Google Tasks: list_google_tasks, create_google_task, complete_google_task, get_google_task_lists
  Contacts: search_contacts, get_contact_info, list_all_contacts
  Long-Term Memory: recall_memory, save_memory_note, get_past_conversations, get_known_facts
  CRM/Pipeline: get_sales_pipeline (deal stages from relationship data)
  Meeting Prep: get_meeting_prep (relationship + emails + commitments briefing for a contact)
  Weekly: get_weekly_digest (comprehensive weekly status across all brain data)
  Context: get_company_context, get_brain_summary

TASK DELEGATION: When the founder says "assign X to Y" or "create a task for Y", call create_task immediately. When they ask "what does Y have?" call get_team_tasks.
CRM: When founder asks about deals, pipeline, or sales status, call get_sales_pipeline.
MEETING PREP: When founder says "prep me for..." or "what should I know about...", call get_meeting_prep with the contact email.
WEEKLY: When founder says "weekly briefing" or "weekly update", call get_weekly_digest.

General: evaluate_response, give_live_coaching, remember_context, get_structured_plan, analyze_screen_content

CRITICAL: For Astra persona — ALWAYS call tools for real data. NEVER guess at names, dates, commitments, or relationship status. If you don't have data, say "I don't have that in the brain yet" rather than fabricating.

─── SCREEN SHARE (when active) ───
You receive 1-FPS desktop screenshots (768x768). Rules:
1. Process silently. Never narrate what you see unprompted
2. If asked "what do you see?" — describe apps/layout in 1-2 sentences
3. For fine text (code, errors, documents) — call analyze_screen_content. Say "Let me zoom in." then wait for the result
4. Camera frames are separate from screen frames
5. NEVER fabricate text you can't read. Say "I can't make that out — want me to zoom in?"
─────────────────────────────────────────────────────────────────
"""


def build_system_prompt(session, past_summary: str = "") -> str:
    """
    Assemble the full VoiceAgent system prompt from three layers:

    1. Persona base prompt (user-defined)
    2. Contextual Recall block (cross-session user profile, if available)
    3. Universal live-session rules (screen share, grounding directive, etc.)

    Args:
        session:      AgentSession — contains persona + user name + session memories
        past_summary: Optional contextual recall string from UserProfile.to_recall_prompt()
    """
    base = session.system_prompt.strip()

    # Layer 0 — Personalise by name
    if session.user_name:
        base = f"The user's name is {session.user_name}. Address them by name naturally.\n\n" + base

    # Layer 1 — Inject within-session memories (from remember_context tool calls)
    if session.memories:
        memory_lines = "\n".join(f"  {k}: {v}" for k, v in session.memories.items())
        base = base + f"\n\n─── User memories from previous turns ───\n{memory_lines}\n"

    # Layer 2 — Contextual Recall: inject cross-session user profile (NEW)
    if past_summary:
        base = base + past_summary

    # Layer 3 — Universal rules: grounding directive + screen share rules
    return base + UNIVERSAL_VOICE_SUFFIX


# ──────────────────────────────────────────────────────────────────────────────
# Utility: normalise a display name → stable user_id for Firestore
# ──────────────────────────────────────────────────────────────────────────────

def _normalise_user_id(raw: str) -> str:
    """
    Convert a display name to a stable Firestore document ID.
    e.g. "Alice Smith" → "alice_smith", "" → "anonymous"
    """
    if not raw:
        return "anonymous"
    return re.sub(r"[^a-z0-9_]", "_", raw.strip().lower())


# ──────────────────────────────────────────────────────────────────────────────
# GeminiLiveBridge
# ──────────────────────────────────────────────────────────────────────────────

class GeminiLiveBridge:
    """
    Bridges a browser WebSocket ↔ Gemini Live API session via Google ADK.

    Architecture mirrors the ADK bidi-demo sample:
      - upstream_task:   reads audio blobs from a Queue → LiveRequestQueue
      - downstream_task: iterates run_live() events → forwards audio/control to browser

    Screen analysis is handled by an analyze_screen_content FunctionTool (a
    closure over this instance) that calls generate_content() directly — no bidi
    required, so any model works.

    Grounding & Memory Bank (NEW):
      - google_search ADK built-in tool added to VoiceAgent
      - Contextual Recall injected into system prompt from past UserProfile
      - Post-session summarization scheduled as background task on close()
    """

    def __init__(
        self,
        api_key: str,
        session,
        ws_send_bytes,
        ws_send_text,
        store=None,      # optional session store for long-term memory
        user_id: str = None,  # stable user identifier for cross-session recall
        brain_tools: dict = None,   # Astra OS brain tools: {name: async_fn}
        brain_store=None,           # CompanyBrainStore for proactive alerts
        founder_id: str = None,     # founder ID for brain queries
        memory_service=None,        # ADK BaseMemoryService for long-term memory
    ):
        self.api_key  = api_key
        self.session  = session
        self._send_bytes = ws_send_bytes   # coroutine: send binary to browser
        self._send_text  = ws_send_text    # coroutine: send JSON text to browser
        self._closed     = False
        self._interrupted = False          # gate: when True, block audio forwarding

        # ── Astra OS Brain references ─────────────────────────────────────
        self._brain_tools  = brain_tools or {}
        self._brain_store  = brain_store
        self._founder_id   = founder_id

        # ── Memory Service (ADK-native long-term memory) ──────────────────
        self._memory_service = memory_service

        # ── Long-Term Memory references ───────────────────────────────────
        self._store   = store
        # Derive a stable user_id from the provided value or from the session's user_name
        if user_id:
            self._user_id = _normalise_user_id(user_id)
        elif session.user_name:
            self._user_id = _normalise_user_id(session.user_name)
        else:
            self._user_id = USER_ID
        # Track whether we scheduled a background summarisation task
        self._summarise_task: asyncio.Task | None = None

        # Latest screen share frame — updated by _upstream_task, read by analyze tool
        self._latest_screen_frame: bytes = b""
        self._latest_screen_mime:  str   = "image/jpeg"

        # Shared queue: main.py pushes items here, upstream_task reads them
        self._ws_incoming_queue: asyncio.Queue = asyncio.Queue()

        # ADK live request queue for bidirectional streaming
        self._q = LiveRequestQueue()

    # ── Screen analysis tool (closure pattern) ───────────────────────────────

    def _make_analyze_tool(self):
        """
        Returns an async function tool that analyses the current screen frame.

        Implemented as a closure so the tool can access self._latest_screen_frame
        without global state.  The function calls generate_content() (not bidi),
        so it has NO model restrictions — any standard Gemini model works.
        """
        bridge = self   # capture instance

        async def analyze_screen_content(question: str) -> str:
            """
            Analyse the current screen share frame to read fine text, code, error
            messages, or other content that is too blurry in the ambient 768×768 feed.

            Call this whenever the user asks you to read, debug, or explain something
            specific that is visible on their screen.

            Args:
                question: Exactly what the user wants to know about the screen content.

            Returns:
                Plain-text analysis of the visible screen content answering the question.
            """
            if not bridge._latest_screen_frame:
                return (
                    "No screen share frame is available yet. "
                    "Ask the user to start screen sharing first."
                )

            try:
                import google.genai as genai

                client = genai.Client(api_key=bridge.api_key)

                img_part = types.Part.from_bytes(
                    data=bridge._latest_screen_frame,
                    mime_type=bridge._latest_screen_mime,
                )

                prompt = (
                    "You are analysing a screenshot of a user's desktop. "
                    "The image is the user's full screen compressed to 768×768 pixels.\n\n"
                    f"User's question: {question}\n\n"
                    "Instructions:\n"
                    "- Examine the image carefully and answer the question precisely.\n"
                    "- If you can see code, read it accurately and describe what it does.\n"
                    "- If there are error messages, quote them exactly.\n"
                    "- If text is blurry or partially visible, describe what you can make out.\n"
                    "- If code has bugs, name the specific issue (line, variable, logic error).\n"
                    "- Be factual — never invent content you cannot see.\n"
                    "- Keep the response under 150 words (it will be read aloud).\n"
                    "- Use plain text only — no markdown, no bullet points."
                )

                # Run blocking SDK call in a thread to avoid blocking the event loop
                response = await asyncio.to_thread(
                    client.models.generate_content,
                    model=MODEL_ANALYSIS,
                    contents=[
                        types.Content(parts=[
                            types.Part.from_text(text=prompt),
                            img_part,
                        ])
                    ],
                )
                return response.text or "Screen analysis returned an empty response."

            except Exception as e:
                print(f"[analyze_screen_content] Error: {e}")
                return f"Screen analysis failed: {e}"

        return analyze_screen_content

    # ── Proactive Briefing Builder ────────────────────────────────────────────

    async def _build_greeting(self) -> str:
        """
        Build the greeting message for the session.

        For Astra persona: queries the brain for pending alerts, overdue
        commitments, at-risk relationships, today's calendar, and unread
        emails to deliver a sharp executive briefing on session start.
        Preloading this data eliminates tool calls for common opening questions.
        For other personas: simple greeting.
        """
        if not self._brain_store or not self._founder_id:
            return "Please greet the user and ask them what they'd like to discuss today."

        try:
            # Parallel fetch all briefing data — saves ~2s vs sequential calls
            fetch_tasks = [
                self._brain_store.get_pending_alerts(self._founder_id),
                self._brain_store.get_overdue_commitments(self._founder_id),
                self._brain_store.get_at_risk_relationships(self._founder_id, threshold=0.4),
                self._brain_store.get_open_tasks(self._founder_id),
            ]

            # Also preload calendar and email data (these are the most commonly
            # asked about in the first turn — preloading avoids an extra tool call)
            _calendar = self._brain_tools.get("get_todays_schedule")
            _unread = self._brain_tools.get("get_unread_email_count")
            if _calendar:
                fetch_tasks.append(_calendar())
            if _unread:
                fetch_tasks.append(_unread())

            results = await asyncio.gather(*fetch_tasks, return_exceptions=True)

            alerts  = results[0] if not isinstance(results[0], Exception) else []
            overdue = results[1] if not isinstance(results[1], Exception) else []
            at_risk = results[2] if not isinstance(results[2], Exception) else []
            tasks   = results[3] if not isinstance(results[3], Exception) else []

            # Calendar + email are optional preloads
            today_schedule = results[4] if len(results) > 4 and not isinstance(results[4], Exception) else []
            unread_data    = results[5] if len(results) > 5 and not isinstance(results[5], Exception) else {}

            # Build structured briefing data
            briefing_data = []

            if overdue:
                for c in overdue[:3]:
                    parties = ", ".join(c.parties[:2]) if c.parties else "unknown"
                    briefing_data.append(f"OVERDUE: \"{c.content[:80]}\" (with {parties}, due {c.due_date or 'no date'})")

            if alerts:
                for a in alerts[:3]:
                    briefing_data.append(f"ALERT [{a.severity.value.upper()}]: {a.title} — {(a.message or '')[:60]}")

            if at_risk:
                for r in at_risk[:3]:
                    name = r.name or r.contact_email
                    briefing_data.append(f"AT-RISK RELATIONSHIP: {name} (health: {int(r.health_score*100)}%, tone: {r.tone_trend.value})")

            total_issues = len(overdue) + len(alerts) + len(at_risk)
            open_task_count = len(tasks)

            # Preloaded context block — saves the agent from needing tool calls
            preloaded = []
            if today_schedule:
                event_summaries = []
                for ev in (today_schedule[:5] if isinstance(today_schedule, list) else []):
                    title = ev.get("title", "Untitled") if isinstance(ev, dict) else str(ev)
                    start = ev.get("start_time", "") if isinstance(ev, dict) else ""
                    event_summaries.append(f"{start[:5]} {title}" if start else title)
                if event_summaries:
                    preloaded.append(f"TODAY'S SCHEDULE: {'; '.join(event_summaries)}")

            unread_count = unread_data.get("unread_count", 0) if isinstance(unread_data, dict) else 0
            if unread_count:
                preloaded.append(f"UNREAD EMAILS: {unread_count}")

            preloaded_block = ""
            if preloaded:
                preloaded_block = "\n" + "\n".join(f"  • {p}" for p in preloaded) + "\n"

            if briefing_data:
                data_block = "\n".join(f"  • {d}" for d in briefing_data)
                greeting = (
                    f"[PROACTIVE BRIEFING — real data from Company Brain, speak this naturally]\n"
                    f"Total issues requiring attention: {total_issues}\n"
                    f"Open tasks: {open_task_count}\n"
                    f"Details:\n{data_block}\n"
                    f"{preloaded_block}\n"
                    f"INSTRUCTIONS: Greet the founder by name. Then deliver a sharp 20-second "
                    f"briefing hitting the most critical items. Sound like a COO walking into "
                    f"a morning standup — confident, specific, no filler. Use actual names "
                    f"and numbers from the data above. Example tone: 'Morning Khwahish. "
                    f"Three things. You've got an overdue commitment to [name] from last week. "
                    f"[Name]'s relationship health dropped to 30 percent. And there's a "
                    f"high-severity alert on [topic]. Want to tackle the overdue item first?'"
                )
                print(f"[GeminiLive] 🔔 Proactive briefing: {len(overdue)} overdue, "
                      f"{len(alerts)} alerts, {len(at_risk)} at-risk, {open_task_count} tasks")
                return greeting
            else:
                return (
                    f"[PRELOADED CONTEXT — you already have this data, no need to call tools]\n"
                    f"{preloaded_block}\n"
                    f"Greet the founder by name. Everything looks clean today — no overdue "
                    f"commitments, no critical alerts, relationships are healthy. "
                    f"If there are meetings or unread emails, mention them briefly. "
                    f"Keep it under 20 words."
                )

        except Exception as e:
            print(f"[GeminiLive] ⚠️  Proactive briefing failed: {e}")
            return "Please greet the user and ask them what they'd like to discuss today."

    # ── Proactive Alert Engine ─────────────────────────────────────────────────

    async def _proactive_alert_task(self):
        """
        Background task that periodically checks for new HIGH/CRITICAL alerts
        during an active voice session and injects them as text context so
        Astra can proactively speak about them. Runs every 60 seconds.
        """
        # Track which alerts we've already surfaced to avoid repeats
        surfaced_ids: set[str] = set()
        CHECK_INTERVAL = 60  # seconds between checks

        print("[proactive_alerts] Background alert checker started")
        try:
            # Wait before first check to let the session warm up
            await asyncio.sleep(30)

            while not self._closed:
                try:
                    from brain.models import AlertSeverity
                    alerts = await self._brain_store.get_pending_alerts(
                        self._founder_id, min_severity=AlertSeverity.HIGH
                    )
                    new_alerts = [a for a in alerts if a.id not in surfaced_ids]

                    if new_alerts:
                        alert = new_alerts[0]  # Surface one at a time
                        surfaced_ids.add(alert.id)

                        # Inject the alert as a text message into the live session
                        alert_text = (
                            f"[PROACTIVE ALERT — important, speak this to the founder now]\n"
                            f"Severity: {alert.severity.value.upper()}\n"
                            f"Alert: {alert.title}\n"
                            f"Details: {alert.message}\n"
                            f"Related to: {alert.related_contact or 'general'}\n"
                            f"INSTRUCTION: Interrupt naturally and surface this alert. "
                            f"Say something like 'Hey, heads up — ' then deliver the alert "
                            f"concisely. Ask if they want to take action on it."
                        )

                        try:
                            self._q.send_content(
                                types.Content(
                                    role="user",
                                    parts=[types.Part.from_text(text=alert_text)]
                                )
                            )
                            # Mark as surfaced in the brain
                            await self._brain_store.mark_alert_surfaced(alert.id)
                            print(f"[proactive_alerts] Injected alert: {alert.title}")
                            await self._notify({
                                "type": "tool_call",
                                "name": "proactive_alert",
                                "status": "done",
                            })
                        except Exception as inject_err:
                            print(f"[proactive_alerts] Failed to inject: {inject_err}")

                except Exception as check_err:
                    print(f"[proactive_alerts] Check failed: {check_err}")

                await asyncio.sleep(CHECK_INTERVAL)

        except asyncio.CancelledError:
            pass
        print("[proactive_alerts] Background alert checker stopped")

    # ── Main entry point ──────────────────────────────────────────────────────

    async def run(self):
        """
        Main entry point. Opens an ADK Runner session and drives
        the bidirectional stream concurrently.

        Grounding & Memory Bank steps performed here:
          1. Contextual Recall: retrieve past UserProfile from store, build prompt injection
          2. google_search built-in tool added to VoiceAgent tools list
        """
        os.environ["GOOGLE_API_KEY"] = self.api_key

        # ── Step 1: Contextual Recall ─────────────────────────────────────────
        # Retrieve the user's past profile from the store (if available).
        # Format it as a system prompt injection block and pass to build_system_prompt().
        past_summary = ""
        if self._store is not None:
            try:
                profile = self._store.get_user_profile(self._user_id)
                if profile and profile.sessions_count > 0:
                    past_summary = profile.to_recall_prompt()
                    print(
                        f"[GeminiLive] 🧠 Contextual Recall: injecting past profile for "
                        f"user '{self._user_id}' ({profile.sessions_count} sessions, "
                        f"{len(profile.weaknesses)} weaknesses, "
                        f"{len(profile.strengths)} strengths)"
                    )
                else:
                    print(f"[GeminiLive] 🧠 Contextual Recall: no past profile found for '{self._user_id}' "
                          f"(first session or in-memory store)")
            except Exception as recall_err:
                print(f"[GeminiLive] ⚠️  Contextual Recall retrieval failed: {recall_err}")

        # ── Step 1b: Retrieve long-term memory context ──────────────────────
        # Fetch recent episode summaries + extracted facts from FirestoreMemoryService
        memory_context = ""
        if self._memory_service and hasattr(self._memory_service, "get_recent_context"):
            try:
                memory_context = await self._memory_service.get_recent_context(
                    app_name=APP_NAME, user_id=self._user_id, limit=5
                )
                if memory_context:
                    print(f"[GeminiLive] 🧠 Long-term memory loaded ({len(memory_context)} chars)")
            except Exception as mem_err:
                print(f"[GeminiLive] ⚠️  Memory context retrieval failed: {mem_err}")

        # Combine all memory sources into the system prompt
        combined_memory = past_summary
        if memory_context:
            combined_memory = (memory_context + "\n\n" + past_summary) if past_summary else memory_context

        system_prompt = build_system_prompt(self.session, past_summary=combined_memory)

        print(f"[GeminiLive] Starting session: model={MODEL_VOICE} user_id={self._user_id}")

        # ── Step 2: Build VoiceAgent tools list ──────────────────────────────
        # Use ADK native google_search if available (replaces stub web_search FunctionTool).
        analyze_tool = self._make_analyze_tool()

        if GOOGLE_SEARCH_TOOL is not None:
            custom_tools = [t for t in ALL_TOOLS if getattr(getattr(t, 'func', None), '__name__', '') != 'web_search']
            tool_list = [GOOGLE_SEARCH_TOOL, *custom_tools, analyze_tool]
            print(f"[GeminiLive] 🔍 google_search grounding tool active (replaced stub web_search)")
        else:
            tool_list = [*ALL_TOOLS, analyze_tool]
            print(f"[GeminiLive] 🔍 Using custom web_search FunctionTool (ADK google_search unavailable)")

        # ── Step 2b: Inject Astra OS brain tools into voice session ────────
        # These 22 tools let the voice agent query the Company Brain, read
        # emails, check calendar, manage tasks/alerts — all via voice.
        from google.adk.tools.function_tool import FunctionTool as ADKFunctionTool
        if self._brain_tools:
            brain_tool_objects = []
            for name, fn in self._brain_tools.items():
                try:
                    brain_tool_objects.append(ADKFunctionTool(func=fn))
                except Exception as e:
                    print(f"[GeminiLive] ⚠️  Could not wrap brain tool '{name}': {e}")
            tool_list.extend(brain_tool_objects)
            print(f"[GeminiLive] 🧠 {len(brain_tool_objects)} brain tools injected into voice session")

        # ── Step 3: Build VoiceAgent ──────────────────────────────────────────
        #    NOTE: No sub_agents here. Sub-agents require bidi-capable models for ALL agents
        #    in the tree, which is a severe limitation. The analyze_screen_content FunctionTool
        #    achieves the same screen-reading capability via regular generate_content() instead.
        voice_agent = LlmAgent(
            name=APP_NAME,
            model=MODEL_VOICE,
            instruction=system_prompt,
            tools=tool_list,
        )
        print(f"[GeminiLive] VoiceAgent ready. tools={[getattr(getattr(t,'func',t),'__name__',str(t)) for t in tool_list]}")

        # ── Step 4: ADK session service (persistent SQLite) ──────────────────
        # DatabaseSessionService persists session state + events to SQLite.
        # This enables ADK's built-in memory features (state prefixes, event
        # history, memory service integration). Falls back to InMemory if
        # aiosqlite is not installed.
        adk_session_id = str(uuid.uuid4())
        try:
            db_path = os.path.join(os.path.dirname(__file__), "astra_sessions.db")
            session_service = DatabaseSessionService(
                db_url=f"sqlite+aiosqlite:///{db_path}"
            )
            print(f"[GeminiLive] Using DatabaseSessionService (SQLite: {db_path})")
        except Exception as db_err:
            print(f"[GeminiLive] DatabaseSessionService unavailable ({db_err}), using InMemory")
            session_service = InMemorySessionService()

        # Create session with initial state including memory context
        initial_state = {}
        if memory_context:
            initial_state["user:memory_context"] = memory_context
        initial_state["user:session_count"] = (
            getattr(self, "_session_count", 0) + 1
        )

        adk_session = await session_service.create_session(
            app_name=APP_NAME, user_id=self._user_id,
            session_id=adk_session_id, state=initial_state,
        )

        # Store references for close()-time memory persistence
        self._adk_session_service = session_service
        self._adk_session_id = adk_session_id

        # ── Step 5: Runner (with memory service) ──────────────────────────────
        runner = Runner(
            app_name=APP_NAME,
            agent=voice_agent,
            session_service=session_service,
            memory_service=self._memory_service,
        )

        # ── Step 6: RunConfig — Native Audio BIDI ────────────────────────────
        # Try to enable proactive_audio + enable_affective_dialog (ADK ≥ 0.6.0).
        # Gracefully fall back to base RunConfig on older ADK versions.
        _base_run_config_kwargs = dict(
            streaming_mode=StreamingMode.BIDI,
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=self.session.voice or "Puck"
                    )
                )
            ),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(disabled=True)
            ),
            save_live_blob=True,
        )
        try:
            run_config = RunConfig(
                **_base_run_config_kwargs,
                proactivity=types.ProactivityConfig(proactive_audio=True),
                enable_affective_dialog=True,
            )
            print("[GeminiLive] RunConfig: proactive_audio=True, enable_affective_dialog=True ✅")
        except (TypeError, AttributeError) as _cfg_err:
            # ADK version doesn't support these fields yet — run without them
            print(f"[GeminiLive] RunConfig: proactivity/affective_dialog not available "
                  f"({_cfg_err.__class__.__name__}: {_cfg_err}) — using base config")
            run_config = RunConfig(**_base_run_config_kwargs)

        # ── Step 7: Notify frontend that session is live ──────────────────────
        await self._notify({"type": "ready"})
        await self._notify({"type": "status", "state": "listening"})

        # ── Step 8: Kickstart — proactive briefing for Astra, simple greeting for others
        greeting_text = await self._build_greeting()
        try:
            self._q.send_content(
                types.Content(
                    role="user",
                    parts=[types.Part.from_text(text=greeting_text)]
                )
            )
        except Exception as e:
            print(f"[GeminiLive] Warning: could not send greeting: {e}")

        # ── Step 9: Run upstream, downstream, and proactive alert checker concurrently
        try:
            tasks_to_run = [
                self._upstream_task(),
                self._downstream_task(runner, adk_session_id, run_config),
            ]
            # Add proactive alert checker if brain is available
            if self._brain_store and self._founder_id:
                tasks_to_run.append(self._proactive_alert_task())
            await asyncio.gather(*tasks_to_run)
        except Exception as e:
            print(f"[GeminiLive] Session error: {e}")
            await self._notify({"type": "error", "message": str(e)})
        finally:
            self._q.close()
            print("[GeminiLive] Session closed.")

    async def _upstream_task(self):
        """
        Reads audio/control items from the shared queue and forwards
        them to the ADK LiveRequestQueue.
        """
        print("[upstream_task] started")
        try:
            while True:
                item = await self._ws_incoming_queue.get()

                if item is None:   # Shutdown sentinel
                    print("[upstream_task] received shutdown sentinel")
                    break

                item_type = item.get("type", "audio")

                if item_type == "audio":
                    pcm = item.get("data", b"")
                    if pcm:
                        blob = types.Blob(data=pcm, mime_type="audio/pcm;rate=16000")
                        self._q.send_realtime(blob)

                elif item_type == "activity_start":
                    print("🎤 [VAD] activity_start", flush=True)
                    self._q.send_activity_start()

                elif item_type == "activity_end":
                    print("🛑 [VAD] activity_end", flush=True)
                    self._q.send_activity_end()

                elif item_type == "frame":
                    # Camera frame (320×240 JPEG from the user's webcam)
                    jpeg = item.get("data", b"")
                    if jpeg:
                        try:
                            blob = types.Blob(data=jpeg, mime_type="image/jpeg")
                            self._q.send_realtime(blob)
                        except Exception as frame_err:
                            print(f"[upstream_task] camera frame send error: {frame_err}")

                elif item_type == "image":
                    # Full-desktop screen share frame (768×768 squished JPEG).
                    # 1. Store it so analyze_screen_content tool can use it.
                    # 2. Forward to Gemini Live for ambient awareness.
                    jpeg      = item.get("data", b"")
                    mime_type = item.get("mime_type", "image/jpeg")
                    if jpeg:
                        # Store latest frame for the analyze_screen_content tool
                        self._latest_screen_frame = jpeg
                        self._latest_screen_mime  = mime_type
                        try:
                            blob = types.Blob(data=jpeg, mime_type=mime_type)
                            self._q.send_realtime(blob)
                        except Exception as img_err:
                            print(f"[upstream_task] screen image send error: {img_err}")

        except Exception as e:
            print(f"[upstream_task] Error: {e}")

    # Tool labels — map brain tool names to user-friendly UI labels
    _TOOL_LABELS = {
        "analyze_screen_content": "🔍 analyzing screen…",
        "google_search": "🌐 searching the web…",
        # Brain
        "search_memory": "🧠 searching brain…",
        "get_brain_summary": "🧠 checking brain…",
        "get_active_commitments": "📋 checking commitments…",
        "get_overdue_commitments": "⚠️ checking overdue…",
        "get_active_risks": "🚨 checking risks…",
        "get_relationship_health": "💚 checking relationship…",
        "get_at_risk_relationships": "💔 checking relationships…",
        "get_open_tasks": "✅ checking tasks…",
        "get_pending_alerts": "🔔 checking alerts…",
        # Gmail
        "get_recent_emails": "📧 reading emails…",
        "get_email_thread": "📧 reading thread…",
        "send_email": "✉️ sending email…",
        "reply_to_email": "↩️ replying to email…",
        "search_emails": "📧 searching emails…",
        "get_emails_from_sender": "📧 fetching sender emails…",
        "get_unread_email_count": "📧 counting unread…",
        # Calendar + Meet
        "get_upcoming_meetings": "📅 checking calendar…",
        "get_todays_schedule": "📅 checking today…",
        "get_meeting_with_contact": "📅 finding meetings…",
        "create_calendar_event": "📅 creating event…",
        "quick_schedule": "📅 scheduling…",
        # Drive
        "search_drive": "📁 searching Drive…",
        "list_recent_drive_files": "📁 listing files…",
        "search_drive_by_type": "📁 filtering files…",
        "get_drive_file_info": "📁 getting file info…",
        "create_google_doc": "📝 creating doc…",
        # Tasks
        "list_google_tasks": "✅ listing tasks…",
        "create_google_task": "✅ creating task…",
        "complete_google_task": "✅ completing task…",
        "get_google_task_lists": "✅ listing task lists…",
        # Contacts
        "search_contacts": "👤 searching contacts…",
        "get_contact_info": "👤 looking up contact…",
        "list_all_contacts": "👤 listing contacts…",
        # Long-Term Memory
        "recall_memory": "🧠 searching memory…",
        "save_memory_note": "🧠 saving to memory…",
        "get_past_conversations": "🧠 recalling past sessions…",
        "get_known_facts": "🧠 retrieving known facts…",
        # New: Task Delegation
        "create_task": "✅ creating task…",
        "update_task": "✅ updating task…",
        "get_team_tasks": "👥 checking team tasks…",
        # New: CRM / Pipeline
        "get_sales_pipeline": "📊 loading pipeline…",
        # New: Meeting Prep
        "get_meeting_prep": "📋 preparing briefing…",
        # New: Weekly Digest
        "get_weekly_digest": "📈 generating weekly digest…",
    }

    async def _downstream_task(self, runner: Runner, session_id: str, run_config: RunConfig):
        """
        Iterates run_live() events and routes audio/control to the browser.
        Auto-reconnects up to MAX_RECONNECT times on 1008 / transient errors.
        """
        MAX_RECONNECT = 3
        attempt = 0

        while attempt <= MAX_RECONNECT and not self._closed:
            if attempt > 0:
                wait_secs = min(2 ** attempt, 8)
                print(f"[downstream_task] Reconnecting in {wait_secs}s (attempt {attempt}/{MAX_RECONNECT})…")
                await self._notify({
                    "type": "status", "state": "reconnecting",
                    "message": f"Reconnecting… (attempt {attempt}/{MAX_RECONNECT})",
                })
                await asyncio.sleep(wait_secs)

                # Re-create the LiveRequestQueue for a fresh bidi stream
                try:
                    self._q = LiveRequestQueue()
                except Exception:
                    pass

            print(f"[downstream_task] started, calling runner.run_live() (attempt {attempt})")
            try:
                async for event in runner.run_live(
                    user_id=self._user_id,
                    session_id=session_id,
                    live_request_queue=self._q,
                    run_config=run_config,
                ):
                    if self._closed:
                        return

                    # Reset reconnect counter on successful event
                    attempt = 0

                    # ── Determine event type ──────────────────────────────────
                    has_audio = (
                        event.content
                        and event.content.parts
                        and any(
                            getattr(p, "inline_data", None) and
                            "audio/pcm" in getattr(p.inline_data, "mime_type", "")
                            for p in event.content.parts
                        )
                    )

                    # ── 1. Forward audio to browser ───────────────────────────
                    if has_audio and not self._interrupted:
                        for p in event.content.parts:
                            if (getattr(p, "inline_data", None) and
                                    "audio/pcm" in getattr(p.inline_data, "mime_type", "")):
                                await self._send_bytes(p.inline_data.data)
                        await self._notify({"type": "status", "state": "speaking"})

                    # ── 2. Handle interruption ────────────────────────────────
                    if event.interrupted is True:
                        self._interrupted = True
                        await self._notify({"type": "interrupted"})
                        await self._notify({"type": "status", "state": "listening"})

                    # ── 3. Handle turn complete ───────────────────────────────
                    elif event.turn_complete is True:
                        self._interrupted = False
                        await self._notify({"type": "status", "state": "listening"})

                    # ── 4. Forward input transcription (user's words) ─────────
                    if (getattr(event, "input_transcription", None) and
                            getattr(event.input_transcription, "text", None)):
                        text = event.input_transcription.text.strip()
                        if text and event.input_transcription.finished:
                            self.session_store_add_transcript("user", text)
                            await self._notify({
                                "type": "transcript",
                                "role": "user",
                                "text": text,
                            })

                    # ── 5. Forward output transcription (agent's words) ───────
                    if (getattr(event, "output_transcription", None) and
                            getattr(event.output_transcription, "text", None)):
                        text = event.output_transcription.text.strip()
                        if text and event.output_transcription.finished:
                            self.session_store_add_transcript("model", text)
                            await self._notify({
                                "type": "transcript",
                                "role": "model",
                                "text": text,
                            })

                    # ── 6. Handle tool calls ──────────────────────────────────
                    if hasattr(event, "get_function_calls"):
                        calls = event.get_function_calls()
                        if calls:
                            await self._notify({"type": "status", "state": "thinking"})
                            for fc in calls:
                                label = self._TOOL_LABELS.get(fc.name, fc.name)
                                await self._notify({
                                    "type": "tool_call",
                                    "name": label,
                                    "status": "running",
                                })

                # If run_live() ends normally (generator exhausted), break out
                print("[downstream_task] run_live() generator completed normally")
                return

            except Exception as e:
                err_str = str(e)
                is_1008 = "1008" in err_str
                is_transient = is_1008 or "RESOURCE_EXHAUSTED" in err_str or "503" in err_str

                if is_transient and attempt < MAX_RECONNECT:
                    attempt += 1
                    print(f"[downstream_task] Transient error (attempt {attempt}): {e}")
                    continue
                else:
                    print(f"[downstream_task] Fatal error: {e}")
                    import traceback
                    traceback.print_exc()
                    await self._notify({"type": "error", "message": f"Session error: {err_str}"})
                    return

        print("[downstream_task] Max reconnect attempts reached or session closed")

    # ── External interface (called by main.py WebSocket handler) ─────────────

    async def push(self, item: dict):
        """Push a browser WebSocket message into the upstream queue."""
        if not self._closed:
            await self._ws_incoming_queue.put(item)

    async def close(self):
        """
        Gracefully shutdown the bridge.

        Long-Term Memory: schedules post-session summarization as a background
        asyncio task (fire-and-forget). The task:
          1. Calls Gemini Flash to extract Strengths/Weaknesses from transcript
          2. Merges results into the user's cross-session UserProfile
          3. Persists UserProfile to Firestore (or in-memory store)
        """
        self._closed = True
        await self._ws_incoming_queue.put(None)   # Sentinel to unblock upstream_task
        try:
            self._q.close()
        except Exception:
            pass

        # ── Fire-and-forget: post-session summarization ────────────────────────
        if self._store is not None and self.session is not None:
            try:
                self._summarise_task = asyncio.create_task(
                    summarize_and_persist(
                        session_id=self.session.session_id,
                        user_id=self._user_id,
                        api_key=self.api_key,
                        store=self._store,
                        session=self.session,
                    )
                )
                print(f"[GeminiLive] 🧠 Post-session summarization scheduled for "
                      f"session '{self.session.session_id}', user '{self._user_id}'")
            except Exception as e:
                print(f"[GeminiLive] ⚠️  Could not schedule summarization: {e}")

        # ── Fire-and-forget: persist ADK session to long-term memory service ──
        if self._memory_service and hasattr(self, "_adk_session_service"):
            try:
                async def _persist_to_memory():
                    try:
                        # Retrieve the full ADK session with events
                        adk_session = await self._adk_session_service.get_session(
                            app_name=APP_NAME,
                            user_id=self._user_id,
                            session_id=self._adk_session_id,
                        )
                        if adk_session and adk_session.events:
                            await self._memory_service.add_session_to_memory(adk_session)
                            print(f"[GeminiLive] 🧠 Session persisted to long-term memory "
                                  f"({len(adk_session.events)} events)")
                        else:
                            print("[GeminiLive] 🧠 No events to persist to memory")
                    except Exception as mem_err:
                        print(f"[GeminiLive] ⚠️  Memory persistence failed: {mem_err}")

                asyncio.create_task(_persist_to_memory())
            except Exception as e:
                print(f"[GeminiLive] ⚠️  Could not schedule memory persistence: {e}")

    async def _notify(self, payload: dict):
        """Send a JSON control message to the browser."""
        try:
            await self._send_text(json.dumps(payload))
        except Exception:
            pass

    def session_store_add_transcript(self, role: str, text: str):
        """Overridden by main.py to persist transcripts."""
        pass
