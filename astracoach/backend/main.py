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
_email_scanner = None
_risk_monitor  = None
_brain_tool_fns = None   # dict of {name: async_fn} from brain_tools.build_tools()

# ─────────────────────────────────────────────
# App lifecycle
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _brain_store, _embeddings, _gmail, _calendar, _email_scanner, _risk_monitor, _brain_tool_fns

    print("🚀 Astra OS starting...")
    print(f"   Voice Model: {os.getenv('GEMINI_MODEL', 'gemini-2.5-flash-native-audio-latest')}")

    # ── Initialize Company Brain (if Firestore is configured) ──
    if FIRESTORE_PROJECT and GOOGLE_API_KEY:
        try:
            from brain.store import CompanyBrainStore
            from brain.embeddings import EmbeddingPipeline
            from integrations.gmail_client import GmailClient
            from integrations.calendar_client import CalendarClient

            _brain_store = CompanyBrainStore(project_id=FIRESTORE_PROJECT)
            _embeddings  = EmbeddingPipeline(api_key=GOOGLE_API_KEY)
            _gmail       = GmailClient(CREDENTIALS_PATH, TOKEN_PATH)
            _calendar    = CalendarClient(CREDENTIALS_PATH, TOKEN_PATH)

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

    # If we got here, everything failed
    raise HTTPException(
        status_code=500,
        detail="Avatar generation failed across all models. Please ensure your API key has Image generation enabled.",
    )


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
        brain_tools=_brain_tool_fns,      # 22 brain tools for Astra OS voice session
        brain_store=_brain_store,         # for proactive alerts on session start
        founder_id=FOUNDER_ID,            # for querying brain state
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
