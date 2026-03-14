"""
Astra OS — FastAPI Application Entry Point
============================================
Bootstraps all services, starts background agents, and exposes:

  GET  /health                  — health check
  GET  /auth/gmail              — initiate Gmail OAuth flow
  GET  /auth/status             — check auth status
  POST /onboard                 — save founder profile
  GET  /founder                 — get founder profile
  WS   /voice/{session_id}      — Gemini Live voice session
  GET  /brain/summary           — brain state overview (REST)
  GET  /brain/insights          — list active insights
  GET  /brain/alerts            — pending alerts
  POST /brain/scan              — trigger manual email scan
  POST /brain/alerts/{id}/dismiss — dismiss an alert

Background tasks started at startup:
  - EmailScannerAgent   (polls Gmail every 15 min)
  - RiskMonitorAgent    (checks brain every 30 min)

Config: all secrets read from .env via python-dotenv.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()


# ── Config from .env ───────────────────────────────────────────────────────

GOOGLE_API_KEY      = os.getenv("GOOGLE_API_KEY", "")
FIRESTORE_PROJECT   = os.getenv("FIRESTORE_PROJECT_ID", "")
CREDENTIALS_PATH    = os.getenv("GOOGLE_CREDENTIALS_PATH", "credentials.json")
TOKEN_PATH          = os.getenv("GMAIL_TOKEN_PATH", "gmail_token.json")
FOUNDER_ID          = os.getenv("FOUNDER_ID", "default_founder")
EMAIL_SCAN_INTERVAL = int(os.getenv("EMAIL_SCAN_INTERVAL_MINUTES", "15"))
RISK_CHECK_INTERVAL = int(os.getenv("RISK_CHECK_INTERVAL_MINUTES", "30"))


# ── Service singletons (created at startup) ────────────────────────────────

_store: "CompanyBrainStore | None" = None
_embeddings: "EmbeddingPipeline | None" = None
_gmail: "GmailClient | None" = None
_calendar: "CalendarClient | None" = None
_coordinator: "LlmAgent | None" = None
_email_scanner: "EmailScannerAgent | None" = None
_risk_monitor: "RiskMonitorAgent | None" = None


# ── Startup / Shutdown ────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize all services on startup, shut down cleanly on exit."""
    global _store, _embeddings, _gmail, _calendar
    global _coordinator, _email_scanner, _risk_monitor

    print("[Astra OS] 🚀 Starting up...")

    # Validate required config
    if not GOOGLE_API_KEY:
        raise RuntimeError("GOOGLE_API_KEY is required in .env")
    if not FIRESTORE_PROJECT:
        raise RuntimeError("FIRESTORE_PROJECT_ID is required in .env")

    # ── Core services
    from brain.store import CompanyBrainStore
    from brain.embeddings import EmbeddingPipeline
    from integrations.gmail import GmailClient
    from integrations.calendar_client import CalendarClient

    _store      = CompanyBrainStore(project_id=FIRESTORE_PROJECT)
    _embeddings = EmbeddingPipeline(api_key=GOOGLE_API_KEY)
    _gmail      = GmailClient(CREDENTIALS_PATH, TOKEN_PATH)
    _calendar   = CalendarClient(CREDENTIALS_PATH, TOKEN_PATH)

    # ── Coordinator agent
    from agents.tools import ToolDeps
    from agents.coordinator import build_coordinator

    deps = ToolDeps(
        store      = _store,
        embeddings = _embeddings,
        gmail      = _gmail,
        calendar   = _calendar,
        founder_id = FOUNDER_ID,
    )
    _coordinator = build_coordinator(deps)

    # ── Background agents
    from agents.background import EmailScannerAgent, RiskMonitorAgent

    _email_scanner = EmailScannerAgent(
        store       = _store,
        embeddings  = _embeddings,
        gmail       = _gmail,
        api_key     = GOOGLE_API_KEY,
        founder_id  = FOUNDER_ID,
        scan_interval_minutes = EMAIL_SCAN_INTERVAL,
    )
    _risk_monitor = RiskMonitorAgent(
        store      = _store,
        api_key    = GOOGLE_API_KEY,
        founder_id = FOUNDER_ID,
        check_interval_minutes = RISK_CHECK_INTERVAL,
    )

    # Start background agents only if Gmail is authenticated
    if _gmail.is_authenticated():
        _email_scanner.start()
        _risk_monitor.start()
        print("[Astra OS] ✅ Background agents running")
    else:
        print("[Astra OS] ⚠️  Gmail not authenticated — background agents paused")
        print("[Astra OS]    Visit /auth/gmail to authenticate")

    print("[Astra OS] ✅ Ready")
    yield

    # ── Shutdown
    print("[Astra OS] 🛑 Shutting down...")
    if _email_scanner:
        await _email_scanner.stop()
    if _risk_monitor:
        await _risk_monitor.stop()


