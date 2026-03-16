"""
Astra OS — The Founder's Operating System
============================================
100% Google-native AI Chief of Staff for startup founders.
Gemini 2.5 Flash Native Audio + ADK + Firestore Vector Search.

Voice session endpoints (existing):
  POST /api/session/create     — create voice session
  WS   /ws/interview/{id}      — bidirectional audio/vision bridge
  POST /api/session/{id}/end   — tear down session

Brain endpoints (new):
  POST /onboard                — save founder profile
  GET  /brain/summary          — brain state overview
  GET  /brain/insights         — list active insights
  GET  /brain/alerts           — pending alerts
  POST /brain/scan             — trigger email scan
  POST /brain/monitor          — trigger risk monitor
  GET  /auth/gmail             — Gmail OAuth flow
  GET  /health                 — health check
"""

import asyncio
import base64
import json
import os
import time
import uuid
import re
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

GOOGLE_API_KEY      = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY", "")
FIRESTORE_PROJECT   = os.getenv("FIRESTORE_PROJECT_ID", "")
CREDENTIALS_PATH    = os.getenv("GOOGLE_CREDENTIALS_PATH", "credentials.json")
TOKEN_PATH          = os.getenv("GMAIL_TOKEN_PATH", "gmail_token.json")
FOUNDER_ID          = os.getenv("FOUNDER_ID", "default_founder")
APP_NAME            = "astra_coach"  # must match gemini_session.APP_NAME
EMAIL_SCAN_INTERVAL = int(os.getenv("EMAIL_SCAN_INTERVAL_MINUTES", "15"))
RISK_CHECK_INTERVAL = int(os.getenv("RISK_CHECK_INTERVAL_MINUTES", "30"))

# Avatar generation model — confirmed working high-fidelity image models
# Standard Imagen 4 model is: imagen-4.0-generate-001
AVATAR_MODEL = os.getenv("AVATAR_MODEL", "imagen-4.0-generate-001")

# ─────────────────────────────────────────────
# Astra OS Brain singletons (initialized in lifespan)
# ─────────────────────────────────────────────

_brain_store = None
_embeddings  = None
_gmail       = None
_calendar    = None
_drive       = None
_tasks       = None
_contacts    = None
_email_scanner = None
_risk_monitor  = None
_brain_tool_fns = None   # dict of {name: async_fn} from brain_tools.build_tools()
_memory_service = None   # FirestoreMemoryService for long-term memory

# ─────────────────────────────────────────────
# App lifecycle
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _brain_store, _embeddings, _gmail, _calendar, _drive, _tasks, _contacts, _email_scanner, _risk_monitor, _brain_tool_fns, _memory_service

    print("🚀 Astra OS starting...")
    print(f"   Voice Model: {os.getenv('GEMINI_MODEL', 'gemini-2.5-flash-native-audio-latest')}")

    # ── Initialize Company Brain (if Firestore is configured) ──
    if FIRESTORE_PROJECT and GOOGLE_API_KEY:
        try:
            from brain.store import CompanyBrainStore
            from brain.embeddings import EmbeddingPipeline
            from integrations.gmail_client import GmailClient
            from integrations.calendar_client import CalendarClient
            from integrations.drive_client import DriveClient
            from integrations.tasks_client import TasksClient
            from integrations.contacts_client import ContactsClient

            _brain_store = CompanyBrainStore(project_id=FIRESTORE_PROJECT)
            _embeddings  = EmbeddingPipeline(api_key=GOOGLE_API_KEY)
            _gmail       = GmailClient(CREDENTIALS_PATH, TOKEN_PATH)
            _calendar    = CalendarClient(CREDENTIALS_PATH, TOKEN_PATH)
            _drive       = DriveClient(CREDENTIALS_PATH, TOKEN_PATH)
            _tasks       = TasksClient(CREDENTIALS_PATH, TOKEN_PATH)
            _contacts    = ContactsClient(CREDENTIALS_PATH, TOKEN_PATH)

            # Initialize long-term memory service (FirestoreMemoryService)
            try:
                from memory.firestore_memory_service import FirestoreMemoryService
                _memory_service = FirestoreMemoryService(
                    project_id=FIRESTORE_PROJECT,
                    api_key=GOOGLE_API_KEY,
                )
                print("[Astra OS] 🧠 Long-term memory service initialized (Firestore + Gemini embeddings)")
            except Exception as mem_err:
                print(f"[Astra OS] ⚠️  Memory service init failed: {mem_err} — continuing without long-term memory")
                _memory_service = None

            # Start background agents if Gmail is authenticated
            from agents.background import EmailScannerAgent, RiskMonitorAgent
            _email_scanner = EmailScannerAgent(
                store=_brain_store, embeddings=_embeddings, gmail=_gmail,
                api_key=GOOGLE_API_KEY, founder_id=FOUNDER_ID,
                scan_interval_minutes=EMAIL_SCAN_INTERVAL,
            )
            _risk_monitor = RiskMonitorAgent(
                store=_brain_store, api_key=GOOGLE_API_KEY,
                founder_id=FOUNDER_ID, check_interval_minutes=RISK_CHECK_INTERVAL,
            )

            # Build brain tools for voice session injection
            from agents.brain_tools import ToolDeps, build_tools
            tool_deps = ToolDeps(
                store=_brain_store, embeddings=_embeddings,
                gmail=_gmail, calendar=_calendar, founder_id=FOUNDER_ID,
                drive=_drive, tasks=_tasks, contacts=_contacts,
                memory_service=_memory_service, app_name=APP_NAME,
            )
            _brain_tool_fns = build_tools(tool_deps)
            print(f"[Astra OS] 🧠 {len(_brain_tool_fns)} brain tools built for voice session")

            if _gmail.is_authenticated():
                _email_scanner.start()
                _risk_monitor.start()
                print("[Astra OS] ✅ Brain + background agents running")
            else:
                print("[Astra OS] ⚠️  Gmail not authenticated — visit /auth/gmail")

        except Exception as e:
            print(f"[Astra OS] ⚠️  Brain init failed: {e} — voice still works")
    else:
        print("[Astra OS] ℹ️  Brain disabled (no FIRESTORE_PROJECT_ID or GOOGLE_API_KEY)")

    print("[Astra OS] ✅ Ready")
    yield

    # Shutdown background agents
    if _email_scanner:
        await _email_scanner.stop()
    if _risk_monitor:
        await _risk_monitor.stop()
    print("[Astra OS] 🛑 Shut down.")


