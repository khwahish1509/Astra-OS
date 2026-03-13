"""
Gemini Live Session Manager — Dual-Agent Architecture
======================================================
Manages a single Gemini Live session using Google ADK.

Architecture:
  ┌─────────────────────────────────────────────────────────────────┐
  │  VoiceAgent  (gemini-2.5-flash-native-audio, bidi streaming)   │
  │  ├── Tools: web_search, evaluate_response, give_live_coaching,  │
  │  │          remember_context, get_structured_plan               │
  │  └── Tool:  analyze_screen_content  (closure → regular genAI)  │
  └─────────────────────────────────────────────────────────────────┘

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

# ──────────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────────

MODEL_VOICE    = os.getenv("GEMINI_MODEL",    "gemini-2.5-flash-native-audio-preview-12-2025")
MODEL_ANALYSIS = os.getenv("ANALYSIS_MODEL",  "gemini-2.0-flash")   # used by analyze_screen_content tool (regular generate_content, NOT bidi)
APP_NAME       = "astra_coach"
USER_ID        = "default_user"

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

Tools available: web_search, evaluate_response, give_live_coaching,
remember_context, get_structured_plan. Use them when genuinely helpful.

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


def build_system_prompt(session) -> str:
    """Combine the user-defined persona prompt with universal live-session rules."""
    base = session.system_prompt.strip()
    if session.user_name:
        base = f"The user's name is {session.user_name}. Address them by name naturally.\n\n" + base

    # Inject persisted memories so the agent remembers across Cloud Run restarts
    if session.memories:
        memory_lines = "\n".join(f"  {k}: {v}" for k, v in session.memories.items())
        base = base + f"\n\n─── User memories from previous turns ───\n{memory_lines}\n"

    return base + UNIVERSAL_VOICE_SUFFIX


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
    """

    def __init__(self, api_key: str, session, ws_send_bytes, ws_send_text):
        self.api_key = api_key
        self.session = session
        self._send_bytes = ws_send_bytes   # coroutine: send binary to browser
        self._send_text  = ws_send_text    # coroutine: send JSON text to browser
        self._closed     = False
        self._interrupted = False          # gate: when True, block audio forwarding

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

    # ── Main entry point ──────────────────────────────────────────────────────

    async def run(self):
        """
        Main entry point. Opens an ADK Runner session and drives
        the bidirectional stream concurrently.
        """
        os.environ["GOOGLE_API_KEY"] = self.api_key
        system_prompt = build_system_prompt(self.session)

        print(f"[GeminiLive] Starting session: model={MODEL_VOICE}")

        # 1. Build VoiceAgent — all custom tools + analyze_screen_content closure tool
        #    NOTE: No sub_agents here. Sub-agents require bidi-capable models for ALL agents
        #    in the tree, which is a severe limitation. The analyze_screen_content FunctionTool
        #    achieves the same screen-reading capability via regular generate_content() instead.
        analyze_tool = self._make_analyze_tool()
        voice_agent = LlmAgent(
            name=APP_NAME,
            model=MODEL_VOICE,
            instruction=system_prompt,
            tools=[*ALL_TOOLS, analyze_tool],
        )
        print(f"[GeminiLive] VoiceAgent ready. Screen analysis tool: {MODEL_ANALYSIS}")

        # 2. ADK session service
        session_service = InMemorySessionService()
        session_id = str(uuid.uuid4())
        await session_service.create_session(
            app_name=APP_NAME, user_id=USER_ID, session_id=session_id
        )

        # 3. Runner
        runner = Runner(
            app_name=APP_NAME,
            agent=voice_agent,
            session_service=session_service,
        )

        # 4. RunConfig — Native Audio BIDI
        # Try to enable proactive_audio + enable_affective_dialog (ADK ≥ 0.6.0).
        # Gracefully fall back to base RunConfig on older ADK versions that don't
        # have these fields yet (avoids a TypeError crashing the session).
        _base_run_config_kwargs = dict(
            streaming_mode=StreamingMode.BIDI,
            response_modalities=["AUDIO"],
            # NOTE: speech_config NOT supported for native audio models (causes 1008)
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(disabled=True)
            ),
            save_live_blob=True,  # Required for ADK to flush and yield interruption events
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

        # 5. Notify frontend that session is live
        await self._notify({"type": "ready"})
        await self._notify({"type": "status", "state": "listening"})

        # 6. Kickstart the agent's first response with a greeting
        try:
            self._q.send_content(
                types.Content(
                    role="user",
                    parts=[types.Part.from_text(
                        text="Please greet the user and ask them what they'd like to discuss today."
                    )]
                )
            )
        except Exception as e:
            print(f"[GeminiLive] Warning: could not send greeting: {e}")

        # 7. Run upstream and downstream concurrently
        try:
            await asyncio.gather(
                self._upstream_task(),
                self._downstream_task(runner, session_id, run_config),
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
                user_id=USER_ID,
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
                        for fc in calls:
                            tool_name = fc.name
                            if tool_name == "analyze_screen_content":
                                await self._notify({
                                    "type": "tool_call",
                                    "name": "🔍 analyzing screen…",
                                    "status": "running",
                                })
                            else:
                                await self._notify({
                                    "type": "tool_call",
                                    "name": tool_name,
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
        """Gracefully shutdown the bridge."""
        self._closed = True
        await self._ws_incoming_queue.put(None)   # Sentinel to unblock upstream_task
        try:
            self._q.close()
        except Exception:
            pass

    async def _notify(self, payload: dict):
        """Send a JSON control message to the browser."""
        try:
            await self._send_text(json.dumps(payload))
        except Exception:
            pass

    def session_store_add_transcript(self, role: str, text: str):
        """Overridden by main.py to persist transcripts."""
        pass