app = FastAPI(
    title     = "Astra OS — The Founder's Operating System",
    version   = "1.0.0",
    lifespan  = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)


# ── Helpers ────────────────────────────────────────────────────────────────

def require_store():
    if _store is None:
        raise HTTPException(503, "Brain store not initialized")
    return _store

def require_gmail():
    if _gmail is None:
        raise HTTPException(503, "Gmail client not initialized")
    return _gmail

def require_coordinator():
    if _coordinator is None:
        raise HTTPException(503, "Coordinator agent not initialized")
    return _coordinator


# ── Health ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status":         "ok",
        "gmail_auth":     _gmail.is_authenticated() if _gmail else False,
        "background_agents": {
            "email_scanner": _email_scanner._running if _email_scanner else False,
            "risk_monitor":  _risk_monitor._running if _risk_monitor else False,
        },
    }


# ── Auth ──────────────────────────────────────────────────────────────────

@app.get("/auth/status")
async def auth_status():
    gmail = require_gmail()
    authenticated = gmail.is_authenticated()
    return {"gmail_authenticated": authenticated}


@app.get("/auth/gmail")
async def authenticate_gmail():
    """
    Trigger the Gmail OAuth flow. This opens a browser window on the server.
    In production, replace with a proper OAuth redirect flow.
    """
    gmail = require_gmail()
    try:
        # This will open browser if not authenticated
        await asyncio.to_thread(gmail._build_service)

        # Start background agents if they weren't running
        if _email_scanner and not _email_scanner._running:
            _email_scanner.start()
        if _risk_monitor and not _risk_monitor._running:
            _risk_monitor.start()

        return {"status": "authenticated", "message": "Gmail connected successfully"}
    except Exception as e:
        raise HTTPException(500, f"OAuth flow failed: {e}")


# ── Founder / Onboarding ──────────────────────────────────────────────────

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
    store = require_store()
    from brain.models import FounderProfile

    profile = FounderProfile(
        founder_id      = FOUNDER_ID,
        name            = req.name,
        email           = req.email,
        company_name    = req.company_name,
        company_context = req.company_context,
        team_members    = req.team_members,
        timezone        = req.timezone,
    )
    await store.save_founder(profile)
    return {"status": "ok", "founder_id": FOUNDER_ID}


@app.get("/founder")
async def get_founder():
    store = require_store()
    profile = await store.get_founder(FOUNDER_ID)
    if not profile:
        raise HTTPException(404, "Founder profile not found — call /onboard first")
    return {
        "founder_id":     profile.founder_id,
        "name":           profile.name,
        "email":          profile.email,
        "company_name":   profile.company_name,
        "team_members":   profile.team_members,
        "timezone":       profile.timezone,
    }


# ── Brain REST API ────────────────────────────────────────────────────────

@app.get("/brain/summary")
async def brain_summary():
    """High-level brain state: counts and top signals."""
    store = require_store()

    active, at_risk, tasks, alerts, overdue = await asyncio.gather(
        store.get_active_insights(FOUNDER_ID, limit=100),
        store.get_at_risk_relationships(FOUNDER_ID, threshold=0.5),
        store.get_open_tasks(FOUNDER_ID),
        store.get_pending_alerts(FOUNDER_ID),
        store.get_overdue_commitments(FOUNDER_ID),
    )

    type_counts: dict[str, int] = {}
    for i in active:
        type_counts[i.type.value] = type_counts.get(i.type.value, 0) + 1

    return {
        "active_insights":     len(active),
        "insight_breakdown":   type_counts,
        "overdue_commitments": len(overdue),
        "at_risk_contacts":    len(at_risk),
        "open_tasks":          len(tasks),
        "pending_alerts":      len(alerts),
    }