app = FastAPI(
    title="Astra OS — The Founder's Operating System",
    description="AI Chief of Staff: Gemini 2.5 Flash Native Audio + Company Brain + Firestore Vector Search",
    version="3.0.0",
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
    voice:         str  = "Puck"               # Gemini Live voice (Male default)
    user_name:     str  = ""                   # optional — personalises agent


class EndSessionRequest(BaseModel):
    session_id: str


class GenerateAvatarRequest(BaseModel):
    persona_description: str = "a professional AI assistant"


# Available Gemini Live voices (for UI dropdown)
AVAILABLE_VOICES = [
    {"id": "Puck",   "label": "Puck   — Male, Friendly & Conversational"},
    {"id": "Charon", "label": "Charon — Male, Deep & Authoritative"},
    {"id": "Fenrir", "label": "Fenrir — Male, Warm & Approachable"},
    {"id": "Orus",   "label": "Orus   — Male, Calm & Measured"},
    {"id": "Aoede",  "label": "Aoede  — Female, Warm & Natural"},
    {"id": "Kore",   "label": "Kore   — Female, Neutral & Professional"},
    {"id": "Leda",   "label": "Leda   — Female, Clear & Precise"},
    {"id": "Zephyr", "label": "Zephyr — Female, Bright & Energetic"},
]


# ─────────────────────────────────────────────
# REST Endpoints
# ─────────────────────────────────────────────

@app.get("/api/voices")
async def list_voices():
    """Return available Gemini Live voices."""
    return {"voices": AVAILABLE_VOICES}


@app.post("/api/generate-avatar")
async def generate_avatar(req: GenerateAvatarRequest):
    """
    Generate a photorealistic AI portrait for the session avatar.

    Uses Imagen 3 (imagen-3.0-generate-002) as primary model — the high-fidelity
    "Nano Banana Pro" image model. Falls back to Gemini 2.0 Flash image generation
    if Imagen is unavailable for the API key.

    Returns:
        { success: true, image: "<base64_string>", mime_type: "image/png", model: "<model_used>" }

    The base64 string is a raw PNG/JPEG with no data-URI prefix — the frontend
    constructs `data:<mime>;base64,<image>` for the canvas Image object.
    """
    if not GOOGLE_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GOOGLE_API_KEY not configured. Cannot generate avatar.",
        )

    description = (req.persona_description or "a professional AI assistant").strip()

    # Craft a prompt optimised for portrait lip-sync:
    #   - Neutral CLOSED mouth is critical — the JS canvas animation opens it
    #   - Front-facing is critical — side profiles break the face-slice technique
    #   - Plain background prevents visual noise behind the avatar rings
    prompt = (
        f"A photorealistic, front-facing medium-shot portrait of {description}. "
        "Professional studio lighting, LIGHT studio grey bokeh background (softly defocused). "
        "Subject looking directly at the camera with a neutral resting expression "
        "and lips closed in a relaxed, natural position. "
        "Showing head, shoulders and chest, cinematic quality upper-body portrait."
    )

    from google import genai as _genai
    from google.genai import types as _gtypes

    client = _genai.Client(api_key=GOOGLE_API_KEY)

    # ── Attempt 1: Imagen 3 / 4 (high quality) ───────────────────────────
    try:
        print(f"[Avatar] Generating portrait with {AVATAR_MODEL} — desc: {description[:50]}")
        response = client.models.generate_images(
            model=AVATAR_MODEL,
            prompt=prompt,
            config=_gtypes.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio="1:1",
                safety_filter_level="block_low_and_above",
                person_generation="allow_adult",
            ),
        )
        if not response.generated_images:
            raise ValueError(f"Imagen {AVATAR_MODEL} returned no images")
            
        img_bytes = response.generated_images[0].image.image_bytes
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        print(f"[Avatar] ✅ Portrait generated ({len(img_bytes):,} bytes) via {AVATAR_MODEL}")
        return {
            "success":   True,
            "image":     b64,
            "mime_type": "image/png",
            "model":     AVATAR_MODEL,
        }

    except Exception as img_err:
        print(f"[Avatar] {AVATAR_MODEL} failed ({img_err.__class__.__name__}: {img_err})")
        # Try fast fallback if standard imagen failed
        if AVATAR_MODEL == "imagen-4.0-generate-001":
            try:
                print("[Avatar] Trying fast fallback: imagen-4.0-fast-generate-001")
                response = client.models.generate_images(
                    model="imagen-4.0-fast-generate-001",
                    prompt=prompt,
                    config=_gtypes.GenerateImagesConfig(
                        number_of_images=1,
                        aspect_ratio="1:1",
                    ),
                )
                img_bytes = response.generated_images[0].image.image_bytes
                b64 = base64.b64encode(img_bytes).decode("utf-8")
                return {
                    "success": True, "image": b64, 
                    "mime_type": "image/png", "model": "imagen-4.0-fast-generate-001"
                }
            except: pass

    # ── Attempt 2: Gemini 2.5/2.0 Flash with image output ─────────────────
    # Native multimodal generation fallback
    for fallback_model in ["gemini-2.5-flash-image", "gemini-2.0-flash"]:
        try:
            print(f"[Avatar] Trying fallback model: {fallback_model}")
            response = client.models.generate_content(
                model=fallback_model,
                contents=prompt,
                config=_gtypes.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                ),
            )
            # Find image part in candidates
            for candidate in getattr(response, 'candidates', []):
                for part in getattr(candidate.content, 'parts', []):
                    # Check for inline_data (SDK v1.x)
                    if hasattr(part, 'inline_data') and part.inline_data:
                        img_bytes = part.inline_data.data
                        mime = part.inline_data.mime_type or "image/png"
                        b64 = base64.b64encode(img_bytes).decode("utf-8")
                        print(f"[Avatar] ✅ Portrait generated via {fallback_model}")
                        return {
                            "success": True, "image": b64, 
                            "mime_type": mime, "model": fallback_model
                        }
                    # Check for external_data or other part types if SDK changes
        except Exception as gem_err:
            print(f"[Avatar] Fallback {fallback_model} failed: {gem_err}")

    # If we got here, everything failed — return a graceful "no image" response
    # instead of a 500 so the frontend falls back to the SVG orb cleanly.
    print("[Avatar] ⚠️  All image models failed — returning fallback (SVG orb will be used)")
    return {
        "success": False,
        "image": None,
        "mime_type": None,
        "model": "none",
        "fallback": True,
        "reason": "All image generation models unavailable. Upgrade to a paid Google AI plan for Imagen, or wait for free-tier quota to reset for Gemini Flash.",
    }


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
        # bridge.close() schedules summarize_and_persist as a fire-and-forget
        # background task. We must NOT delete the session from the store before
        # this task runs, or it will fail to find the transcript.
        # Since we now pass session=self.session directly inside close(), the
        # task holds a direct reference to the AgentSession object and is
        # safe even if we call store.delete() immediately after. But we still
        # mark inactive first to be explicit about state.
        await bridge.close()

    s = store.get(session_id)
    if s:
        s.is_active = False
    # NOTE: Do NOT call store.delete() here — the summarization background task
    # may still be running and needs the session's transcript. The session will
    # be cleaned up naturally (in-memory: on restart; Firestore: marked inactive).
    # store.delete(session_id)  ← REMOVED to prevent race condition

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
        {"type":"frame",    "data":"<base64-jpeg>"}                      camera frame (320×240)
        {"type":"image",    "mimeType":"image/jpeg","data":"<b64>"}       full-desktop screen share (768×768)
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
        store=store,                      # enables Contextual Recall + post-session summarization
        user_id=session.user_name or "",  # normalised to stable Firestore key inside bridge
        brain_tools=_brain_tool_fns,      # 45 brain tools for Astra OS voice session
        brain_store=_brain_store,         # for proactive alerts on session start
        founder_id=FOUNDER_ID,            # for querying brain state
        memory_service=_memory_service,   # long-term memory (Firestore + episodic)
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
                        # Camera frame — decode base64 JPEG → bytes and forward every frame
                        raw = data.get("data", "")
                        if raw:
                            jpeg_bytes = base64.b64decode(raw)
                            await bridge.push({
                                "type": "frame",
                                "data": jpeg_bytes,
                            })
                            store.update_vision(session_id, "camera frame received")

                    elif msg_type == "image":
                        # Full-desktop screen share frame (768×768 squished JPEG).
                        # Distinct from camera "frame":
                        #   - Forwarded to Gemini Live as a realtime JPEG blob (ambient awareness)
                        #   - Also cached on the bridge so the ReasoningAgent can access
                        #     the latest full-res JPEG when asked to "read this code"
                        raw       = data.get("data", "")
                        mime_type = data.get("mimeType", "image/jpeg")
                        if raw:
                            jpeg_bytes = base64.b64decode(raw)
                            await bridge.push({
                                "type":      "image",
                                "data":      jpeg_bytes,
                                "mime_type": mime_type,
                            })
                            store.update_vision(session_id, "screen frame received")

                    elif msg_type == "text":
                        await bridge.push(data)

                    elif msg_type == "end_turn":
                        await bridge.push({"type": "end_turn"})

                    elif msg_type == "activity_start":
                        await bridge.push({"type": "activity_start"})

                    elif msg_type == "activity_end":
                        await bridge.push({"type": "activity_end"})

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
        # ── Trigger post-session summarization before tearing down ───────────
        # This fires when the user closes the browser tab OR the WS disconnects.
        # bridge.close() schedules summarize_and_persist as a fire-and-forget task.
        # It is idempotent — the _closed flag prevents double-scheduling if
        # end_session() already called it.
        if not bridge._closed:
            await bridge.close()
            print(f"[WS] bridge.close() triggered from WebSocket disconnect for {session_id}")

        # Cancel the Gemini Live background task
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
        "service": "Astra OS",
        "version": "3.0.0",
        "active_sessions": store.active_count(),
        "active_bridges": len(active_bridges),
        "brain_active": _brain_store is not None,
        "gmail_auth": _gmail.is_authenticated() if _gmail else False,
        "integrations": {
            "drive":    _drive is not None,
            "tasks":    _tasks is not None,
            "contacts": _contacts is not None,
            "memory":   _memory_service is not None,
        },
        "background_agents": {
            "email_scanner": _email_scanner._running if _email_scanner else False,
            "risk_monitor":  _risk_monitor._running if _risk_monitor else False,
        },
    }


