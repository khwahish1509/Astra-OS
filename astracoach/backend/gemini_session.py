"""
Gemini Live Session Manager
============================
Manages the lifecycle of a single Gemini Live API session.
Handles the bidirectional WebSocket bridge between the browser
client and the Gemini Live API.

Audio format contract:
  Browser → Backend:  PCM16, 16 kHz, mono  (binary WS frames)
  Backend → Browser:  PCM16, 24 kHz, mono  (binary WS frames)

Control messages (JSON text frames):
  Browser → Backend:
    { "type": "frame",      "data": "<base64-jpeg>" }   camera frame
    { "type": "text",       "text": "..." }              text input
    { "type": "end_turn" }                               explicit turn end

  Backend → Browser:
    { "type": "transcript", "role": "user"|"model", "text": "..." }
    { "type": "tool_call",  "name": "...", "status": "running"|"done" }
    { "type": "status",     "state": "listening"|"thinking"|"speaking" }
    { "type": "error",      "message": "..." }
    { "type": "ready" }                                  session is live

ROOT CAUSE NOTE:
  gemini.receive() is NOT an infinite async generator. It exits after ONE
  turn_complete event. We wrap it in a while loop so multi-turn conversations
  work correctly.
"""

import asyncio
import base64
import json
import os
import time
from typing import Callable

from google import genai
from google.genai import types

from agent_tools import LIVE_TOOL_DECLARATIONS, dispatch_tool


# ──────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-native-audio-latest")
MODEL_FALLBACK = "gemini-2.5-flash-native-audio-preview-12-2025"

# Universal wrapper appended to EVERY persona prompt.
UNIVERSAL_SUFFIX = """

─── Live Session Rules (always follow, regardless of persona) ───
Vision: when a message contains [VISION: ...], that is a real-time
description of what you see through the user's camera. React naturally —
weave it into conversation, never announce it robotically.

Tools available: web_search, evaluate_response, give_live_coaching,
remember_context, get_structured_plan. Use them when genuinely helpful.

Conversation style:
- Speak conversationally — no markdown, no bullet points in speech
- Keep responses concise (under 70 words) for natural real-time pacing
- Handle interruptions gracefully — acknowledge and continue
- You are always in character — never break the fourth wall
- React to what you see AND hear for a truly immersive experience
"""


def build_system_prompt(session) -> str:
    """Combine the user-defined persona prompt with universal live-session rules."""
    base = session.system_prompt.strip()
    if session.user_name:
        base = f"The user's name is {session.user_name}. Address them by name naturally.\n\n" + base
    return base + UNIVERSAL_SUFFIX


# ──────────────────────────────────────────────────────────────
# GeminiLiveBridge
# ──────────────────────────────────────────────────────────────

