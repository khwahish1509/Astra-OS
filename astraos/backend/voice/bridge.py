"""
Astra OS — Gemini Live Voice Bridge
======================================
Bidirectional WebSocket ↔ Gemini Live Native Audio bridge.

Flow:
  Browser (WebSocket)  ←→  GeminiBridge  ←→  Gemini Live API
                                  ↓
                          ADK Coordinator Agent
                          (tool calls handled here)

Audio format:
  Input:  PCM 16-bit, 16kHz, mono  (raw bytes from browser)
  Output: PCM 16-bit, 24kHz, mono  (raw bytes → browser)

The bridge handles:
  - Gemini Live bidi session lifecycle
  - Audio chunk forwarding (browser → Gemini, Gemini → browser)
  - Tool call dispatch via ADK InMemoryRunner
  - Proactive alerts: when asked to brief the founder, injects alerts
    via send_client_content (text injection alongside audio)
  - Graceful shutdown: flushes final audio before closing
"""

from __future__ import annotations

import asyncio
import json
import traceback
from typing import TYPE_CHECKING, Callable

import google.genai as genai
from google.genai import types as genai_types
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai.types import (
    LiveConnectConfig,
    SpeechConfig,
    VoiceConfig,
    PrebuiltVoiceConfig,
    Content,
    Part,
    Blob,
)

if TYPE_CHECKING:
    from starlette.websockets import WebSocket
    from google.adk.agents import LlmAgent


# ── Constants ──────────────────────────────────────────────────────────────

GEMINI_MODEL    = "gemini-2.0-flash-live-001"
SEND_SAMPLE_RATE = 16_000   # Hz — browser sends 16kHz PCM
RECV_SAMPLE_RATE = 24_000   # Hz — Gemini outputs 24kHz PCM
VOICE_NAME      = "Aoede"   # Calm, clear, professional-sounding voice