@app.get("/api/info")
async def info():
    return {
        "service": "Astra OS — The Founder's Operating System",
        "description": "AI Chief of Staff: Gemini 2.5 Flash Native Audio + Company Brain + Firestore Vector Search",
        "model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash-native-audio-latest"),
        "docs": "/docs",
    }


# ─────────────────────────────────────────────
# Gmail Auth
# ─────────────────────────────────────────────

@app.get("/auth/gmail")
async def authenticate_gmail():
    """Trigger Gmail OAuth flow — opens browser on first run."""
    if not _gmail:
        raise HTTPException(503, "Gmail client not initialized")
    try:
        await asyncio.to_thread(_gmail._build_service)
        # Start background agents if they weren't running
        if _email_scanner and not _email_scanner._running:
            _email_scanner.start()
        if _risk_monitor and not _risk_monitor._running:
            _risk_monitor.start()
        return {"status": "authenticated", "message": "Gmail connected successfully"}
    except Exception as e:
        raise HTTPException(500, f"OAuth flow failed: {e}")


@app.get("/auth/status")
async def auth_status():
    return {"gmail_authenticated": _gmail.is_authenticated() if _gmail else False}


# ─────────────────────────────────────────────
# Founder Onboarding
# ─────────────────────────────────────────────

class OnboardRequest(BaseModel):
    name:            str
    email:           str
    company_name:    str
    company_context: str
    team_members:    list[dict] = []
    timezone:        str = "UTC"


