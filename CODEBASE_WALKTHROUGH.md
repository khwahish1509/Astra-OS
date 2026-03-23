# Astra OS — Complete Codebase Walkthrough

> How everything works, end to end, and how to start it.

---

## Quick Start Commands

### Local Development

```bash
# 1. Clone
git clone https://github.com/khwahish1509/update_name
cd update_name/astracoach

# 2. Configure environment
cp .env.example .env
# Edit .env → fill in GOOGLE_API_KEY and FIRESTORE_PROJECT_ID

# 3. Start Backend
cd backend
pip install -r requirements.txt
python main.py
# → Uvicorn running on http://0.0.0.0:8000

# 4. Start Frontend (new terminal)
cd frontend
npm install
npm run dev
# → Vite ready at http://localhost:5173

# 5. Open Chrome → http://localhost:5173
```

### Cloud Run Deployment

```bash
cd astracoach
chmod +x deploy.sh
./deploy.sh
# Automates: enable APIs → create Artifact Registry → check secrets → Cloud Build → deploy
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER (React 18 + Vite)                    │
│                                                                     │
│  SetupScreen → InterviewRoom → DashboardView                       │
│       │              │                │                             │
│       │         ┌────┴────┐     ┌─────┴─────┐                      │
│       │    useAudioPipeline  useInterviewSession                    │
│       │    (mic 16kHz ↔      (WebSocket ↔                          │
│       │     speaker 24kHz)    /ws/interview)                        │
│       │         │                  │                                │
│       │    GeminiAvatar       useScreenShareCropper                 │
│       │    (FFT lip-sync)     (768×768 @ 1FPS)                     │
│       │         │                                                   │
│       │    useSimliAvatar (optional)                                │
│       │    (LiveKit WebRTC → Simli API)                             │
└───────┼─────────┼──────────────────┼────────────────────────────────┘
        │         │                  │
        │    RAW PCM AUDIO      JSON + BINARY
        │    (bidirectional)    (WebSocket frames)
        │         │                  │
┌───────┼─────────┼──────────────────┼────────────────────────────────┐
│       ▼         ▼                  ▼                                │
│              FastAPI Backend (Cloud Run, port 8080)                  │
│                                                                     │
│  main.py ─── 41 REST endpoints + 1 WebSocket                       │
│      │                                                              │
│      ├── GeminiLiveBridge (gemini_session.py)                       │
│      │   └── Gemini 2.5 Flash Native Audio (bidiGenerateContent)    │
│      │   └── 60 ADK FunctionTools dispatched during live stream     │
│      │   └── Screen vision analysis (closure → genai.generate)      │
│      │   └── Post-session: summarize → FirestoreMemoryService       │
│      │                                                              │
│      ├── CompanyBrainStore (brain/store.py)                         │
│      │   └── Firestore CRUD + Vector Search (find_nearest)          │
│      │   └── Collections: insights, relationships, tasks, alerts    │
│      │                                                              │
│      ├── EmbeddingPipeline (brain/embeddings.py)                    │
│      │   └── text-embedding-004, 768 dimensions                     │
│      │   └── RETRIEVAL_DOCUMENT (storage) vs RETRIEVAL_QUERY        │
│      │                                                              │
│      ├── FirestoreMemoryService (memory/)                           │
│      │   └── 3-layer memory: events, episodes, facts                │
│      │   └── Keyword + semantic search across all layers            │
│      │   └── Session summaries via Gemini Flash extraction          │
│      │                                                              │
│      ├── Background Agents (agents/background.py)                   │
│      │   ├── EmailScannerAgent (every 15 min)                       │
│      │   │   └── Gmail poll → Gemini extract → embed → Firestore    │
│      │   └── RiskMonitorAgent (every 30 min)                        │
│      │       └── Overdue commitments + at-risk relationships        │
│      │       └── Blocked tasks → Alert generation                   │
│      │                                                              │
│      └── Integrations (integrations/)                               │
│          ├── GmailClient     (Gmail API v1)                         │
│          ├── CalendarClient  (Calendar API v3)                      │
│          ├── DriveClient     (Drive API v3)                         │
│          ├── TasksClient     (Tasks API v1)                         │
│          └── ContactsClient  (People API v1)                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Google Cloud Platform                             │
│                                                                     │
│  Firestore          Secret Manager       Cloud Build                │
│  (8 collections)    (GOOGLE_API_KEY)     (CI/CD pipeline)           │
│                                                                     │
│  Gemini 2.5 Flash   text-embedding-004   Gmail/Calendar/Drive APIs  │
│  Native Audio       (768-dim vectors)    (OAuth 2.0)                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## How Everything Works — File by File

### 1. Entry Point: `backend/main.py`

This is the heart of the server. On startup (`lifespan` context manager), it:

1. Reads `GOOGLE_API_KEY` and `FIRESTORE_PROJECT_ID` from `.env`
2. Initializes `SessionStore()` — auto-selects Firestore (if project ID set) or in-memory
3. Initializes `CompanyBrainStore` → connects to Firestore
4. Initializes `EmbeddingPipeline` → wraps text-embedding-004
5. Initializes `FirestoreMemoryService` → 3-layer long-term memory
6. Builds 60 `FunctionTool` closures from `brain_tools.py` (bound to the store/integrations)
7. Starts `EmailScannerAgent` background loop (15 min interval)
8. Starts `RiskMonitorAgent` background loop (30 min interval)
9. Sets up Gmail OAuth flow if credentials exist

It exposes 41 REST endpoints grouped as:

- **Session endpoints**: `POST /api/session/create`, `POST /api/session/{id}/end`
- **WebSocket**: `WS /ws/interview/{id}` — the real-time voice bridge
- **Brain endpoints**: `/brain/summary`, `/brain/insights`, `/brain/alerts`, `/brain/relationships`, `/brain/tasks/*`, `/brain/memory/*`
- **Integration triggers**: `/brain/scan` (email), `/brain/monitor` (risk)
- **Auth**: `/auth/gmail` (OAuth redirect)
- **Health**: `/health`
- **Avatar**: `/api/generate-avatar` (Imagen-3)
- **Voices**: `/api/voices` (lists Gemini Live voices)
- **Static files**: Serves the built React frontend from `/static`

### 2. Voice Session: `backend/gemini_session.py` (GeminiLiveBridge)

This is the most complex file. It manages a single Gemini Live session:

**Session Lifecycle:**
1. `run(websocket)` is called when a client connects to `/ws/interview/{id}`
2. It loads the user's long-term memory from `FirestoreMemoryService.get_recent_context()` and injects it into the system prompt
3. Opens a `bidiGenerateContent` stream to Gemini 2.5 Flash Native Audio
4. Spawns 3 concurrent async tasks:
   - **`_recv_from_gemini()`** — reads Gemini responses (audio chunks, text, tool calls)
   - **`_recv_from_browser()`** — reads WebSocket messages (PCM audio, camera frames, screen frames)
   - **`_vision_loop()`** — periodically analyzes screen content with a separate Gemini call

**Audio Flow:**
- Browser sends PCM16 binary frames → forwarded as `RealtimeInput` to Gemini
- Gemini sends back PCM16 audio → forwarded as binary WebSocket frames to browser
- Gemini also sends transcript text, tool calls, and status updates as JSON

**Tool Execution:**
- When Gemini decides to call a tool (e.g., `get_recent_emails`, `create_task`), it sends a `toolCall` message
- The bridge looks up the function in the 60-tool registry and executes it
- Results are sent back to Gemini as `FunctionResponse` so it can continue speaking

**Post-Session:**
- On disconnect, fires `summarize_and_persist()` as a background task
- Also calls `FirestoreMemoryService.add_session_to_memory()` to persist conversation events, generate episode summaries, and extract facts

### 3. Agent Tools: `backend/agent_tools.py` + `backend/agents/brain_tools.py`

**`agent_tools.py`** — 5 general-purpose tools (web search, evaluate, coach, remember, plan). These are declared both as ADK `FunctionTool` wrappers and as raw Gemini Live `function_declarations`.

**`brain_tools.py`** — 60 domain-specific tools. This is where the real power is. A factory function `build_brain_tools()` creates closures that capture references to the BrainStore, EmbeddingPipeline, and integration clients. Tool groups include:

- **Memory/Insights**: `search_brain`, `get_brain_summary`, `get_recent_insights`, `update_insight_status`
- **Relationships**: `get_relationship_health`, `get_at_risk_relationships`
- **Tasks**: `list_open_tasks`, `create_task`, `complete_task`, `update_task`, `add_task_comment`
- **Alerts**: `get_pending_alerts`, `dismiss_alert`, `get_overdue_commitments`
- **Gmail**: `get_recent_emails`, `search_emails`, `send_email`, `reply_to_email`, `get_unread_count`
- **Calendar**: `get_upcoming_events`, `get_todays_events`, `create_event`, `get_meeting_context`
- **Drive**: `search_drive`, `list_recent_drive_files`, `create_google_doc`
- **Tasks (Google)**: `list_google_tasks`, `create_google_task`, `complete_google_task`
- **Contacts**: `search_contacts`, `get_contact_by_email`
- **Company Context**: `get_founder_profile`, `get_team_roster`
- **Email Routing**: `route_email`, `get_routing_rules`, `create_routing_rule`

Each tool includes a TTL cache to reduce Firestore/API round-trips.

### 4. Background Agents: `backend/agents/background.py`

**EmailScannerAgent:**
- Runs every 15 minutes as an `asyncio.create_task` loop
- Fetches recent Gmail messages via `GmailClient.get_recent_emails()`
- Sends each email to Gemini 2.0 Flash with a structured extraction prompt
- Gemini returns JSON: `[{type: "commitment|risk|decision|...", content, parties, due_date}]`
- Each insight is embedded with text-embedding-004 and stored in Firestore
- Also updates `RelationshipProfile` health scores (risk signals decrease health, positive interactions increase it)

**RiskMonitorAgent:**
- Runs every 30 minutes
- Checks 3 things concurrently: overdue commitments, at-risk relationships (health < 0.4), blocked tasks (> 24h)
- Creates `Alert` objects with severity levels (LOW/MEDIUM/HIGH/CRITICAL) and stores in Firestore
- Alerts are surfaced via the voice session or dashboard

### 5. Brain Layer: `backend/brain/`

**`models.py`** — 12 dataclasses + 8 enums defining every data type:
- `Insight` (the atomic unit — commitments, risks, decisions, action items, opportunities)
- `RelationshipProfile` (health score 0-1, tone trend, interaction count, open commitments)
- `Task` (title, assignee, priority, status, comments, tags)
- `Alert` (severity, status lifecycle: pending → surfaced → dismissed/resolved)
- `FounderProfile`, `Team`, `RoutingRule`, `RoutedEmail`, `EmailMessage`

**`store.py`** — `CompanyBrainStore` backed by Firestore. 8 collections:
- `brain_insights` (with 768-dim vector embeddings for semantic search via `find_nearest`)
- `brain_relationships`, `brain_tasks`, `brain_alerts`, `brain_founders`, `brain_teams`, `brain_routing_rules`, `brain_routed_emails`

**`embeddings.py`** — `EmbeddingPipeline` wrapping text-embedding-004. Two modes:
- `RETRIEVAL_DOCUMENT` for storage, `RETRIEVAL_QUERY` for search
- `embed_batch()` for concurrent bulk embedding

### 6. Memory Service: `backend/memory/firestore_memory_service.py`

Implements ADK's `BaseMemoryService` with 3 memory layers:

1. **Conversational Memory**: Raw event turns stored in `astra_memories/{user}/events/`
2. **Episodic Memory**: Structured session summaries in `astra_memories/{user}/episodes/` — generated by Gemini Flash analyzing the transcript (extracts: summary, topics, decisions, action items, people, facts, mood)
3. **Semantic/Fact Memory**: Extracted facts/preferences in `astra_memories/{user}/facts/`

**Search** combines keyword matching across all 3 layers, returns top 15 results.

**Session startup** calls `get_recent_context()` which injects a "Memory Bank" block into the system prompt with known facts and recent episode summaries.

### 7. Session Store: `backend/session_store.py`

Dual-backend session persistence:
- **InMemorySessionStore**: Dict-based, for local dev
- **FirestoreSessionStore**: Firestore-backed with in-process cache for hot-path reads

Factory `SessionStore()` auto-selects based on `FIRESTORE_PROJECT_ID` env var.

Also includes `summarize_and_persist()` — a background task that runs Gemini Flash on the conversation transcript to extract strengths/weaknesses/topics and merges into a `UserProfile`.

### 8. Integrations: `backend/integrations/`

Five Google API clients sharing OAuth credentials:

| Client | API | Key Methods |
|--------|-----|-------------|
| **GmailClient** | Gmail v1 | `get_recent_emails()`, `search_emails()`, `send_email()`, `reply_to_thread()` |
| **CalendarClient** | Calendar v3 | `get_upcoming_events()`, `create_event()` (auto-Meet link), `quick_add()` |
| **DriveClient** | Drive v3 | `search_files()`, `list_recent_files()`, `create_doc()` |
| **TasksClient** | Tasks v1 | `get_tasks()`, `create_task()`, `complete_task()` |
| **ContactsClient** | People v1 | `search_contacts()`, `get_contact_by_email()`, `list_contacts()` |

All use `asyncio.to_thread()` for non-blocking execution and share a single `gmail_token.json` OAuth token.

### 9. Frontend: `frontend/src/`

**`App.jsx`** — Router: shows `SetupScreen` when no session, `InterviewRoom` when active.

**`SetupScreen.jsx`** — Premium landing page with:
- Name input, voice selector (fetches from `/api/voices`)
- Brain summary stats (fetches from `/brain/summary`)
- Two launch modes: Full Session (creates backend session) or Demo Preview
- Animated gradient background, glass-morphism cards

**`InterviewRoom.jsx`** — 3-column layout:
- **Left sidebar** (72px): 6 nav icons (Dashboard, Email, CRM, Tasks, Calendar, Brain)
- **Center**: DashboardView content area
- **Right panel** (38%): Avatar + transcript + tool pills
- **Bottom bar** (48px): Status indicator + elapsed timer

**`DashboardView.jsx`** — Content router fetching from 12 brain API endpoints. Shows:
- KPI cards (sessions, insights, relationships, alerts)
- Pending alerts with severity badges
- Relationship health bars
- Task Kanban board
- Email triage/routing view
- Brain memory explorer

**`GeminiAvatar.jsx`** — Dual rendering:
- Portrait mode: Imagen-3 generated face with 3-slice lip-sync on canvas
- SVG orb: Animated blue orb with eyes/mouth, blinking, FFT-driven rings

### 10. Audio Pipeline: `frontend/src/hooks/`

**`useAudioPipeline.js`** — Manages two AudioContexts:
- **Capture**: Mic → AudioWorklet (16kHz) → PCM16 chunks (50ms) → WebSocket
- **Playback**: WebSocket → PCM16 → AudioWorklet (24kHz) → GainNode → AnalyserNode → Speakers
- Exposes `analyserNode` for avatar FFT visualization

**`useInterviewSession.js`** — WebSocket coordinator:
- Connects to `ws/interview/{sessionId}`
- Routes binary frames (PCM audio) and JSON messages (status, transcript, tool_call, interrupted)
- Sends camera frames (320×240 JPEG @ 1fps) and screen frames (768×768 @ 1fps)
- Handles barge-in: on `interrupted` → flush playback buffer

**`useScreenShareCropper.js`** — Screen sharing:
- `getDisplayMedia()` → 768×768 squished canvas → JPEG @ 1fps
- Sends to backend where GeminiLiveBridge analyzes it with vision

**`useSimliAvatar.js`** — Optional realistic talking avatar:
- Fetches session token from Simli API
- Creates SimliClient (LiveKit WebRTC)
- Downsamples 24kHz PCM → 16kHz for Simli's lip-sync
- Falls back to GeminiAvatar SVG orb if unavailable

### 11. AudioWorklet Processors: `frontend/public/`

**`capture-processor.js`**: Mic audio → Float32 → Int16 → posts 800-sample chunks (50ms @ 16kHz)

**`playback-processor.js`**: Queue-based jitter buffer, outputs PCM, reports RMS amplitude. Supports `flush` (for interruption) and `resume` commands.

### 12. Deployment: Docker + Cloud Build + Cloud Run

**`Dockerfile`**: Multi-stage — Stage 1 builds React with Node 20, Stage 2 runs FastAPI with Python 3.11. Non-root user, healthcheck, port 8080.

**`cloudbuild.yaml`**: 3-step pipeline → Build → Push to Artifact Registry → Deploy to Cloud Run (2 CPU, 1Gi RAM, 0-20 instances, public access, secrets from Secret Manager).

**`deploy.sh`**: One-command script that enables APIs, creates Artifact Registry, checks for API key secret, grants IAM permissions, then submits Cloud Build.

---

## Data Flow: What Happens When You Say "Brief Me On My Day"

```
1. Browser captures mic audio → AudioWorklet → PCM16 chunks
2. useAudioPipeline sends chunks → WebSocket → FastAPI backend
3. GeminiLiveBridge forwards PCM → Gemini 2.5 Flash Native Audio (bidiGenerateContent)
4. Gemini processes speech, decides to call tools:
   → get_brain_summary()        → Firestore query
   → get_overdue_commitments()  → Firestore query
   → get_pending_alerts()       → Firestore query
   → get_todays_events()        → Google Calendar API
5. Tool results sent back to Gemini as FunctionResponse
6. Gemini generates spoken response (PCM24 audio + transcript text)
7. Audio PCM → WebSocket binary → browser → AudioWorklet → speakers
8. Transcript JSON → WebSocket → browser → transcript panel
9. Tool call names → WebSocket → browser → animated tool pills
10. AnalyserNode FFT data → GeminiAvatar → lip-sync animation
```

---

## Environment Variables Required

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | Yes | From aistudio.google.com |
| `FIRESTORE_PROJECT_ID` | Yes | GCP project with Firestore enabled |
| `GEMINI_MODEL` | No | Default: `gemini-2.5-flash-preview-native-audio-12-2025` |
| `GMAIL_TOKEN_PATH` | For email | OAuth token for Gmail/Calendar/Drive/Tasks/Contacts |
| `GOOGLE_CREDENTIALS_PATH` | Local only | Service account JSON (auto on Cloud Run) |
| `FOUNDER_ID` | No | Default: `default_founder` |
| `EMAIL_SCAN_INTERVAL_MINUTES` | No | Default: 15 |
| `RISK_CHECK_INTERVAL_MINUTES` | No | Default: 30 |
| `VITE_SIMLI_API_KEY` | No | For realistic avatar (optional) |
| `VITE_SIMLI_FACE_ID` | No | Simli face ID (optional) |
| `PORT` | No | Default: 8000 local, 8080 Cloud Run |

---

## Firestore Collections

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `brain_insights` | Commitments, risks, decisions, action items | embedding (768-dim Vector), type, parties, due_date |
| `brain_relationships` | Contact health tracking | health_score (0-1), tone_trend, open_commitments |
| `brain_tasks` | Task management | title, assignee, status, priority, comments |
| `brain_alerts` | Proactive risk alerts | severity, status (pending→surfaced→resolved) |
| `brain_founders` | Founder profiles | name, email, company_context, team_members |
| `brain_teams` | Team structure | members, color, email_alias |
| `brain_routing_rules` | Email routing rules | conditions, priority, auto_assign_to |
| `brain_routed_emails` | Routed email records | category, urgency, sentiment, status |
| `astra_sessions` | Active voice sessions | transcript, memories, vision |
| `astra_user_profiles` | Cross-session user profiles | strengths, weaknesses, topics_covered |
| `astra_memories/{user}/events` | Conversation turns | text, author, timestamp |
| `astra_memories/{user}/episodes` | Session summaries | summary, topics, decisions, action_items |
| `astra_memories/{user}/facts` | Extracted facts | fact, category |
