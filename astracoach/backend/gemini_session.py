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
import uuid

from google.genai import types

from google.adk import Runner
from google.adk.agents import LlmAgent, LiveRequestQueue, RunConfig
from google.adk.agents.run_config import StreamingMode
from google.adk.sessions import InMemorySessionService
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

─── Live Session Rules (always follow, regardless of persona) ───
Conversation style:
- Speak conversationally — no markdown, no bullet points in speech
- Keep responses concise (under 70 words) for natural real-time pacing
- Handle interruptions gracefully — acknowledge and continue
- You are always in character — never break the fourth wall

─── MANDATORY: Google Search Grounding for Factual Questions ────
You have access to the google_search tool (or web_search as fallback).
You MUST use it whenever the user asks about:
  • A specific company, product, or service (e.g. "What does Stripe do?")
  • Current events, recent news, or market trends
  • Real-world facts that could have changed recently
  • Any question where hallucinating facts would be harmful

DO NOT rely on your training data alone for these queries.
Say: "Let me check that for you." — then call google_search immediately.
After the search returns, weave the grounded facts naturally into your
spoken response without reading URLs aloud.
─────────────────────────────────────────────────────────────────

Tools available: google_search, evaluate_response, give_live_coaching,
remember_context, get_structured_plan, analyze_screen_content.

Astra OS Brain Tools (if active): search_memory, get_active_commitments,
get_overdue_commitments, get_active_risks, resolve_insight, dismiss_insight,
get_relationship_health, get_at_risk_relationships, get_all_relationships,
get_open_tasks, mark_task_done, mark_task_blocked, get_pending_alerts,
dismiss_alert, mark_alert_surfaced, get_recent_emails, get_email_thread,
send_email, reply_to_email, get_upcoming_meetings, get_todays_schedule,
get_meeting_with_contact, get_company_context, get_brain_summary.

Use tools when genuinely helpful. For Astra persona, ALWAYS call tools
for real data — never guess at commitments, emails, or relationships.

─── Screen Share Ambient Awareness (READ CAREFULLY) ─────────────
You are receiving a 1-frame-per-second JPEG image feed of the user's
ENTIRE computer desktop, squished into 768×768 pixels.

WHAT THIS MEANS FOR YOU:
- You have ambient awareness of which applications the user has open
  (e.g., VS Code, browser, terminal, document editor, Figma, etc.)
- You can detect the GENERAL LAYOUT of their screen — multiple windows,
  which app is in focus, whether they are coding, browsing, or writing
- You CANNOT reliably read fine text (code lines, error messages,
  terminal output) because the squish-to-768 makes it blurry.
  Do NOT guess at specific text content — you will make errors.

RULE 1 — SILENCE BY DEFAULT:
Process every frame silently in the background. Do NOT narrate the
screen constantly. Do not say "I can see you're in VS Code" unless
directly asked.

RULE 2 — RESPOND WHEN DIRECTLY ASKED:
If the user asks "What am I doing?", "What do you see?", or
"What app am I in?" — give a brief, accurate description of the
general desktop layout (which apps appear open, what seems active).
Keep it to 1–2 sentences. Example:
  "It looks like you have VS Code open with what seems like a Python
   project, and a browser tab in the background."

RULE 3 — USE analyze_screen_content FOR FINE TEXT:
You MUST call the analyze_screen_content tool when:
  • The user says "read this code" / "can you see this?" / "debug this"
  • The user asks about a specific line, error, or piece of text
  • The user says "what does this say?" about something on screen
  • The user asks you to review, analyse, or explain visible content

When calling the tool, say briefly: "Let me zoom in and read that."
Pass the user's exact question as the argument. After it returns,
summarise the findings conversationally in under 80 words.

