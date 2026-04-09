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

Email Intelligence endpoints:
  GET  /brain/emails/scored              — scored emails (filter by priority/stage/category)
  GET  /brain/emails/pipeline            — pipeline summary (counts by priority/stage)
  POST /brain/emails/intelligence-scan   — trigger full intelligence scan
  GET  /brain/emails/health              — scanner health status
  PATCH /brain/emails/{id}/stage         — move email through pipeline
  GET  /brain/emails/{id}/detail         — full email detail + scoring breakdown
  GET  /brain/emails/briefing            — founder voice briefing digest
  POST /brain/contacts/tier              — add/update contact tier
  GET  /brain/contacts/tiers             — list all contact tiers

RAG Email Memory + Voice-Matched Drafts + Split Inbox:
  POST /brain/emails/search              — semantic search across email history (RAG)
  GET  /brain/emails/splits              — emails organized by split inbox tabs
  POST /brain/emails/draft               — generate voice-matched draft reply
  GET  /brain/emails/style/{email}       — writing style profile for a contact
  POST /brain/emails/embed-sync          — trigger email embedding sync
  GET  /brain/emails/embed-stats         — embedding pipeline statistics
  POST /brain/emails/split-move          — record manual split move (auto-learning)
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
EMAIL_SCAN_INTERVAL = int(os.getenv("EMAIL_SCAN_INTERVAL_MINUTES", "2"))
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
_email_memory  = None    # EmailMemoryStore — RAG email search
_voice_drafter = None    # VoiceMatchedDraftEngine — style-matched drafts
_split_inbox   = None    # SplitInboxEngine — auto-categorized splits