@app.post("/onboard")
async def onboard_founder(req: OnboardRequest):
    """Save or update the founder's profile."""
    if not _brain_store:
        raise HTTPException(503, "Brain store not initialized")
    from brain.models import FounderProfile
    profile = FounderProfile(
        founder_id=FOUNDER_ID, name=req.name, email=req.email,
        company_name=req.company_name, company_context=req.company_context,
        team_members=req.team_members, timezone=req.timezone,
    )
    await _brain_store.save_founder(profile)
    return {"status": "ok", "founder_id": FOUNDER_ID}


@app.get("/founder")
async def get_founder():
    if not _brain_store:
        raise HTTPException(503, "Brain store not initialized")
    profile = await _brain_store.get_founder(FOUNDER_ID)
    if not profile:
        raise HTTPException(404, "Founder profile not found — call /onboard first")
    return {
        "founder_id": profile.founder_id, "name": profile.name,
        "email": profile.email, "company_name": profile.company_name,
        "team_members": profile.team_members, "timezone": profile.timezone,
    }


# ─────────────────────────────────────────────
# Brain REST API
# ─────────────────────────────────────────────

@app.get("/brain/summary")
async def brain_summary():
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")

    active, at_risk, tasks, alerts, overdue = await asyncio.gather(
        _brain_store.get_active_insights(FOUNDER_ID, limit=100),
        _brain_store.get_at_risk_relationships(FOUNDER_ID, threshold=0.5),
        _brain_store.get_open_tasks(FOUNDER_ID),
        _brain_store.get_pending_alerts(FOUNDER_ID),
        _brain_store.get_overdue_commitments(FOUNDER_ID),
    )
    type_counts = {}
    for i in active:
        type_counts[i.type.value] = type_counts.get(i.type.value, 0) + 1

    return {
        "active_insights": len(active), "insight_breakdown": type_counts,
        "overdue_commitments": len(overdue), "at_risk_contacts": len(at_risk),
        "open_tasks": len(tasks), "pending_alerts": len(alerts),
    }