class GeminiLiveBridge:
    """
    Bridges a browser WebSocket ↔ Gemini Live API session.
    One instance per active interview.
    """

    def __init__(self, api_key: str, session, ws_send_bytes, ws_send_text):
        self.api_key = api_key
        self.session = session
        self._send_bytes = ws_send_bytes   # coroutine: send binary to browser
        self._send_text  = ws_send_text    # coroutine: send JSON text to browser

        # Queue: items from browser that need to go to Gemini
        self._to_gemini: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._closed = False

    # ── Public interface ──────────────────────────────────────

    async def run(self):
        """
        Main entry point. Opens a Gemini Live session and drives
        the browser ↔ Gemini bidirectional stream until closed.
        """
        client = genai.Client(api_key=self.api_key)

        voice_name = getattr(self.session, "voice", "Aoede")
        system_prompt = build_system_prompt(self.session)

        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=voice_name,
                    )
                )
            ),
            system_instruction=types.Content(
                role="user",
                parts=[types.Part(text=system_prompt)],
            ),
            tools=[
                types.Tool(function_declarations=[
                    types.FunctionDeclaration(**decl)
                    for decl in LIVE_TOOL_DECLARATIONS
                ])
            ],
            # Enable both input and output transcription
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
        )

        try:
            async with client.aio.live.connect(model=MODEL, config=config) as gemini:
                await self._notify({"type": "ready"})
                await self._notify({"type": "status", "state": "listening"})

                await asyncio.gather(
                    self._browser_to_gemini(gemini),
                    self._gemini_to_browser(gemini),
                )
        except Exception as e:
            print(f"[GeminiLive] Session error: {e}")
            # Try fallback model if available
            if MODEL_FALLBACK and MODEL_FALLBACK != MODEL:
                print(f"[GeminiLive] Retrying with fallback: {MODEL_FALLBACK}")
                config_fb = types.LiveConnectConfig(
                    response_modalities=["AUDIO"],
                    speech_config=config.speech_config,
                    system_instruction=config.system_instruction,
                    tools=config.tools,
                    input_audio_transcription=config.input_audio_transcription,
                    output_audio_transcription=config.output_audio_transcription,
                )
                async with client.aio.live.connect(model=MODEL_FALLBACK, config=config_fb) as gemini:
                    await self._notify({"type": "ready"})
                    await self._notify({"type": "status", "state": "listening"})
                    await asyncio.gather(
                        self._browser_to_gemini(gemini),
                        self._gemini_to_browser(gemini),
                    )
            else:
                await self._notify({"type": "error", "message": str(e)})

    async def push(self, item):
        """Called by WebSocket handler to push data destined for Gemini."""
        if not self._closed:
            try:
                self._to_gemini.put_nowait(item)
            except asyncio.QueueFull:
                pass  # drop frame under backpressure

    async def close(self):
        self._closed = True
        try:
            self._to_gemini.put_nowait(None)  # sentinel
        except asyncio.QueueFull:
            pass

    # ── Internal loops ────────────────────────────────────────

    async def _browser_to_gemini(self, gemini):
        """Drain the queue and forward everything to Gemini Live."""
        try:
            while not self._closed:
                try:
                    item = await asyncio.wait_for(self._to_gemini.get(), timeout=0.1)
                except asyncio.TimeoutError:
                    continue

                if item is None:  # shutdown sentinel
                    break

                item_type = item.get("type") if isinstance(item, dict) else "audio"

                if item_type == "audio":
                    # Binary PCM16 16kHz chunk
                    pcm = item.get("data", b"")
                    if pcm:
                        blob = types.Blob(data=pcm, mime_type="audio/pcm;rate=16000")
                        await gemini.send_realtime_input(media=blob)

                elif item_type == "frame":
                    # JPEG camera frame (for vision)
                    jpeg = item.get("data", b"")
                    if jpeg:
                        blob = types.Blob(data=jpeg, mime_type="image/jpeg")
                        await gemini.send_realtime_input(media=blob)

                elif item_type == "text":
                    # Text message (used for system-level injections)
                    text = item.get("text", "")
                    if text:
                        await gemini.send_client_content(
                            turns=types.Content(role="user", parts=[types.Part.from_text(text=text)]),
                            turn_complete=True
                        )

                elif item_type == "end_turn":
                    # Explicit end-of-turn signal
                    await gemini.send_client_content(turn_complete=True)

        except Exception as e:
            import traceback
            print(f"[_browser_to_gemini crash]: {e}")
            traceback.print_exc()

    async def _gemini_to_browser(self, gemini):
        """
        Receive everything from Gemini Live and forward to browser.

        CRITICAL FIX: gemini.receive() is NOT an infinite generator.
        It exits after ONE turn_complete event. We wrap it in a while
        loop so that after each turn completes, we restart listening
        for the next turn. This enables multi-turn conversation.
        """
        try:
            while not self._closed:
                # Each call to gemini.receive() handles one turn.
                # It yields events until turn_complete=True, then exits.
                async for response in gemini.receive():

                    # ── Audio output ─────────────────────────────────
                    if response.data:
                        await self._send_bytes(response.data)

                    # ── Server content (transcripts) ─────────────────
                    sc = getattr(response, 'server_content', None)
                    if sc:
                        # Output audio transcription (what the model says)
                        out_trans = getattr(sc, 'output_transcription', None)
                        if out_trans:
                            text = getattr(out_trans, 'text', None)
                            if text:
                                text = text.strip()
                                if text:
                                    self.session_store_add_transcript("model", text)
                                    await self._notify({
                                        "type": "transcript",
                                        "role": "model",
                                        "text": text,
                                    })

                        # Input audio transcription (what the user said)
                        in_trans = getattr(sc, 'input_transcription', None)
                        if in_trans:
                            text = getattr(in_trans, 'text', None)
                            if text:
                                text = text.strip()
                                if text:
                                    self.session_store_add_transcript("user", text)
                                    await self._notify({
                                        "type": "transcript",
                                        "role": "user",
                                        "text": text,
                                    })

                        # Generation started → model is speaking
                        if getattr(sc, 'generation_complete', None) is False:
                            await self._notify({"type": "status", "state": "speaking"})

                        # Turn completion → back to listening state
                        # (DO NOT break here — let the async-for exit naturally,
                        # then the while loop restarts for the next turn)
                        if getattr(sc, 'turn_complete', False):
                            await self._notify({"type": "status", "state": "listening"})

                    # ── Tool calls ────────────────────────────────────
                    tool_call = getattr(response, 'tool_call', None)
                    if tool_call:
                        for fn_call in tool_call.function_calls:
                            await self._notify({
                                "type": "tool_call",
                                "name": fn_call.name,
                                "status": "running",
                            })
                            await self._notify({"type": "status", "state": "thinking"})

                            # Execute the tool
                            result = dispatch_tool(fn_call.name, dict(fn_call.args))

                            # Return result to Gemini
                            await gemini.send_tool_response(
                                responses=[
                                    types.FunctionResponse(
                                        id=fn_call.id,
                                        name=fn_call.name,
                                        response={"output": result},
                                    )
                                ]
                            )

                            await self._notify({
                                "type": "tool_call",
                                "name": fn_call.name,
                                "status": "done",
                            })
                # The async-for loop exited (one turn done).
                # The while loop now restarts receive() for the next turn.

        except Exception as e:
            import traceback
            print(f"[_gemini_to_browser crash]: {e}")
            traceback.print_exc()

    # ── Helpers ───────────────────────────────────────────────

    async def _notify(self, payload: dict):
        try:
            await self._send_text(json.dumps(payload))
        except Exception:
            pass

    def session_store_add_transcript(self, role: str, text: str):
        """Callback — filled in by main.py at construction time."""
        pass  # overridden externally