class GeminiBridge:
    """
    Manages one Gemini Live session for one WebSocket-connected founder.

    Lifecycle:
        bridge = GeminiBridge(ws, agent, api_key, session_id)
        await bridge.run()   # blocks until session ends
        await bridge.close() # cleanup
    """

    def __init__(
        self,
        websocket:  "WebSocket",
        agent:      "LlmAgent",
        api_key:    str,
        session_id: str,
        founder_id: str,
        on_tool_call: Callable | None = None,
    ):
        self._ws         = websocket
        self._agent      = agent
        self._api_key    = api_key
        self._session_id = session_id
        self._founder_id = founder_id
        self._on_tool_call = on_tool_call

        self._closed     = False
        self._audio_out_queue: asyncio.Queue[bytes] = asyncio.Queue()

        # ADK runner for tool call handling
        self._session_service = InMemorySessionService()
        self._runner = Runner(
            agent           = agent,
            app_name        = "astra_os",
            session_service = self._session_service,
        )

        # Gemini Live client
        self._genai_client = genai.Client(
            api_key    = api_key,
            http_options=genai_types.HttpOptions(api_version="v1beta"),
        )
        self._live_session = None

    # ── Public API ────────────────────────────────────────────────────────

    async def run(self) -> None:
        """
        Main entry point. Starts the Gemini Live session and runs until the
        WebSocket disconnects or the session ends.
        """
        live_config = LiveConnectConfig(
            response_modalities = ["AUDIO"],
            speech_config       = SpeechConfig(
                voice_config=VoiceConfig(
                    prebuilt_voice_config=PrebuiltVoiceConfig(voice_name=VOICE_NAME)
                )
            ),
            system_instruction  = Content(
                parts=[Part(text=self._agent.instruction)]
            ),
        )

        try:
            async with self._genai_client.aio.live.connect(
                model  = GEMINI_MODEL,
                config = live_config,
            ) as live_session:
                self._live_session = live_session
                print(f"[Bridge] 🎙️  Gemini Live session started ({self._session_id})")

                # Run audio send/receive concurrently
                await asyncio.gather(
                    self._receive_from_browser(),
                    self._receive_from_gemini(),
                    return_exceptions=True,
                )

        except Exception as e:
            if not self._closed:
                print(f"[Bridge] ❌ Session error: {e}")
                traceback.print_exc()
        finally:
            await self.close()

    async def close(self) -> None:
        """Gracefully close the bridge."""
        if self._closed:
            return
        self._closed = True
        print(f"[Bridge] 🔒 Closing session {self._session_id}")

    async def inject_text(self, text: str) -> None:
        """
        Inject text into the Gemini Live session (e.g. proactive alerts).
        Gemini will speak the text on its next turn.
        """
        if self._live_session and not self._closed:
            try:
                await self._live_session.send_client_content(
                    turns=Content(
                        role  = "user",
                        parts = [Part(text=text)],
                    ),
                    turn_complete=True,
                )
            except Exception as e:
                print(f"[Bridge] ⚠️  inject_text failed: {e}")

    # ── Audio I/O ─────────────────────────────────────────────────────────

    async def _receive_from_browser(self) -> None:
        """
        Read audio chunks from the WebSocket and forward to Gemini Live.
        Also handles text control messages (e.g. {"type": "interrupt"}).
        """
        try:
            while not self._closed:
                message = await self._ws.receive()

                if message.get("type") == "websocket.disconnect":
                    break

                # Binary message → PCM audio chunk
                if "bytes" in message and message["bytes"]:
                    audio_chunk = message["bytes"]
                    if self._live_session:
                        await self._live_session.send_realtime_input(
                            audio=Blob(
                                data      = audio_chunk,
                                mime_type = f"audio/pcm;rate={SEND_SAMPLE_RATE}",
                            )
                        )

                # Text message → JSON control frame
                elif "text" in message and message["text"]:
                    try:
                        ctrl = json.loads(message["text"])
                        await self._handle_control(ctrl)
                    except json.JSONDecodeError:
                        pass

        except Exception as e:
            if not self._closed:
                print(f"[Bridge] ❌ receive_from_browser error: {e}")

    async def _receive_from_gemini(self) -> None:
        """
        Receive audio chunks and tool call responses from Gemini Live
        and forward audio to the browser WebSocket.
        """
        try:
            while not self._closed:
                if not self._live_session:
                    await asyncio.sleep(0.1)
                    continue

                async for response in self._live_session.receive():
                    if self._closed:
                        break

                    # Audio data → forward to browser
                    if response.data:
                        await self._ws.send_bytes(response.data)

                    # Tool call → dispatch via ADK runner
                    if response.tool_call:
                        await self._handle_tool_call(response.tool_call)

                    # Session ended signal
                    if response.server_content and response.server_content.turn_complete:
                        pass  # Normal turn end, keep listening

        except Exception as e:
            if not self._closed:
                print(f"[Bridge] ❌ receive_from_gemini error: {e}")

    # ── Tool Call Dispatch ─────────────────────────────────────────────────

    async def _handle_tool_call(self, tool_call) -> None:
        """
        Dispatch a Gemini tool call through the ADK runner and return results.
        """
        try:
            tool_responses = []

            for fc in tool_call.function_calls:
                fn_name = fc.name
                fn_args = dict(fc.args) if fc.args else {}

                print(f"[Bridge] 🔧 Tool call: {fn_name}({fn_args})")

                # Invoke via ADK runner session
                adk_session = await self._session_service.get_session(
                    app_name   = "astra_os",
                    user_id    = self._founder_id,
                    session_id = self._session_id,
                )

                if adk_session is None:
                    adk_session = await self._session_service.create_session(
                        app_name   = "astra_os",
                        user_id    = self._founder_id,
                        session_id = self._session_id,
                    )

                # Find the tool function by name and call it directly
                result = await self._dispatch_tool(fn_name, fn_args)

                tool_responses.append(
                    genai_types.LiveClientToolResponse(
                        function_responses=[
                            genai_types.FunctionResponse(
                                id     = fc.id,
                                name   = fn_name,
                                response={"result": result},
                            )
                        ]
                    )
                )

            # Send all tool responses back to Gemini Live
            if tool_responses and self._live_session:
                for tr in tool_responses:
                    await self._live_session.send_tool_response(tr)

        except Exception as e:
            print(f"[Bridge] ❌ tool call dispatch failed: {e}")
            traceback.print_exc()

    async def _dispatch_tool(self, fn_name: str, fn_args: dict):
        """Find and call the tool function by name from the agent's tools."""
        for tool in self._agent.tools:
            if hasattr(tool, "func") and tool.func.__name__ == fn_name:
                try:
                    result = await tool.func(**fn_args)
                    return result
                except Exception as e:
                    return {"error": str(e)}
            elif hasattr(tool, "name") and tool.name == fn_name:
                # google_search and other built-in tools
                if self._on_tool_call:
                    return await self._on_tool_call(fn_name, fn_args)
        return {"error": f"Tool '{fn_name}' not found"}

    # ── Control Messages ───────────────────────────────────────────────────

    async def _handle_control(self, ctrl: dict) -> None:
        """Handle JSON control messages from the browser."""
        msg_type = ctrl.get("type", "")

        if msg_type == "inject_alert":
            # Proactive alert injection from the server side
            text = ctrl.get("text", "")
            if text:
                await self.inject_text(text)

        elif msg_type == "set_context":
            # Update system context (e.g. new meeting started)
            pass

        elif msg_type == "ping":
            # Keep-alive
            await self._ws.send_text(json.dumps({"type": "pong"}))