@app.get("/brain/insights")
async def get_insights(type: str | None = None, limit: int = 30):
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    from brain.models import InsightType
    insight_type = None
    if type:
        try:
            insight_type = InsightType(type)
        except ValueError:
            raise HTTPException(400, f"Invalid insight type: {type}")
    insights = await _brain_store.get_active_insights(FOUNDER_ID, insight_type=insight_type, limit=limit)
    return [{"id": i.id, "type": i.type.value, "content": i.content,
             "parties": i.parties, "due_date": i.due_date, "source": i.source.value} for i in insights]


@app.get("/brain/alerts")
async def get_alerts(severity: str = "medium"):
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    from brain.models import AlertSeverity
    sev_map = {"low": AlertSeverity.LOW, "medium": AlertSeverity.MEDIUM,
               "high": AlertSeverity.HIGH, "critical": AlertSeverity.CRITICAL}
    sev = sev_map.get(severity.lower(), AlertSeverity.MEDIUM)
    alerts = await _brain_store.get_pending_alerts(FOUNDER_ID, min_severity=sev)
    return [{"id": a.id, "title": a.title, "message": a.message,
             "severity": a.severity.value, "related_contact": a.related_contact} for a in alerts]


@app.post("/brain/alerts/{alert_id}/dismiss")
async def dismiss_alert(alert_id: str):
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    await _brain_store.dismiss_alert(alert_id)
    return {"status": "dismissed"}


@app.post("/brain/scan")
async def trigger_scan(hours_back: int = 24):
    if not _email_scanner:
        raise HTTPException(503, "Email scanner not initialized")
    if not (_gmail and _gmail.is_authenticated()):
        raise HTTPException(401, "Gmail not authenticated — visit /auth/gmail first")
    n = await _email_scanner.run_once(hours_back=hours_back)
    return {"insights_extracted": n}


@app.post("/brain/monitor")
async def trigger_monitor():
    if not _risk_monitor:
        raise HTTPException(503, "Risk monitor not initialized")
    n = await _risk_monitor.run_once()
    return {"alerts_created": n}


@app.get("/brain/relationships")
async def get_relationships():
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    profiles = await _brain_store.get_all_relationships(FOUNDER_ID)
    return [{"contact_email": p.contact_email, "name": p.name,
             "health_score": p.health_score, "tone_trend": p.tone_trend.value,
             "interaction_count": p.interaction_count} for p in profiles]


# ─────────────────────────────────────────────
# CRM Pipeline & Team Tasks
# ─────────────────────────────────────────────