# ─────────────────────────────────────────────
# App lifecycle
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _brain_store, _embeddings, _gmail, _calendar, _drive, _tasks, _contacts, _email_scanner, _risk_monitor, _brain_tool_fns, _memory_service, _email_memory, _voice_drafter, _split_inbox

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

            # Initialize RAG Email Memory + Voice-Matched Drafting + Split Inbox
            from agents.email_memory import EmailMemoryStore
            from agents.voice_drafter import VoiceMatchedDraftEngine, SplitInboxEngine

            _email_memory = EmailMemoryStore(
                store=_brain_store,
                embeddings=_embeddings,
                api_key=GOOGLE_API_KEY,
                founder_id=FOUNDER_ID,
            )
            _voice_drafter = VoiceMatchedDraftEngine(
                email_memory=_email_memory,
                api_key=GOOGLE_API_KEY,
            )
            _split_inbox = SplitInboxEngine()
            print("[Astra OS] 🧠 Email Memory + Voice Drafter + Split Inbox initialized")

            # Initialize EmailClaw (for testing — replaces old email tools)
            _emailclaw = None
            try:
                from emailclaw import EmailClaw
                _emailclaw = EmailClaw(gmail=TOKEN_PATH)
                print("[Astra OS] 📧 EmailClaw initialized successfully")
            except ImportError:
                print("[Astra OS] ⚠️  EmailClaw not installed — email tools disabled")
            except Exception as ec_err:
                print(f"[Astra OS] ⚠️  EmailClaw init failed: {ec_err}")

            # Build brain tools for voice session injection
            from agents.brain_tools import ToolDeps, build_tools
            tool_deps = ToolDeps(
                store=_brain_store, embeddings=_embeddings,
                gmail=_gmail, calendar=_calendar, founder_id=FOUNDER_ID,
                drive=_drive, tasks=_tasks, contacts=_contacts,
                memory_service=_memory_service, app_name=APP_NAME,
                emailclaw=_emailclaw,
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
# Demo Seed Data
# ─────────────────────────────────────────────

@app.post("/brain/seed-demo")
async def seed_demo_data():
    """Populate Firestore with realistic demo data for hackathon presentation."""
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")

    from brain.store import (
        COL_INSIGHTS, COL_RELATIONSHIPS, COL_TASKS, COL_ALERTS,
        COL_TEAMS, COL_ROUTING_RULES, COL_ROUTED_EMAILS
    )
    from brain.models import (
        Insight, InsightType, InsightSource, InsightStatus,
        RelationshipProfile, ToneTrend,
        Task, TaskStatus, TaskPriority,
        Alert, AlertSeverity, AlertStatus,
        Team, RoutingRule, RoutedEmail,
        EmailCategory, EmailUrgency
    )

    founder = FOUNDER_ID
    now = time.time()

    # Helpers for date calculation
    def date_from_now(days: int) -> str:
        """Return ISO date string for N days from now (today = March 16, 2026)"""
        base = "2026-03-16"
        from datetime import datetime, timedelta
        d = datetime.fromisoformat(base) + timedelta(days=days)
        return d.isoformat()[:10]

    # ── 1. Create Teams ──────────────────────────────────────────────────────

    team_eng = Team(
        founder_id=founder,
        name="Engineering",
        members=[
            {"name": "Arjun", "email": "arjun@astra.ai", "role": "lead"},
            {"name": "Riya", "email": "riya@astra.ai", "role": "backend"}
        ],
        color="#3b82f6"
    )

    team_design = Team(
        founder_id=founder,
        name="Design",
        members=[
            {"name": "Neha", "email": "neha@astra.ai", "role": "lead"}
        ],
        color="#8b5cf6"
    )

    team_sales = Team(
        founder_id=founder,
        name="Sales & Growth",
        members=[
            {"name": "Khwahish", "email": "khwahish@astra.ai", "role": "lead"},
            {"name": "Paras", "email": "paras@astra.ai", "role": "growth"}
        ],
        color="#22c55e"
    )

    # Store teams
    await asyncio.to_thread(
        lambda: _brain_store._db.collection(COL_TEAMS).document(team_eng.id).set(team_eng.to_firestore())
    )
    await asyncio.to_thread(
        lambda: _brain_store._db.collection(COL_TEAMS).document(team_design.id).set(team_design.to_firestore())
    )
    await asyncio.to_thread(
        lambda: _brain_store._db.collection(COL_TEAMS).document(team_sales.id).set(team_sales.to_firestore())
    )

    # ── 2. Create Routing Rules ──────────────────────────────────────────────

    rule_investor = RoutingRule(
        founder_id=founder,
        name="Investor Emails",
        team_id=team_sales.id,
        conditions={
            "category": "sales",
            "sender_domains": ["sequoia.vc", "ycombinator.com"]
        },
        priority=10
    )

    rule_bugs = RoutingRule(
        founder_id=founder,
        name="Bug Reports",
        team_id=team_eng.id,
        conditions={
            "category": "support",
            "keywords": ["bug", "error", "crash"]
        },
        priority=10
    )

    rule_design = RoutingRule(
        founder_id=founder,
        name="Design Feedback",
        team_id=team_design.id,
        conditions={
            "category": "support",
            "keywords": ["design", "mockup", "UI", "UX"]
        },
        priority=10
    )

    # Store routing rules
    await asyncio.to_thread(
        lambda: _brain_store._db.collection(COL_ROUTING_RULES).document(rule_investor.id).set(rule_investor.to_firestore())
    )
    await asyncio.to_thread(
        lambda: _brain_store._db.collection(COL_ROUTING_RULES).document(rule_bugs.id).set(rule_bugs.to_firestore())
    )
    await asyncio.to_thread(
        lambda: _brain_store._db.collection(COL_ROUTING_RULES).document(rule_design.id).set(rule_design.to_firestore())
    )

    # ── 3. Create Relationships ──────────────────────────────────────────────

    rel_paras = RelationshipProfile(
        founder_id=founder,
        contact_email="paras@astra.ai",
        name="Paras Singh",
        health_score=0.92,
        tone_trend=ToneTrend.POSITIVE,
        last_contact_at=now - 86400,
        interaction_count=23,
        open_commitments=2
    )

    rel_sarah = RelationshipProfile(
        founder_id=founder,
        contact_email="sarah@sequoia.vc",
        name="Sarah Chen",
        health_score=0.78,
        tone_trend=ToneTrend.POSITIVE,
        last_contact_at=now - 172800,
        interaction_count=8,
        open_commitments=1
    )

    rel_bytebyte = RelationshipProfile(
        founder_id=founder,
        contact_email="team@bytebytego.com",
        name="ByteByteGo",
        health_score=0.65,
        tone_trend=ToneTrend.NEUTRAL,
        last_contact_at=now - 432000,
        interaction_count=12,
        open_commitments=1
    )

    rel_riya = RelationshipProfile(
        founder_id=founder,
        contact_email="riya@astra.ai",
        name="Riya Sharma",
        health_score=0.88,
        tone_trend=ToneTrend.POSITIVE,
        last_contact_at=now - 43200,
        interaction_count=31,
        open_commitments=0
    )

    rel_neha = RelationshipProfile(
        founder_id=founder,
        contact_email="neha@astra.ai",
        name="Neha Gupta",
        health_score=0.71,
        tone_trend=ToneTrend.DECLINING,
        last_contact_at=now - 259200,
        interaction_count=15,
        open_commitments=1
    )

    rel_alex = RelationshipProfile(
        founder_id=founder,
        contact_email="alex@ycombinator.com",
        name="Alex Thompson",
        health_score=0.45,
        tone_trend=ToneTrend.NEGATIVE,
        last_contact_at=now - 604800,
        interaction_count=5,
        open_commitments=1
    )

    # Store relationships
    for rel in [rel_paras, rel_sarah, rel_bytebyte, rel_riya, rel_neha, rel_alex]:
        await asyncio.to_thread(
            lambda r=rel: _brain_store._db.collection(COL_RELATIONSHIPS)
                                            .document(r.contact_email)
                                            .set(r.to_firestore())
        )

    # ── 4. Create Tasks ──────────────────────────────────────────────────────

    tasks = [
        Task(
            founder_id=founder,
            title="Finalize Series A pitch deck",
            description="Complete and polish the Series A pitch deck for investor meetings",
            assignee="Khwahish",
            due_date=date_from_now(1),
            status=TaskStatus.PENDING,
            priority="urgent",
            tags=["fundraising", "priority"]
        ),
        Task(
            founder_id=founder,
            title="Review Q1 revenue projections",
            description="Review and validate Q1 revenue projections with finance team",
            assignee="Paras",
            due_date=date_from_now(2),
            status=TaskStatus.IN_PROGRESS,
            priority="high",
            tags=["finance"]
        ),
        Task(
            founder_id=founder,
            title="Ship onboarding flow v2",
            description="Deploy updated onboarding flow to production",
            assignee="Arjun",
            due_date=date_from_now(3),
            status=TaskStatus.IN_PROGRESS,
            priority="high",
            tags=["product", "frontend"]
        ),
        Task(
            founder_id=founder,
            title="Fix authentication timeout bug",
            description="Resolve the authentication timeout issue reported by users",
            assignee="Riya",
            due_date=date_from_now(0),
            status=TaskStatus.PENDING,
            priority="urgent",
            tags=["engineering", "bug"]
        ),
        Task(
            founder_id=founder,
            title="Prepare investor update email",
            description="Prepare monthly investor update email with key metrics",
            assignee="Khwahish",
            due_date=date_from_now(5),
            status=TaskStatus.BLOCKED,
            priority="medium",
            tags=["fundraising"]
        ),
        Task(
            founder_id=founder,
            title="Design new landing page mockups",
            description="Create mockups for redesigned landing page",
            assignee="Neha",
            due_date=date_from_now(7),
            status=TaskStatus.PENDING,
            priority="medium",
            tags=["design"]
        ),
        Task(
            founder_id=founder,
            title="Set up CI/CD pipeline",
            description="Implement GitHub Actions CI/CD pipeline for automated deployments",
            assignee="Arjun",
            due_date=None,
            status=TaskStatus.DONE,
            priority="low",
            tags=["devops"],
            completed_at=now - 1209600
        ),
        Task(
            founder_id=founder,
            title="Customer interview - ByteByteGo",
            description="Conduct customer interview with ByteByteGo team",
            assignee="Khwahish",
            due_date=None,
            status=TaskStatus.DONE,
            priority="high",
            tags=["research"],
            completed_at=now - 604800
        ),
    ]

    # Store tasks
    for task in tasks:
        await asyncio.to_thread(
            lambda t=task: _brain_store._db.collection(COL_TASKS)
                                            .document(t.id)
                                            .set(t.to_firestore())
        )

    # ── 5. Create Insights ───────────────────────────────────────────────────

    insights = [
        Insight(
            founder_id=founder,
            type=InsightType.COMMITMENT,
            source=InsightSource.EMAIL,
            content="Promised to send updated financials to Sarah Chen by Friday",
            raw_context="I'll get those updated financials over to you by end of week.",
            parties=["sarah@sequoia.vc"],
            due_date=date_from_now(2),
            created_at=now - 432000
        ),
        Insight(
            founder_id=founder,
            type=InsightType.RISK,
            source=InsightSource.EMAIL,
            content="ByteByteGo engagement declining — last 3 emails unanswered for 5+ days",
            raw_context="No response from ByteByteGo team in over a week. Previous cadence was 2-3 responses per day.",
            parties=["team@bytebytego.com"],
            created_at=now - 432000
        ),
        Insight(
            founder_id=founder,
            type=InsightType.DECISION,
            source=InsightSource.MEETING,
            content="Decided to pivot pricing model from per-seat to usage-based",
            raw_context="In finance meeting, agreed to shift from per-seat pricing to consumption-based model for better founder experience.",
            parties=["paras@astra.ai"],
            created_at=now - 864000
        ),
        Insight(
            founder_id=founder,
            type=InsightType.ACTION_ITEM,
            source=InsightSource.EMAIL,
            content="Schedule follow-up call with Alex Thompson re: YC application",
            raw_context="Alex mentioned wanting to discuss YC application status. Need to set up time to talk.",
            parties=["alex@ycombinator.com"],
            due_date=date_from_now(3),
            created_at=now - 604800
        ),
        Insight(
            founder_id=founder,
            type=InsightType.OPPORTUNITY,
            source=InsightSource.EMAIL,
            content="Sarah mentioned Sequoia is looking at AI-native productivity tools",
            raw_context="In casual conversation, Sarah said Sequoia has been investing heavily in AI-native developer tools and would love to see more.",
            parties=["sarah@sequoia.vc"],
            created_at=now - 172800
        ),
        Insight(
            founder_id=founder,
            type=InsightType.COMMITMENT,
            source=InsightSource.EMAIL,
            content="Agreed to deliver MVP demo to ByteByteGo by March 20",
            raw_context="ByteByteGo team wants to see a working MVP. We committed to March 20 delivery.",
            parties=["team@bytebytego.com"],
            due_date=date_from_now(4),
            created_at=now - 432000
        ),
        Insight(
            founder_id=founder,
            type=InsightType.RISK,
            source=InsightSource.MEETING,
            content="Sprint velocity dropped 20% last week — team may be burning out",
            raw_context="Engineering standup showed velocity down from 42 to 34 points. Team looks tired.",
            parties=[],
            created_at=now - 259200
        ),
        Insight(
            founder_id=founder,
            type=InsightType.DECISION,
            source=InsightSource.MEETING,
            content="Chose Google Cloud + Firestore over AWS for infrastructure",
            raw_context="After cost and latency analysis, decided to go with Google Cloud and Firestore for our backend.",
            parties=["paras@astra.ai", "riya@astra.ai"],
            created_at=now - 1209600
        ),
    ]

    # Store insights
    for insight in insights:
        await asyncio.to_thread(
            lambda i=insight: _brain_store._db.collection(COL_INSIGHTS)
                                               .document(i.id)
                                               .set(i.to_firestore())
        )

    # ── 6. Create Alerts ─────────────────────────────────────────────────────

    alerts = [
        Alert(
            founder_id=founder,
            title="Overdue: Financials for Sarah Chen",
            message="You promised updated financials to Sarah Chen by Friday. It's now 2 days overdue. She may be waiting on this for investment decisions.",
            severity=AlertSeverity.CRITICAL,
            status=AlertStatus.PENDING,
            related_contact="sarah@sequoia.vc"
        ),
        Alert(
            founder_id=founder,
            title="Relationship at risk: Alex Thompson",
            message="Your relationship health with Alex Thompson is declining (score: 0.45). He hasn't heard from you in 5+ days. Consider reaching out.",
            severity=AlertSeverity.HIGH,
            status=AlertStatus.PENDING,
            related_contact="alex@ycombinator.com"
        ),
        Alert(
            founder_id=founder,
            title="Sprint velocity declining",
            message="Engineering team velocity dropped 20% last week. This could indicate burnout or blockers. Consider team check-in.",
            severity=AlertSeverity.HIGH,
            status=AlertStatus.PENDING
        ),
        Alert(
            founder_id=founder,
            title="ByteByteGo MVP deadline in 4 days",
            message="You committed to deliver MVP demo to ByteByteGo by March 20. That's 4 days away. Check with Arjun on progress.",
            severity=AlertSeverity.MEDIUM,
            status=AlertStatus.PENDING,
            related_contact="team@bytebytego.com"
        ),
        Alert(
            founder_id=founder,
            title="3 unanswered emails from Neha",
            message="Neha has sent 3 emails in the past 48 hours without responses. Internal communication gap detected.",
            severity=AlertSeverity.MEDIUM,
            status=AlertStatus.PENDING,
            related_contact="neha@astra.ai"
        ),
        Alert(
            founder_id=founder,
            title="Weekly investor update not sent",
            message="You typically send investor updates on Mondays. This week's update hasn't been sent yet.",
            severity=AlertSeverity.LOW,
            status=AlertStatus.PENDING
        ),
    ]

    # Store alerts
    for alert in alerts:
        await asyncio.to_thread(
            lambda a=alert: _brain_store._db.collection(COL_ALERTS)
                                             .document(a.id)
                                             .set(a.to_firestore())
        )

    # ── 7. Create Routed Emails ──────────────────────────────────────────────

    routed_emails = [
        RoutedEmail(
            founder_id=founder,
            email_id="msg_001",
            sender="Sarah Chen",
            sender_email="sarah@sequoia.vc",
            subject="Re: Series A Timeline",
            snippet="When can we set up the follow-up meeting? Excited about your metrics.",
            category="sales",
            confidence=0.95,
            urgency="high",
            sentiment="positive",
            routed_to_team=team_sales.id,
            routed_to_team_name="Sales & Growth",
            routing_method="ai",
            status="new"
        ),
        RoutedEmail(
            founder_id=founder,
            email_id="msg_002",
            sender="GitHub Alerts",
            sender_email="noreply@github.com",
            subject="Critical vulnerability in dependency",
            snippet="A critical security vulnerability was found in one of your dependencies. Please update immediately.",
            category="engineering",
            confidence=0.99,
            urgency="critical",
            sentiment="negative",
            routed_to_team=team_eng.id,
            routed_to_team_name="Engineering",
            routing_method="rule",
            status="new"
        ),
        RoutedEmail(
            founder_id=founder,
            email_id="msg_003",
            sender="Alex Thompson",
            sender_email="alex@ycombinator.com",
            subject="YC Application Follow-up",
            snippet="Hi, just checking in on the status of your application. Let me know if you need anything.",
            category="sales",
            confidence=0.87,
            urgency="medium",
            sentiment="neutral",
            routed_to_team=team_sales.id,
            routed_to_team_name="Sales & Growth",
            routing_method="ai",
            status="new"
        ),
        RoutedEmail(
            founder_id=founder,
            email_id="msg_004",
            sender="Stripe",
            sender_email="notifications@stripe.com",
            subject="Monthly revenue report ready",
            snippet="Your monthly revenue report for February is ready. Total: $48,200.",
            category="finance",
            confidence=0.99,
            urgency="low",
            sentiment="positive",
            status="new"
        ),
        RoutedEmail(
            founder_id=founder,
            email_id="msg_005",
            sender="Intercom",
            sender_email="support@intercom.io",
            subject="New support ticket: Login issue",
            snippet="User reports they cannot login. Error: 'Session timeout'. Affects 5 users.",
            category="support",
            confidence=0.92,
            urgency="high",
            sentiment="negative",
            routed_to_team=team_eng.id,
            routed_to_team_name="Engineering",
            routing_method="rule",
            status="new"
        ),
        RoutedEmail(
            founder_id=founder,
            email_id="msg_006",
            sender="Neha Gupta",
            sender_email="neha@astra.ai",
            subject="Landing page mockups ready for review",
            snippet="I've finished the landing page redesign mockups. Ready for your feedback!",
            category="personal",
            confidence=0.88,
            urgency="medium",
            sentiment="positive",
            routed_to_team=team_design.id,
            routed_to_team_name="Design",
            routing_method="ai",
            status="new"
        ),
    ]

    # Store routed emails
    for email in routed_emails:
        await asyncio.to_thread(
            lambda e=email: _brain_store._db.collection(COL_ROUTED_EMAILS)
                                             .document(e.id)
                                             .set(e.to_firestore())
        )

    # Return summary
    return {
        "status": "success",
        "message": "Demo data seeded successfully",
        "data": {
            "teams_created": 3,
            "routing_rules_created": 3,
            "relationships_created": 6,
            "tasks_created": len(tasks),
            "insights_created": len(insights),
            "alerts_created": len(alerts),
            "routed_emails_created": len(routed_emails),
            "total_records": 3 + 3 + 6 + len(tasks) + len(insights) + len(alerts) + len(routed_emails)
        }
    }


# ─────────────────────────────────────────────────────────────────────────────
# Email Intelligence API  (powered by agents/email_intelligence.py)
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/brain/emails/new-count")
async def email_new_count():
    """Ultra-fast endpoint — returns count of emails by stage + last scan time.
    Used by frontend for real-time polling every 10 seconds."""
    if not _brain_store:
        return {"total": 0, "unread": 0, "action_required": 0, "last_scan": None}
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
        db = _brain_store._db

        # Fast count query
        col = db.collection("scored_emails").document(FOUNDER_ID).collection("emails")

        # Count action_required
        action_docs = await asyncio.to_thread(
            lambda: list(col.where(filter=FieldFilter("pipeline_stage", "==", "action_required")).limit(1000).stream())
        )

        # Count unread (triaged stage = needs attention)
        triaged_docs = await asyncio.to_thread(
            lambda: list(col.where(filter=FieldFilter("pipeline_stage", "==", "triaged")).limit(1000).stream())
        )

        # Total docs count
        total_docs = await asyncio.to_thread(
            lambda: list(col.limit(1).stream())
        )

        scanner_status = None
        if _email_scanner:
            scanner_status = {
                "running": _email_scanner._running,
                "last_history_id": getattr(_email_scanner, '_last_history_id', None),
                "last_full_scan": getattr(_email_scanner, '_last_full_scan', 0),
            }

        return {
            "action_required": len(action_docs),
            "triaged": len(triaged_docs),
            "scanner": scanner_status,
        }
    except Exception as e:
        return {"error": str(e)}


@app.get("/brain/emails/scored")
async def get_scored_emails(
    priority: Optional[str] = None,
    stage: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 10000,
    offset: int = 0,
):
    """
    Fetch scored emails from the intelligence pipeline.
    Supports filtering by priority (critical/urgent/important/notable/low/noise),
    pipeline stage (new/triaged/action_required/delegated/scheduled/replied/done/archived),
    and category (investor/customer/partner/internal/...).
    """
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    try:
        db = _brain_store._db
        query = db.collection("scored_emails").order_by(
            "processed_at", direction="DESCENDING"
        )

        # Firestore compound filters — apply one equality filter at a time
        from google.cloud.firestore_v1.base_query import FieldFilter
        if priority:
            query = query.where(filter=FieldFilter("priority", "==", priority))
        elif stage:
            query = query.where(filter=FieldFilter("pipeline_stage", "==", stage))
        elif category:
            query = query.where(filter=FieldFilter("category", "==", category))

        query = query.offset(offset).limit(limit)
        docs = await asyncio.to_thread(lambda: list(query.stream()))
        emails = [d.to_dict() for d in docs]

        # If multiple filters requested, apply remaining in-memory
        if priority and stage:
            emails = [e for e in emails if e.get("pipeline_stage") == stage]
        if priority and category:
            emails = [e for e in emails if e.get("category") == category]
        if stage and category and not priority:
            emails = [e for e in emails if e.get("category") == category]

        return {
            "emails": emails,
            "count": len(emails),
            "filters": {"priority": priority, "stage": stage, "category": category},
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch scored emails: {e}")


@app.get("/brain/emails/pipeline")
async def get_email_pipeline_summary():
    """
    Get a high-level pipeline summary:
    - Breakdown by priority, stage, and category
    - Action-required emails (top 10)
    - Scanner health status
    """
    if not _email_scanner:
        raise HTTPException(503, "Email intelligence not initialized")
    try:
        # The scanner holds references to the intelligence pipeline components
        pipeline = getattr(_email_scanner, "_pipeline", None)
        if pipeline:
            summary = await pipeline.get_pipeline_summary()
            return summary

        # Fallback: query Firestore directly
        db = _brain_store._db
        docs = await asyncio.to_thread(
            lambda: list(
                db.collection("scored_emails")
                .order_by("processed_at", direction="DESCENDING")
                .limit(10000)
                .stream()
            )
        )
        emails = [d.to_dict() for d in docs]

        by_priority = {}
        by_stage = {}
        by_category = {}
        for e in emails:
            p = e.get("priority", "low")
            s = e.get("pipeline_stage", "new")
            c = e.get("category", "unknown")
            by_priority[p] = by_priority.get(p, 0) + 1
            by_stage[s] = by_stage.get(s, 0) + 1
            by_category[c] = by_category.get(c, 0) + 1

        action_required = [
            e for e in emails if e.get("pipeline_stage") == "action_required"
        ]

        return {
            "total": len(emails),
            "by_priority": by_priority,
            "by_stage": by_stage,
            "by_category": by_category,
            "action_required": len(action_required),
            "action_required_emails": action_required[:10],
        }
    except Exception as e:
        raise HTTPException(500, f"Pipeline summary failed: {e}")


@app.post("/brain/emails/intelligence-scan")
async def trigger_intelligence_scan(hours_back: int = 87600, max_fetch: int = 10000):
    """
    Trigger a full email intelligence scan (scoring + classification + dedup).
    This runs the complete two-layer pipeline, not just insight extraction.
    Default: ~10 years of emails (entire mailbox). max_fetch controls how many to process.
    Returns scored email summary.
    """
    if not _email_scanner:
        raise HTTPException(503, "Email intelligence not initialized")
    if not (_gmail and _gmail.is_authenticated()):
        raise HTTPException(401, "Gmail not authenticated — visit /auth/gmail first")
    try:
        n = await _email_scanner.run_once(hours_back=hours_back, max_fetch=max_fetch)
        # Get latest scored emails for response
        db = _brain_store._db
        docs = await asyncio.to_thread(
            lambda: list(
                db.collection("scored_emails")
                .order_by("processed_at", direction="DESCENDING")
                .limit(20)
                .stream()
            )
        )
        recent = [d.to_dict() for d in docs]
        return {
            "insights_extracted": n,
            "scored_emails_count": len(recent),
            "recent_scored": recent[:10],
        }
    except Exception as e:
        raise HTTPException(500, f"Intelligence scan failed: {e}")


@app.post("/brain/emails/reclassify")
async def reclassify_emails():
    """
    Re-run rules-based category classification on all existing scored emails.
    Fixes emails stuck with category='unknown' from before the classifier was added.
    """
    if not _brain_store or not _email_scanner:
        raise HTTPException(503, "Brain not initialized")
    try:
        db = _brain_store._db
        docs = await asyncio.to_thread(
            lambda: list(db.collection("scored_emails").limit(50000).stream())
        )
        updated = 0
        pipeline = _email_scanner.pipeline
        batch = db.batch()
        batch_count = 0
        for doc in docs:
            data = doc.to_dict()
            if data.get("category", "unknown") != "unknown":
                continue  # already classified

            # Build a minimal EmailMessage-like object for the classifier
            class _MiniEmail:
                def __init__(self, d):
                    self.sender_email = d.get("sender_email", "")
                    self.subject = d.get("subject", "")
                    self.body = d.get("snippet", "")
                    self.thread_id = d.get("thread_id", "")

            from agents.email_intelligence import ScoringBreakdown
            mini = _MiniEmail(data)
            bd = ScoringBreakdown()
            bd.noise_reason = data.get("scoring_breakdown", {}).get("noise", {}).get("reason", "")
            bd.founder_replied_boost = data.get("scoring_breakdown", {}).get("founder_replied", 0)

            new_cat = pipeline._classify_category_rules(mini, bd)
            new_action = pipeline._determine_action_rules(
                data.get("priority", "low"), new_cat, mini, bd
            )

            ref = db.collection("scored_emails").document(data["message_id"])
            batch.update(ref, {
                "category": new_cat.value if hasattr(new_cat, 'value') else str(new_cat),
                "action": new_action.value if hasattr(new_action, 'value') else str(new_action),
            })
            updated += 1
            batch_count += 1

            if batch_count >= 400:
                await asyncio.to_thread(batch.commit)
                batch = db.batch()
                batch_count = 0

        if batch_count > 0:
            await asyncio.to_thread(batch.commit)

        return {"reclassified": updated, "total": len(docs)}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Reclassification failed: {e}")


@app.get("/brain/emails/health")
async def get_email_scanner_health():
    """Get scanner health status: uptime, success/failure counts, last scan time."""
    if not _email_scanner:
        raise HTTPException(503, "Email intelligence not initialized")
    try:
        health_monitor = getattr(_email_scanner, "_health", None)
        if health_monitor:
            return health_monitor.get_status()

        return {
            "status": "running" if _email_scanner._running else "stopped",
            "gmail_authenticated": _gmail.is_authenticated() if _gmail else False,
        }
    except Exception as e:
        raise HTTPException(500, f"Health check failed: {e}")


@app.patch("/brain/emails/{email_id}/stage")
async def update_email_pipeline_stage(email_id: str, body: dict):
    """
    Move an email through pipeline stages.
    Body: {"stage": "delegated", "delegated_to": "arjun@astra.ai", "delegated_to_team": "Engineering", "notes": "..."}
    Valid stages: new, triaged, action_required, delegated, scheduled, replied, done, archived
    """
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")

    from agents.email_intelligence import PipelineStage

    new_stage = body.get("stage", "")
    try:
        PipelineStage(new_stage)  # validate
    except ValueError:
        valid = [s.value for s in PipelineStage]
        raise HTTPException(400, f"Invalid stage '{new_stage}'. Valid: {valid}")

    updates = {"pipeline_stage": new_stage}
    if "delegated_to" in body:
        updates["delegated_to"] = body["delegated_to"]
    if "delegated_to_team" in body:
        updates["delegated_to_team"] = body["delegated_to_team"]
    if "notes" in body:
        updates["notes"] = body["notes"]

    try:
        db = _brain_store._db
        ref = db.collection("scored_emails").document(email_id)
        await asyncio.to_thread(lambda: ref.update(updates))
        return {"ok": True, "email_id": email_id, "new_stage": new_stage}
    except Exception as e:
        raise HTTPException(500, f"Stage update failed: {e}")


@app.get("/brain/emails/{email_id}/detail")
async def get_email_detail(email_id: str, include_body: bool = True):
    """Get full detail for a single scored email including scoring breakdown.
    If include_body=True, also fetches the full email body from Gmail."""
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    try:
        db = _brain_store._db
        doc = await asyncio.to_thread(
            lambda: db.collection("scored_emails").document(email_id).get()
        )
        if not doc.exists:
            raise HTTPException(404, f"Email {email_id} not found")
        data = doc.to_dict()

        # Fetch full body from Gmail if requested and available
        if include_body and _gmail and _gmail.is_authenticated():
            try:
                email_msg = await _gmail._fetch_message(email_id)
                if email_msg and email_msg.body:
                    data["body"] = email_msg.body[:5000]  # Cap at 5000 chars
            except Exception:
                pass  # Body fetch is best-effort

        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Detail fetch failed: {e}")


@app.post("/brain/contacts/tier")
async def update_contact_tier(body: dict):
    """
    Add or update a contact's tier in the intelligence database.
    Body: {"email": "sarah@sequoia.vc", "tier": 1, "name": "Sarah Chen"}
    Tiers: 1 (VIP), 2 (Active partner), 3 (Known contact)
    """
    if not _email_scanner:
        raise HTTPException(503, "Email intelligence not initialized")

    email = body.get("email", "").strip().lower()
    tier = body.get("tier", 3)
    name = body.get("name", "")

    if not email:
        raise HTTPException(400, "Email address is required")
    if tier not in (1, 2, 3):
        raise HTTPException(400, "Tier must be 1, 2, or 3")

    try:
        contact_db = getattr(_email_scanner, "_contacts", None)
        if contact_db:
            contact_db.add_contact(email, tier, name)

            # Persist to Firestore
            await _save_contact_config()

            return {"ok": True, "email": email, "tier": tier, "name": name}
        else:
            raise HTTPException(503, "Contact database not initialized")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Contact tier update failed: {e}")


@app.get("/brain/contacts/tiers")
async def get_contact_tiers():
    """Get all known contacts organized by tier."""
    if not _email_scanner:
        raise HTTPException(503, "Email intelligence not initialized")
    try:
        contact_db = getattr(_email_scanner, "_contacts", None)
        if contact_db:
            config = contact_db.to_config()
            # Organize contacts by tier for easy display
            tier_1 = {e: c["name"] for e, c in config.get("contacts", {}).items() if c["tier"] == 1}
            tier_2 = {e: c["name"] for e, c in config.get("contacts", {}).items() if c["tier"] == 2}
            tier_3 = {e: c["name"] for e, c in config.get("contacts", {}).items() if c["tier"] == 3}
            return {
                "tier_1": tier_1,
                "tier_2": tier_2,
                "tier_3": tier_3,
                "auto_learned": sorted(config.get("auto_contacts", {}).keys()),
                "noise_domains": sorted(config.get("noise_domains", [])),
                "noise_senders": sorted(config.get("noise_senders", [])),
                "domain_tiers": config.get("domain_tiers", {}),
            }
        else:
            raise HTTPException(503, "Contact database not initialized")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Contact tiers fetch failed: {e}")


@app.get("/brain/emails/briefing")
async def get_email_briefing():
    """
    Generate a founder briefing: top action-required emails with key context.
    Returns a prioritized digest suitable for voice delivery.
    """
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    try:
        db = _brain_store._db
        from google.cloud.firestore_v1.base_query import FieldFilter

        # Get action-required and high-priority emails
        # Use client-side sort to avoid needing a composite index
        try:
            docs = await asyncio.to_thread(
                lambda: list(
                    db.collection("scored_emails")
                    .where(filter=FieldFilter("pipeline_stage", "==", "action_required"))
                    .limit(50)
                    .stream()
                )
            )
            action_emails = sorted(
                [d.to_dict() for d in docs],
                key=lambda x: x.get("score", 0),
                reverse=True,
            )[:15]
        except Exception:
            # Fallback: fetch all and filter client-side
            docs = await asyncio.to_thread(
                lambda: list(
                    db.collection("scored_emails").limit(10000).stream()
                )
            )
            all_raw = [d.to_dict() for d in docs]
            action_emails = sorted(
                [e for e in all_raw if e.get("pipeline_stage") == "action_required"],
                key=lambda x: x.get("score", 0),
                reverse=True,
            )[:15]

        # Build briefing
        briefing_items = []
        for e in action_emails:
            item = {
                "priority": e.get("priority", "low"),
                "sender": e.get("sender", "Unknown"),
                "subject": e.get("subject", ""),
                "score": e.get("score", 0),
                "briefing": e.get("briefing", ""),
                "action": e.get("action", "review"),
                "sentiment": e.get("sentiment", "neutral"),
            }
            if e.get("draft_reply"):
                item["has_draft_reply"] = True
            briefing_items.append(item)

        # Count summary — avoid composite index by fetching without order_by
        try:
            all_docs = await asyncio.to_thread(
                lambda: list(
                    db.collection("scored_emails").limit(10000).stream()
                )
            )
        except Exception:
            all_docs = []
        all_emails = [d.to_dict() for d in all_docs]
        unread = sum(1 for e in all_emails if e.get("is_unread"))
        critical = sum(1 for e in all_emails if e.get("priority") == "critical")
        urgent = sum(1 for e in all_emails if e.get("priority") == "urgent")

        return {
            "summary": {
                "total_recent": len(all_emails),
                "unread": unread,
                "critical": critical,
                "urgent": urgent,
                "action_required": len(action_emails),
            },
            "action_items": briefing_items,
            "voice_briefing": _build_voice_briefing(briefing_items, critical, urgent, unread),
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Briefing generation failed: {e}")


def _build_voice_briefing(items: list[dict], critical: int, urgent: int, unread: int) -> str:
    """Build a natural-language briefing for voice delivery."""
    lines = []

    if critical + urgent == 0 and not items:
        return "Your inbox is clear — no action-required emails right now."

    lines.append(f"You have {len(items)} emails that need your attention.")
    if critical:
        lines.append(f"{critical} are critical priority.")
    if urgent:
        lines.append(f"{urgent} are urgent.")

    for i, item in enumerate(items[:5]):
        sender = item.get("sender", "Someone")
        subject = item.get("subject", "")[:60]
        briefing = item.get("briefing", "")
        if briefing:
            lines.append(f"{i+1}. From {sender}: {briefing}")
        else:
            lines.append(f"{i+1}. From {sender} about \"{subject}\".")

    if len(items) > 5:
        lines.append(f"Plus {len(items) - 5} more that need review.")

    return " ".join(lines)


async def _save_contact_config():
    """Persist the contact database config to Firestore."""
    if not _email_scanner or not _brain_store:
        return
    contact_db = getattr(_email_scanner, "_contacts", None)
    if not contact_db:
        return
    try:
        config = contact_db.to_config()
        config["updated_at"] = time.time()
        db = _brain_store._db
        ref = db.collection("config").document(f"contacts_{FOUNDER_ID}")
        await asyncio.to_thread(lambda: ref.set(config, merge=True))
    except Exception as e:
        print(f"[EmailIntelligence] ⚠️ Contact config save failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# RAG Email Search, Voice-Matched Drafts, Split Inbox, Embed Sync
# (powered by agents/email_memory.py + agents/voice_drafter.py)
# ─────────────────────────────────────────────────────────────────────────────


class SearchRequest(BaseModel):
    query: str
    top_k: int = 20
    rerank_top: int = 5
    include_sent: bool = True


@app.post("/brain/emails/search")
async def search_emails(req: SearchRequest):
    """
    Natural language semantic search across the founder's email history.
    Uses RAG pipeline: query → embed → vector KNN → re-rank → answer generation.
    """
    if not _email_memory:
        raise HTTPException(503, "Email memory not initialized")
    try:
        result = await _email_memory.search_and_answer(
            query=req.query,
            top_k=req.top_k,
            rerank_top=req.rerank_top,
            include_sent=req.include_sent,
        )
        return result
    except Exception as e:
        raise HTTPException(500, f"Email search failed: {e}")


@app.get("/brain/emails/splits")
async def get_email_splits():
    """
    Get all scored emails organized by split inbox tabs.
    Returns: {split_name: [emails]} for each tab.
    """
    if not _brain_store:
        raise HTTPException(503, "Brain not initialized")
    if not _split_inbox:
        raise HTTPException(503, "Split inbox not initialized")
    try:
        db = _brain_store._db
        docs = await asyncio.to_thread(
            lambda: list(
                db.collection("scored_emails")
                .order_by("processed_at", direction="DESCENDING")
                .limit(10000)
                .stream()
            )
        )
        emails = [d.to_dict() for d in docs]

        # Set founder domain for team detection
        if _email_scanner:
            scoring = getattr(_email_scanner, "_scoring", None)
            if scoring and scoring._founder_email:
                domain = scoring._founder_email.split("@")[-1]
                _split_inbox.set_founder_domain(domain)

        splits = _split_inbox.categorize_batch(emails)

        # Add counts
        counts = {name: len(items) for name, items in splits.items()}
        return {
            "splits": splits,
            "counts": counts,
            "total": len(emails),
        }
    except Exception as e:
        raise HTTPException(500, f"Split inbox fetch failed: {e}")


class DraftRequest(BaseModel):
    recipient_email: str
    recipient_name: str = ""
    thread_subject: str = ""
    thread_body: str = ""
    instruction: str = ""


@app.post("/brain/emails/draft")
async def generate_draft(req: DraftRequest):
    """
    Generate a voice-matched email draft for a specific recipient.
    Analyzes past sent emails for style matching.
    """
    if not _voice_drafter:
        raise HTTPException(503, "Voice drafter not initialized")
    try:
        result = await _voice_drafter.generate_draft(
            recipient_email=req.recipient_email,
            recipient_name=req.recipient_name,
            thread_subject=req.thread_subject,
            thread_body=req.thread_body,
            instruction=req.instruction,
        )
        return result.to_dict()
    except Exception as e:
        raise HTTPException(500, f"Draft generation failed: {e}")


@app.get("/brain/emails/style/{contact_email:path}")
async def get_writing_style(contact_email: str):
    """
    Get the founder's writing style profile for a specific contact.
    Shows formality, tone, avg length, greeting/closing patterns.
    """
    if not _voice_drafter:
        raise HTTPException(503, "Voice drafter not initialized")
    try:
        profile = await _voice_drafter.get_style_profile(contact_email)
        return profile
    except Exception as e:
        raise HTTPException(500, f"Style profile fetch failed: {e}")


class EmbedSyncRequest(BaseModel):
    hours_back: int = 87600  # Default: ~10 years (all emails)
    max_emails: int = 10000  # Max emails per category to fetch
    batch_size: int = 50     # Emails to fetch details for concurrently


@app.post("/brain/emails/embed-sync")
async def trigger_embed_sync(req: EmbedSyncRequest):
    """
    Production-grade email embedding sync.
    Fetches ALL historical emails and embeds them for semantic search.
    Supports paginated Gmail fetching for millions of emails.
    Skips already-embedded emails for efficient incremental sync.
    """
    if not _email_memory or not _gmail:
        raise HTTPException(503, "Email memory or Gmail not initialized")
    try:
        from datetime import datetime, timedelta

        # Calculate the date range
        since_date = datetime.utcnow() - timedelta(hours=req.hours_back)
        since_str = since_date.strftime("%Y/%m/%d")

        async def fetch_and_embed(query: str, is_sent: bool, max_results: int) -> tuple[int, int]:
            """Fetch emails in paginated batches and embed them."""
            messages = await _gmail.list_messages(
                query=query,
                max_results=max_results,
            )
            total_fetched = len(messages)
            total_embedded = 0

            # Process in concurrent batches for speed
            for i in range(0, len(messages), req.batch_size):
                batch_msgs = messages[i:i + req.batch_size]

                # Fetch full email details concurrently
                tasks = [_gmail.get_message(m["id"]) for m in batch_msgs]
                results = await asyncio.gather(*tasks, return_exceptions=True)

                emails = []
                for full in results:
                    if isinstance(full, Exception) or not full:
                        continue
                    email_dict = {
                        "message_id": full.message_id,
                        "thread_id": full.thread_id,
                        "sender": full.sender,
                        "sender_email": full.sender_email,
                        "subject": full.subject,
                        "body": full.body,
                        "date": full.date,
                        "timestamp": full.timestamp,
                    }
                    if is_sent:
                        email_dict["to_email"] = getattr(full, "to_email", "") or ""
                    emails.append(email_dict)

                if emails:
                    count = await _email_memory.embed_emails(emails, is_sent=is_sent)
                    total_embedded += count

                # Progress logging every 200 emails
                processed = min(i + req.batch_size, len(messages))
                if processed % 200 == 0 or processed == len(messages):
                    print(f"[EmbedSync] {'Sent' if is_sent else 'Inbox'}: {processed}/{total_fetched} fetched, {total_embedded} embedded")

            return total_fetched, total_embedded

        # Fetch and embed inbox emails (all historical)
        inbox_fetched, inbox_embedded = await fetch_and_embed(
            query=f"after:{since_str} -in:sent -in:trash -in:spam",
            is_sent=False,
            max_results=req.max_emails,
        )

        # Fetch and embed sent emails (all historical)
        sent_fetched, sent_embedded = await fetch_and_embed(
            query=f"in:sent after:{since_str}",
            is_sent=True,
            max_results=min(req.max_emails, 5000),
        )

        stats = await _email_memory.get_embed_stats()

        return {
            "inbox_fetched": inbox_fetched,
            "inbox_embedded": inbox_embedded,
            "sent_fetched": sent_fetched,
            "sent_embedded": sent_embedded,
            "total_fetched": inbox_fetched + sent_fetched,
            "total_embedded": inbox_embedded + sent_embedded,
            "stats": stats,
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Embed sync failed: {e}")


@app.get("/brain/emails/embed-stats")
async def get_embed_stats():
    """Get embedding pipeline statistics."""
    if not _email_memory:
        raise HTTPException(503, "Email memory not initialized")
    try:
        stats = await _email_memory.get_embed_stats()
        return stats
    except Exception as e:
        raise HTTPException(500, f"Embed stats fetch failed: {e}")


class SplitMoveRequest(BaseModel):
    message_id: str
    sender_email: str = ""
    target_split: str


@app.post("/brain/emails/split-move")
async def record_split_move(req: SplitMoveRequest):
    """
    Record a manual split move (founder moved email to different tab).
    After 3 consistent moves from same sender, auto-learns the rule.
    """
    if not _split_inbox:
        raise HTTPException(503, "Split inbox not initialized")
    try:
        _split_inbox.record_manual_move(
            message_id=req.message_id,
            sender_email=req.sender_email,
            target_split=req.target_split,
        )
        return {
            "moved": True,
            "learned_rules": _split_inbox.get_learned_rules(),
        }
    except Exception as e:
        raise HTTPException(500, f"Split move failed: {e}")


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
