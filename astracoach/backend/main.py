"""
AstraCoach — FastAPI Server
============================
100% Google-native AI Interview Coach.
No third-party avatar services. Gemini Live IS the voice.

Key endpoints:
  POST /api/session/create     — create interview session
  GET  /api/session/{id}       — get session state + transcript
  POST /api/session/{id}/end   — tear down session
  WS   /ws/interview/{id}      — THE main audio/vision bridge
  GET  /health                 — Cloud Run health check

WebSocket protocol (binary + text frames):
  Binary frames  = raw PCM16 audio (browser → server → Gemini, and back)
  Text frames    = JSON control messages (both directions)

See gemini_session.py for full message format docs.
"""

import asyncio
import base64
import json
import os
import time
from contextlib import asynccontextmanager
from typing import Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

from session_store import SessionStore
from gemini_session import GeminiLiveBridge

load_dotenv()

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY", "")

# ─────────────────────────────────────────────
# App lifecycle
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 AstraCoach starting...")
    print(f"   Model: {os.getenv('GEMINI_MODEL', 'gemini-2.5-flash-native-audio-latest')}")
    yield
    print("AstraCoach shutting down.")


app = FastAPI(
    title="AstraCoach API",
    description="AI Interview Coach powered 100% by Google Gemini Live + ADK. No third-party services.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# Singletons
# ─────────────────────────────────────────────

store = SessionStore()

# Active Gemini Live bridges: session_id → GeminiLiveBridge
active_bridges: dict[str, GeminiLiveBridge] = {}


# ─────────────────────────────────────────────
# Request models
# ─────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    persona_name:  str  = "AI Agent"           # display name shown in UI
    system_prompt: str  = "You are a helpful AI assistant."  # THE full persona prompt
    voice:         str  = "Aoede"              # Gemini Live voice
    user_name:     str  = ""                   # optional — personalises agent


class EndSessionRequest(BaseModel):
    session_id: str


# Available Gemini Live voices (for UI dropdown)
AVAILABLE_VOICES = [
    {"id": "Aoede",  "label": "Aoede  — Warm, natural"},
    {"id": "Puck",   "label": "Puck   — Friendly, conversational"},
    {"id": "Charon", "label": "Charon — Deep, authoritative"},
    {"id": "Kore",   "label": "Kore   — Neutral, professional"},
    {"id": "Fenrir", "label": "Fenrir — Warm, approachable"},
    {"id": "Leda",   "label": "Leda   — Clear, precise"},
    {"id": "Orus",   "label": "Orus   — Calm, measured"},
    {"id": "Zephyr", "label": "Zephyr — Bright, energetic"},
]


# ─────────────────────────────────────────────
# REST Endpoints
# ─────────────────────────────────────────────

@app.get("/api/voices")
async def list_voices():
    """Return available Gemini Live voices."""
    return {"voices": AVAILABLE_VOICES}


@app.post("/api/session/create")
async def create_session(req: CreateSessionRequest):
    """
    Create a new interview session and return the session ID.
    The client then connects via WebSocket /ws/interview/{session_id}
    to start the live audio/video stream.
    """
    if not GOOGLE_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GOOGLE_API_KEY not configured. Set it in .env or as an env var.",
        )

    session_id = f"ac_{int(time.time() * 1000)}"

    store.create(
        session_id=session_id,
        persona_name=req.persona_name,
        system_prompt=req.system_prompt,
        voice=req.voice,
        user_name=req.user_name,
    )

    return {
        "success":    True,
        "session_id": session_id,
        "ws_url":     f"/ws/interview/{session_id}",
        "config": {
            "persona_name":  req.persona_name,
            "voice":         req.voice,
            "user_name":     req.user_name,
        },
    }


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """Get session state — including live transcript."""
    s = store.get(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id":   session_id,
        "persona_name": s.persona_name,
        "voice":        s.voice,
        "is_active":    s.is_active,
        "transcript":   s.transcript[-20:],
        "memories":     s.memories,
        "created_at":   s.created_at,
    }


@app.post("/api/session/{session_id}/end")
async def end_session(session_id: str):
    """Gracefully end an interview session."""
    bridge = active_bridges.pop(session_id, None)
    if bridge:
        await bridge.close()

    s = store.get(session_id)
    if s:
        s.is_active = False
    store.delete(session_id)

    return {"success": True}


# ─────────────────────────────────────────────
# WebSocket — The Core
# ─────────────────────────────────────────────

