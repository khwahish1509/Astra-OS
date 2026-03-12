"""
Gemini Live Session Manager — Tri-Agent Architecture
======================================================
Manages a single Gemini Live session using Google ADK.

Architecture:
  ┌─────────────────────────────────────────────────────────────────┐
  │  VoiceAgent  (gemini-2.5-flash-native-audio, bidi streaming)   │
  │  ├── Tools: web_search, evaluate_response, give_live_coaching,  │
  │  │          remember_context, get_structured_plan               │
  │  └── sub_agents: [ReasoningAgent]                               │
  │                                                                 │
  │  ReasoningAgent  (gemini-2.5-flash text, code execution)        │
  │  └── BuiltInCodeExecutor (PIL, numpy, data analysis in Python)  │
  └─────────────────────────────────────────────────────────────────┘

Routing:
  VoiceAgent handles all conversational turns natively.
  When user shows a document/resume or asks for deep analysis,
  VoiceAgent calls transfer_to_agent("reasoning_agent") automatically.
  ReasoningAgent uses Python code execution (PIL/Pillow etc.) to
  extract text, analyse structure, and return detailed results back
  to VoiceAgent, which summarises verbally for the user.

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

MODEL_VOICE     = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025")
MODEL_REASONING = "gemini-2.5-flash-preview-04-17"   # text model for code execution
APP_NAME        = "astra_coach"
USER_ID         = "default_user"

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

─── ReasoningAgent delegation (IMPORTANT) ───────────────────────
You have a sub-agent called "reasoning_agent" that can:
- Execute Python code with PIL/Pillow to analyse document/resume images
- Extract fine text, detect layout, count sections, score formatting
- Run any data analysis that requires code execution

WHEN TO DELEGATE:
- User shows a document, resume, CV, or certificate via camera
- User asks to "read", "analyse", or "review" something they're holding up
- Any task that needs precise text extraction or image analysis
- User explicitly asks you to "look at this" or "what does this say"

HOW TO DELEGATE:
Say briefly: "Let me take a closer look at that for you."
Then use transfer_to_agent with agent_name="reasoning_agent".
After reasoning_agent returns, summarise its findings conversationally.
"""

REASONING_AGENT_PROMPT = """
You are ReasoningAgent — a document and image analysis specialist.
You are called by the VoiceAgent when fine image/document analysis is needed.

Your capabilities:
- Python code execution with PIL/Pillow, numpy, io
- Image analysis: text detection, layout analysis, OCR-like extraction
- Document scoring: content quality, formatting, completeness

When given an image or document to analyse:
1. Write Python code using PIL to open and inspect the image
2. Analyse dimensions, colour distribution, text regions
3. Extract any readable text content using available libraries
4. Provide a structured analysis: sections found, key content, quality score
5. Return a concise summary the VoiceAgent can relay conversationally

Always return results as a clear text summary (not code blocks) since
VoiceAgent will read it aloud. Be thorough but keep the final summary
under 200 words.
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
# Build the Reasoning Sub-Agent
# ──────────────────────────────────────────────────────────────────────────────

def _build_reasoning_agent() -> LlmAgent:
    """
    Creates the ReasoningAgent with BuiltInCodeExecutor.

    NOTE: BuiltInCodeExecutor cannot be mixed with custom FunctionTools
    in the same agent (ADK constraint). ReasoningAgent gets code execution;
    VoiceAgent gets all custom FunctionTools. They complement each other.
    """
    try:
        from google.adk.code_executors import BuiltInCodeExecutor
        reasoning_agent = LlmAgent(
            name="reasoning_agent",
            model=MODEL_REASONING,
            instruction=REASONING_AGENT_PROMPT,
            code_executor=BuiltInCodeExecutor(),
        )
        print("[GeminiLive] ✅ ReasoningAgent created with BuiltInCodeExecutor")
        return reasoning_agent
    except ImportError:
        # ADK version doesn't have BuiltInCodeExecutor — create without it
        print("[GeminiLive] ⚠  BuiltInCodeExecutor not available — reasoning agent runs without code execution")
        return LlmAgent(
            name="reasoning_agent",
            model=MODEL_REASONING,
            instruction=REASONING_AGENT_PROMPT,
        )
    except Exception as e:
        print(f"[GeminiLive] ⚠  Could not create ReasoningAgent: {e} — disabling sub-agent")
        return None


# Build once at module load (shared across all sessions)
_reasoning_agent = _build_reasoning_agent()


# ──────────────────────────────────────────────────────────────────────────────
# GeminiLiveBridge
# ──────────────────────────────────────────────────────────────────────────────

class GeminiLiveBridge:
    """
    Bridges a browser WebSocket ↔ Gemini Live API session via Google ADK.

    Architecture mirrors the ADK bidi-demo sample:
      - upstream_task:   reads audio blobs from a Queue → LiveRequestQueue
      - downstream_task: iterates run_live() events → forwards audio/control to browser
    """

    def __init__(self, api_key: str, session, ws_send_bytes, ws_send_text):
        self.api_key = api_key
        self.session = session
        self._send_bytes = ws_send_bytes   # coroutine: send binary to browser
        self._send_text  = ws_send_text    # coroutine: send JSON text to browser
        self._closed     = False
        self._interrupted = False          # gate: when True, block audio forwarding

        # Shared queue: main.py pushes items here, upstream_task reads them
        self._ws_incoming_queue: asyncio.Queue = asyncio.Queue()

        # ADK live request queue for bidirectional streaming
        self._q = LiveRequestQueue()

    async def run(self):
        """
        Main entry point. Opens an ADK Runner session and drives
        the bidirectional stream concurrently.
        """
        os.environ["GOOGLE_API_KEY"] = self.api_key
        system_prompt = build_system_prompt(self.session)

        print(f"[GeminiLive] Starting session: model={MODEL_VOICE}")

        # 1. Build VoiceAgent with all custom tools + ReasoningAgent as sub_agent
        agent_kwargs = dict(
            name=APP_NAME,
            model=MODEL_VOICE,
            instruction=system_prompt,
            tools=ALL_TOOLS,
        )
        if _reasoning_agent is not None:
            agent_kwargs["sub_agents"] = [_reasoning_agent]
            print("[GeminiLive] Tri-agent routing enabled: VoiceAgent → ReasoningAgent")

        voice_agent = LlmAgent(**agent_kwargs)

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
        run_config = RunConfig(
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
                    jpeg = item.get("data", b"")
                    if jpeg:
                        try:
                            blob = types.Blob(data=jpeg, mime_type="image/jpeg")
                            self._q.send_realtime(blob)
                        except Exception as frame_err:
                            print(f"[upstream_task] frame send error: {frame_err}")

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

                # ── 6. Handle tool calls + agent transfers ────────────────
                if hasattr(event, "get_function_calls"):
                    calls = event.get_function_calls()
                    if calls:
                        await self._notify({"type": "status", "state": "thinking"})
                        for fc in calls:
                            # Detect ReasoningAgent delegation
                            tool_name = fc.name
                            if tool_name == "transfer_to_agent":
                                target = (fc.args or {}).get("agent_name", "reasoning_agent")
                                await self._notify({
                                    "type": "tool_call",
                                    "name": f"→ {target}",
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