@app.get("/brain/pipeline")
async def get_pipeline():
    """CRM-style pipeline built from relationship health data."""
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    if not _brain_tool_fns or "get_sales_pipeline" not in _brain_tool_fns:
        raise HTTPException(503, "Pipeline tool not available")
    return await _brain_tool_fns["get_sales_pipeline"]()


@app.get("/brain/team-tasks")
async def get_team_tasks(assignee: str = ""):
    """Get tasks filtered by assignee (or all if empty)."""
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    if not _brain_tool_fns or "get_team_tasks" not in _brain_tool_fns:
        raise HTTPException(503, "Team tasks tool not available")
    return await _brain_tool_fns["get_team_tasks"](assignee=assignee)


@app.post("/brain/tasks/create")
async def create_brain_task(title: str, assignee: str = "", due_date: str = "", description: str = ""):
    """Create a new task via REST (as alternative to voice)."""
    if not _brain_tool_fns or "create_task" not in _brain_tool_fns:
        raise HTTPException(503, "Task creation not available")
    return await _brain_tool_fns["create_task"](
        title=title, assignee=assignee, due_date=due_date, description=description
    )


@app.get("/brain/meeting-prep")
async def get_meeting_prep(contact_email: str = "", meeting_title: str = ""):
    """Get a comprehensive briefing for an upcoming meeting."""
    if not _brain_tool_fns or "get_meeting_prep" not in _brain_tool_fns:
        raise HTTPException(503, "Meeting prep tool not available")
    return await _brain_tool_fns["get_meeting_prep"](
        contact_email=contact_email, meeting_title=meeting_title
    )


@app.get("/brain/weekly-digest")
async def get_weekly_digest():
    """Generate a comprehensive weekly status digest."""
    if not _brain_tool_fns or "get_weekly_digest" not in _brain_tool_fns:
        raise HTTPException(503, "Weekly digest tool not available")
    return await _brain_tool_fns["get_weekly_digest"]()


# ─────────────────────────────────────────────────────────────────────────────
# Enhanced Task API
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/brain/tasks/all")
async def get_all_tasks():
    """Get all tasks (all statuses) with optional filters."""
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    tasks = await _brain_store.get_all_tasks(FOUNDER_ID)
    return [t.to_firestore() for t in tasks]


@app.post("/brain/tasks/{task_id}/comment")
async def add_task_comment(task_id: str, body: dict):
    """Add a comment to a task."""
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    text = body.get("text", "")
    author = body.get("author", "Founder")
    if not text:
        raise HTTPException(400, "Comment text is required")
    await _brain_store.add_task_comment(task_id, text, author)
    return {"ok": True}