@app.websocket("/ws/interview/{session_id}")
async def interview_websocket(ws: WebSocket, session_id: str):
    """
    Real-time bidirectional bridge:  browser ↔ Gemini Live API

    Binary frames:
      browser → server: PCM16 16kHz mono audio (microphone)
      server → browser: PCM16 24kHz mono audio (Gemini speaking)

    Text frames (JSON):
      browser → server:
        {"type":"frame",    "data":"<base64-jpeg>"}    camera frame
        {"type":"text",     "text":"..."}              text injection
        {"type":"end_turn"}                            explicit EOT
        {"type":"ping"}

      server → browser:
        {"type":"ready"}                               Gemini session live
        {"type":"status",   "state":"listening|thinking|speaking"}
        {"type":"transcript","role":"user|model","text":"..."}
        {"type":"tool_call","name":"...","status":"running|done"}
        {"type":"error",    "message":"..."}
        {"type":"pong"}
    """
    await ws.accept()

    session = store.get(session_id)
    if not session:
        await ws.send_text(json.dumps({"type": "error", "message": "Session not found"}))
        await ws.close()
        return

    # ── Build the bridge ──────────────────────────────────────
    bridge = GeminiLiveBridge(
        api_key=GOOGLE_API_KEY,
        session=session,
        ws_send_bytes=ws.send_bytes,
        ws_send_text=ws.send_text,
    )

    # Wire up transcript persistence
    def _add_transcript(role: str, text: str):
        store.add_transcript(session_id, role, text)

    bridge.session_store_add_transcript = _add_transcript
    active_bridges[session_id] = bridge

    # ── Run Gemini Live in background ─────────────────────────
    gemini_task = asyncio.create_task(bridge.run())

    # ── Receive from browser ──────────────────────────────────
    try:
        while True:
            msg = await ws.receive()

            if msg["type"] == "websocket.disconnect":
                break

            # Binary = PCM audio chunk from microphone
            if "bytes" in msg and msg["bytes"]:
                await bridge.push({"type": "audio", "data": msg["bytes"]})

            # Text = JSON control/camera message
            elif "text" in msg and msg["text"]:
                try:
                    data = json.loads(msg["text"])
                    msg_type = data.get("type", "")

                    if msg_type == "ping":
                        await ws.send_text(json.dumps({"type": "pong"}))

                    elif msg_type == "frame":
                        # Camera frame — decode base64 → bytes
                        raw = data.get("data", "")
                        if raw:
                            jpeg_bytes = base64.b64decode(raw)
                            # Inject vision context into text turn
                            vision_note = store.get_vision(session_id)
                            if not vision_note:
                                # Trigger vision analysis via the frame
                                await bridge.push({
                                    "type": "frame",
                                    "data": jpeg_bytes,
                                })
                            store.update_vision(session_id, "frame received")

                    elif msg_type == "text":
                        await bridge.push(data)

                    elif msg_type == "end_turn":
                        await bridge.push({"type": "end_turn"})

                    elif msg_type == "activity_start":
                        await bridge.push({"type": "activity_start"})

                    elif msg_type == "vision_inject":
                        # Frontend sends analysed vision note for injection
                        note = data.get("note", "")
                        if note:
                            store.update_vision(session_id, note)
                            # Inject as silent text context into conversation
                            await bridge.push({
                                "type": "text",
                                "text": f"[VISION: {note}]",
                            })

                except json.JSONDecodeError:
                    pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] Error for {session_id}: {e}")
    finally:
        # Clean up
        gemini_task.cancel()
        try:
            await gemini_task
        except (asyncio.CancelledError, Exception):
            pass
        active_bridges.pop(session_id, None)
        if store.get(session_id):
            store.get(session_id).is_active = False


# ─────────────────────────────────────────────
# Health + Info
# ─────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "AstraCoach",
        "version": "2.0.0",
        "active_sessions": store.active_count(),
        "active_bridges": len(active_bridges),
    }


@app.get("/api/info")
async def info():
    return {
        "service": "AstraCoach — AI Interview Coach",
        "description": "100% Google: Gemini 2.5 Flash Native Audio + ADK + Cloud Run",
        "model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash-native-audio-latest"),
        "docs": "/docs",
    }


# ─────────────────────────────────────────────
# Serve React frontend (production only)
# ─────────────────────────────────────────────

_static = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(_static):
    app.mount("/", StaticFiles(directory=_static, html=True), name="static")


# ─────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=os.getenv("ENV") == "development",
        log_level="info",
        ws_ping_interval=20,
        ws_ping_timeout=60,
    )