@app.get("/brain/insights")
async def get_insights(type: str | None = None, limit: int = 30):
    """List active insights, optionally filtered by type."""
    store = require_store()
    from brain.models import InsightType

    insight_type = None
    if type:
        try:
            insight_type = InsightType(type)
        except ValueError:
            raise HTTPException(400, f"Invalid insight type: {type}")

    insights = await store.get_active_insights(
        FOUNDER_ID, insight_type=insight_type, limit=limit
    )
    return [
        {
            "id":       i.id,
            "type":     i.type.value,
            "content":  i.content,
            "parties":  i.parties,
            "due_date": i.due_date,
            "source":   i.source.value,
            "status":   i.status.value,
        }
        for i in insights
    ]


@app.get("/brain/alerts")
async def get_alerts(severity: str = "medium"):
    """Get pending alerts above a severity threshold."""
    store = require_store()
    from brain.models import AlertSeverity

    sev_map = {
        "low": AlertSeverity.LOW, "medium": AlertSeverity.MEDIUM,
        "high": AlertSeverity.HIGH, "critical": AlertSeverity.CRITICAL,
    }
    sev = sev_map.get(severity.lower(), AlertSeverity.MEDIUM)
    alerts = await store.get_pending_alerts(FOUNDER_ID, min_severity=sev)
    return [
        {
            "id":              a.id,
            "title":           a.title,
            "message":         a.message,
            "severity":        a.severity.value,
            "related_contact": a.related_contact,
            "created_at":      a.created_at,
        }
        for a in alerts
    ]


@app.post("/brain/alerts/{alert_id}/dismiss")
async def dismiss_alert(alert_id: str):
    store = require_store()
    await store.dismiss_alert(alert_id)
    return {"status": "dismissed"}


@app.post("/brain/scan")
async def trigger_scan(hours_back: int = 24):
    """Manually trigger an email scan."""
    if not _email_scanner:
        raise HTTPException(503, "Email scanner not initialized")
    if not (_gmail and _gmail.is_authenticated()):
        raise HTTPException(401, "Gmail not authenticated — call /auth/gmail first")

    n = await _email_scanner.run_once(hours_back=hours_back)
    return {"insights_extracted": n}


@app.post("/brain/monitor")
async def trigger_monitor():
    """Manually trigger a risk monitoring pass."""
    if not _risk_monitor:
        raise HTTPException(503, "Risk monitor not initialized")

    n = await _risk_monitor.run_once()
    return {"alerts_created": n}


# ── Voice WebSocket ────────────────────────────────────────────────────────

@app.websocket("/voice/{session_id}")
async def voice_endpoint(websocket: WebSocket, session_id: str):
    """
    Gemini Live bidi-streaming WebSocket endpoint.

    Client sends:
      - Raw PCM audio bytes (16kHz, 16-bit, mono)
      - JSON control messages: {"type": "ping"} | {"type": "inject_alert", "text": "..."}

    Server sends:
      - Raw PCM audio bytes (24kHz, 16-bit, mono)
      - JSON control messages: {"type": "pong"}
    """
    await websocket.accept()
    print(f"[Voice] 🔌 WebSocket connected: {session_id}")

    coordinator = require_coordinator()

    from voice.bridge import GeminiBridge

    bridge = GeminiBridge(
        websocket  = websocket,
        agent      = coordinator,
        api_key    = GOOGLE_API_KEY,
        session_id = session_id,
        founder_id = FOUNDER_ID,
    )

    try:
        await bridge.run()
    except WebSocketDisconnect:
        print(f"[Voice] 🔌 WebSocket disconnected: {session_id}")
    except Exception as e:
        print(f"[Voice] ❌ Voice session error: {e}")
    finally:
        if not bridge._closed:
            await bridge.close()


# ── Dev entrypoint ────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host    = "0.0.0.0",
        port    = 8000,
        reload  = True,
        log_level = "info",
    )