@app.patch("/brain/tasks/{task_id}")
async def update_task_fields(task_id: str, body: dict):
    """Update task fields (status, priority, assignee, tags, etc.)."""
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    allowed = {"title", "description", "assignee", "due_date", "status", "priority", "tags", "notes"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if "status" in updates and updates["status"] == "done":
        updates["completed_at"] = time.time()
    if updates:
        await _brain_store.update_task(task_id, updates)
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Teams API
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/brain/teams")
async def get_teams():
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    teams = await _brain_store.get_teams(FOUNDER_ID)
    return [t.to_firestore() for t in teams]


@app.post("/brain/teams")
async def create_team(body: dict):
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    from brain.models import Team
    team = Team(
        founder_id=FOUNDER_ID,
        name=body["name"],
        members=body.get("members", []),
        color=body.get("color", "#4f7dff"),
        email_alias=body.get("email_alias", ""),
    )
    await _brain_store.add_team(team)
    return team.to_firestore()


@app.patch("/brain/teams/{team_id}")
async def update_team(team_id: str, body: dict):
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    allowed = {"name", "members", "color", "email_alias"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if updates:
        await _brain_store.update_team(team_id, updates)
    return {"ok": True}


@app.delete("/brain/teams/{team_id}")
async def delete_team(team_id: str):
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    await _brain_store.delete_team(team_id)
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Email Routing API
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/brain/emails/classify")
async def classify_email(body: dict):
    """Use Gemini to classify an email and route it to the right team."""
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")

    sender = body.get("sender", "")
    subject = body.get("subject", "")
    snippet = body.get("snippet", "")
    email_id = body.get("email_id", str(uuid.uuid4()))
    sender_email = body.get("sender_email", sender)

    # Get teams and routing rules
    teams = await _brain_store.get_teams(FOUNDER_ID)
    rules = await _brain_store.get_routing_rules(FOUNDER_ID)
    team_names = [t.name for t in teams] or ["Sales", "Support", "Engineering"]

    # Ask Gemini to classify
    prompt = f"""Classify this email into ONE category and determine urgency.

Sender: {sender}
Subject: {subject}
Preview: {snippet[:500]}

Categories: sales, support, engineering, partnerships, hr, finance, personal, spam
Available teams: {', '.join(team_names)}

Return JSON only:
{{"category": "...", "urgency": "low|medium|high|critical", "sentiment": "positive|neutral|negative", "confidence": 0.95, "suggested_team": "...", "reasoning": "..."}}"""

    try:
        import google.genai as genai
        api_key = os.environ.get("GOOGLE_API_KEY", "")
        client = genai.Client(api_key=api_key)
        resp = await asyncio.to_thread(
            client.models.generate_content,
            model="gemini-2.0-flash",
            contents=prompt,
        )
        raw = (resp.text or "").strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw).strip()
        classification = json.loads(raw)
    except Exception as e:
        print(f"[EmailRouting] Classification failed: {e}")
        classification = {
            "category": "personal", "urgency": "medium",
            "sentiment": "neutral", "confidence": 0.0,
            "suggested_team": "", "reasoning": "Classification failed"
        }

    # Match to team
    suggested = classification.get("suggested_team", "")
    matched_team = next((t for t in teams if t.name.lower() == suggested.lower()), None)

    # Check routing rules
    routing_method = "ai"
    for rule in rules:
        if not rule.enabled:
            continue
        conds = rule.conditions
        cat_match = not conds.get("category") or conds["category"] == classification["category"]
        kw_match = not conds.get("keywords") or any(kw.lower() in (subject + " " + snippet).lower() for kw in conds["keywords"])
        domain_match = not conds.get("sender_domains") or any(d in sender_email for d in conds["sender_domains"])
        if cat_match and kw_match and domain_match:
            matched_team = next((t for t in teams if t.id == rule.team_id), matched_team)
            routing_method = "rule"
            break

    # Store routed email
    from brain.models import RoutedEmail
    routed = RoutedEmail(
        founder_id=FOUNDER_ID,
        email_id=email_id,
        sender=sender,
        sender_email=sender_email,
        subject=subject,
        snippet=snippet[:300],
        category=classification.get("category", "personal"),
        confidence=classification.get("confidence", 0.0),
        urgency=classification.get("urgency", "medium"),
        sentiment=classification.get("sentiment", "neutral"),
        routed_to_team=matched_team.id if matched_team else "",
        routed_to_team_name=matched_team.name if matched_team else "",
        assigned_to=matched_team.members[0].get("email", "") if matched_team and matched_team.members else "",
        routing_method=routing_method,
    )
    await _brain_store.add_routed_email(routed)

    return {
        "id": routed.id,
        "classification": classification,
        "routed_to": {
            "team": matched_team.name if matched_team else None,
            "assigned_to": routed.assigned_to,
        },
        "routing_method": routing_method,
    }


@app.get("/brain/emails/routed")
async def get_routed_emails(limit: int = 50):
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    emails = await _brain_store.get_routed_emails(FOUNDER_ID, limit)
    return [e.to_firestore() for e in emails]


@app.post("/brain/emails/{email_id}/reassign")
async def reassign_email(email_id: str, body: dict):
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    team_id = body.get("team_id", "")
    team_name = body.get("team_name", "")
    assigned_to = body.get("assigned_to", "")
    await _brain_store.update_routed_email(email_id, {
        "routed_to_team": team_id,
        "routed_to_team_name": team_name,
        "assigned_to": assigned_to,
        "routing_method": "manual",
    })
    return {"ok": True}


@app.patch("/brain/emails/{email_id}")
async def update_routed_email(email_id: str, body: dict):
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    allowed = {"status", "assigned_to", "routed_to_team", "routed_to_team_name"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if "status" in updates and updates["status"] == "resolved":
        updates["resolved_at"] = time.time()
    if updates:
        await _brain_store.update_routed_email(email_id, updates)
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Routing Rules API
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/brain/routing-rules")
async def get_routing_rules():
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    rules = await _brain_store.get_routing_rules(FOUNDER_ID)
    return [r.to_firestore() for r in rules]


@app.post("/brain/routing-rules")
async def create_routing_rule(body: dict):
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    from brain.models import RoutingRule
    rule = RoutingRule(
        founder_id=FOUNDER_ID,
        name=body["name"],
        team_id=body["team_id"],
        conditions=body.get("conditions", {}),
        priority=body.get("priority", 10),
        auto_assign_to=body.get("auto_assign_to", ""),
    )
    await _brain_store.add_routing_rule(rule)
    return rule.to_firestore()


@app.delete("/brain/routing-rules/{rule_id}")
async def delete_routing_rule(rule_id: str):
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    await _brain_store.delete_routing_rule(rule_id)
    return {"ok": True}


# ─────────────────────────────────────────────
# Memory Debug / Test Endpoints
# ─────────────────────────────────────────────

@app.get("/brain/memory/facts")
async def get_memory_facts():
    """Debug: list all stored facts in long-term memory."""
    if not _memory_service:
        raise HTTPException(503, "Memory service not initialized")
    try:
        db = _memory_service._get_db()
        user_key = f"{APP_NAME}__{FOUNDER_ID}".replace("/", "_").replace(" ", "_")
        facts_ref = (
            db.collection(_memory_service.MEMORIES_COLLECTION)
            .document(user_key)
            .collection(_memory_service.FACTS_SUBCOLLECTION)
        )
        docs = await asyncio.to_thread(lambda: list(facts_ref.limit(50).stream()))
        return [doc.to_dict() for doc in docs]
    except Exception as e:
        raise HTTPException(500, f"Failed to query facts: {e}")


@app.get("/brain/memory/episodes")
async def get_memory_episodes(limit: int = 10):
    """Debug: list recent episodic summaries from long-term memory."""
    if not _memory_service:
        raise HTTPException(503, "Memory service not initialized")
    try:
        db = _memory_service._get_db()
        user_key = f"{APP_NAME}__{FOUNDER_ID}".replace("/", "_").replace(" ", "_")
        episodes_ref = (
            db.collection(_memory_service.MEMORIES_COLLECTION)
            .document(user_key)
            .collection(_memory_service.EPISODES_SUBCOLLECTION)
        )
        docs = await asyncio.to_thread(
            lambda: list(
                episodes_ref
                .order_by("timestamp", direction="DESCENDING")
                .limit(limit)
                .stream()
            )
        )
        return [doc.to_dict() for doc in docs]
    except Exception as e:
        raise HTTPException(500, f"Failed to query episodes: {e}")


@app.get("/brain/memory/events")
async def get_memory_events(limit: int = 30):
    """Debug: list recent conversation events from long-term memory."""
    if not _memory_service:
        raise HTTPException(503, "Memory service not initialized")
    try:
        db = _memory_service._get_db()
        user_key = f"{APP_NAME}__{FOUNDER_ID}".replace("/", "_").replace(" ", "_")
        events_ref = (
            db.collection(_memory_service.MEMORIES_COLLECTION)
            .document(user_key)
            .collection(_memory_service.EVENTS_SUBCOLLECTION)
        )
        docs = await asyncio.to_thread(
            lambda: list(
                events_ref
                .order_by("timestamp", direction="DESCENDING")
                .limit(limit)
                .stream()
            )
        )
        return [doc.to_dict() for doc in docs]
    except Exception as e:
        raise HTTPException(500, f"Failed to query events: {e}")


@app.get("/brain/memory/search")
async def search_memory(query: str):
    """Debug: test memory search with a query string."""
    if not _memory_service:
        raise HTTPException(503, "Memory service not initialized")
    try:
        response = await _memory_service.search_memory(
            app_name=APP_NAME, user_id=FOUNDER_ID, query=query
        )
        results = []
        for entry in (response.memories or []):
            text = ""
            if entry.content and entry.content.parts:
                text = " ".join(
                    p.text for p in entry.content.parts if hasattr(p, "text") and p.text
                )
            results.append({
                "content": text[:500],
                "author": getattr(entry, "author", ""),
                "timestamp": getattr(entry, "timestamp", ""),
            })
        return {"query": query, "results": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(500, f"Memory search failed: {e}")


@app.get("/brain/memory/status")
async def memory_status():
    """Debug: check memory service status and data counts."""
    if not _memory_service:
        return {"status": "not_initialized", "reason": "Memory service not configured"}
    try:
        db = _memory_service._get_db()
        user_key = f"{APP_NAME}__{FOUNDER_ID}".replace("/", "_").replace(" ", "_")
        base_ref = db.collection(_memory_service.MEMORIES_COLLECTION).document(user_key)

        facts_count = await asyncio.to_thread(
            lambda: len(list(base_ref.collection("facts").limit(100).stream()))
        )
        episodes_count = await asyncio.to_thread(
            lambda: len(list(base_ref.collection("episodes").limit(100).stream()))
        )
        events_count = await asyncio.to_thread(
            lambda: len(list(base_ref.collection("events").limit(500).stream()))
        )

        return {
            "status": "active",
            "user_key": user_key,
            "facts_count": facts_count,
            "episodes_count": episodes_count,
            "events_count": events_count,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


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