RULE 4 — CAMERA FRAMES vs SCREEN FRAMES:
You also receive occasional camera frames (user's face/environment).
These are separate from screen share frames. Camera frames help you
read documents the user holds up; screen frames are the desktop feed.

RULE 5 — DO NOT FABRICATE TEXT:
Never guess or fabricate what text says on screen. If you are not
sure, say "I can see you're working on something but I can't make out
the fine details — want me to zoom in and read it?"
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


# Import re here (used by _normalise_user_id above and summarize_and_persist)
import re


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
        commitments, and at-risk relationships to deliver a proactive briefing.
        For other personas: simple greeting.
        """
        if not self._brain_store or not self._founder_id:
            return "Please greet the user and ask them what they'd like to discuss today."

        try:
            alerts, overdue, at_risk = await asyncio.gather(
                self._brain_store.get_pending_alerts(self._founder_id),
                self._brain_store.get_overdue_commitments(self._founder_id),
                self._brain_store.get_at_risk_relationships(self._founder_id, threshold=0.4),
            )

            briefing_parts = []
            if overdue:
                items = ", ".join(i.content[:60] for i in overdue[:3])
                briefing_parts.append(f"{len(overdue)} overdue commitment(s): {items}")
            if alerts:
                items = ", ".join(a.title[:50] for a in alerts[:3])
                briefing_parts.append(f"{len(alerts)} pending alert(s): {items}")
            if at_risk:
                names = ", ".join(p.name or p.contact_email for p in at_risk[:3])
                briefing_parts.append(f"{len(at_risk)} at-risk relationship(s): {names}")

            if briefing_parts:
                context = "; ".join(briefing_parts)
                greeting = (
                    f"[SYSTEM CONTEXT — proactive briefing data, use this to inform your greeting]\n"
                    f"Brain state: {context}\n\n"
                    f"Greet the founder by name, then proactively surface the most critical "
                    f"items above. Be concise — 3-4 sentences max. Start with an appropriate "
                    f"time-of-day greeting. End with 'What would you like to tackle first?'"
                )
                print(f"[GeminiLive] 🔔 Proactive briefing: {len(overdue)} overdue, "
                      f"{len(alerts)} alerts, {len(at_risk)} at-risk")
                return greeting
            else:
                return (
                    "Greet the founder warmly and let them know everything looks clear — "
                    "no overdue commitments, no critical alerts. Ask what they'd like to work on."
                )

        except Exception as e:
            print(f"[GeminiLive] ⚠️  Proactive briefing failed: {e}")
            return "Please greet the user and ask them what they'd like to discuss today."

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

        system_prompt = build_system_prompt(self.session, past_summary=past_summary)

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

        # ── Step 4: ADK session service ───────────────────────────────────────
        session_service = InMemorySessionService()
        adk_session_id = str(uuid.uuid4())
        await session_service.create_session(
            app_name=APP_NAME, user_id=self._user_id, session_id=adk_session_id
        )

        # ── Step 5: Runner ────────────────────────────────────────────────────
        runner = Runner(
            app_name=APP_NAME,
            agent=voice_agent,
            session_service=session_service,
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

        # ── Step 9: Run upstream and downstream concurrently ──────────────────
        try:
            await asyncio.gather(
                self._upstream_task(),
                self._downstream_task(runner, adk_session_id, run_config),
            )
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

    async def _downstream_task(self, runner: Runner, session_id: str, run_config: RunConfig):
        """
        Iterates run_live() events and routes audio/control to the browser.
        """
        print("[downstream_task] started, calling runner.run_live()")
        try:
            async for event in runner.run_live(
                user_id=self._user_id,
                session_id=session_id,
                live_request_queue=self._q,
                run_config=run_config,
            ):
                if self._closed:
                    break

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

                print(f"[downstream_task] event: interrupted={event.interrupted} "
                      f"turn_complete={event.turn_complete} has_audio={has_audio}")

                # ── 1. Forward audio to browser ───────────────────────────
                if has_audio and not self._interrupted:
                    for p in event.content.parts:
                        if (getattr(p, "inline_data", None) and
                                "audio/pcm" in getattr(p.inline_data, "mime_type", "")):
                            await self._send_bytes(p.inline_data.data)
                    await self._notify({"type": "status", "state": "speaking"})

                # ── 2. Handle interruption ────────────────────────────────
                if event.interrupted is True:
                    print("====> [downstream_task] NATIVE BARGE-IN DETECTED <====")
                    self._interrupted = True
                    await self._notify({"type": "interrupted"})   # flush browser audio
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
                        # Map brain tool names to user-friendly labels
                        _TOOL_LABELS = {
                            "analyze_screen_content": "🔍 analyzing screen…",
                            "google_search": "🌐 searching the web…",
                            "search_memory": "🧠 searching brain…",
                            "get_brain_summary": "🧠 checking brain…",
                            "get_active_commitments": "📋 checking commitments…",
                            "get_overdue_commitments": "⚠️ checking overdue…",
                            "get_active_risks": "🚨 checking risks…",
                            "get_relationship_health": "💚 checking relationship…",
                            "get_at_risk_relationships": "💔 checking relationships…",
                            "get_recent_emails": "📧 reading emails…",
                            "get_email_thread": "📧 reading thread…",
                            "send_email": "✉️ sending email…",
                            "reply_to_email": "↩️ replying to email…",
                            "get_upcoming_meetings": "📅 checking calendar…",
                            "get_todays_schedule": "📅 checking today…",
                            "get_open_tasks": "✅ checking tasks…",
                            "get_pending_alerts": "🔔 checking alerts…",
                        }
                        for fc in calls:
                            label = _TOOL_LABELS.get(fc.name, fc.name)
                            await self._notify({
                                "type": "tool_call",
                                "name": label,
                                "status": "running",
                            })

        except Exception as e:
            print(f"[downstream_task] Error: {e}")
            import traceback
            traceback.print_exc()
            await self._notify({"type": "error", "message": f"Session error: {str(e)}"})

        print("[downstream_task] run_live() generator completed")

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

        # ── Fire-and-forget: post-session summarization (NEW) ────────────────
        if self._store is not None and self.session is not None:
            try:
                self._summarise_task = asyncio.create_task(
                    summarize_and_persist(
                        session_id=self.session.session_id,
                        user_id=self._user_id,
                        api_key=self.api_key,
                        store=self._store,
                        session=self.session,   # Pass directly — avoids store-deletion race condition
                    )
                )
                print(f"[GeminiLive] 🧠 Post-session summarization scheduled for "
                      f"session '{self.session.session_id}', user '{self._user_id}'")
            except Exception as e:
                print(f"[GeminiLive] ⚠️  Could not schedule summarization: {e}")

    async def _notify(self, payload: dict):
        """Send a JSON control message to the browser."""
        try:
            await self._send_text(json.dumps(payload))
        except Exception:
            pass

    def session_store_add_transcript(self, role: str, text: str):
        """Overridden by main.py to persist transcripts."""
        pass
