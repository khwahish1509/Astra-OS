# Astra OS — The Founder's Operating System

> **Voice-first AI Chief of Staff powered 100% by Google.**
> *Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com)*

**Live Demo:** [astracoach-rypr3jtzka-uc.a.run.app](https://astracoach-rypr3jtzka-uc.a.run.app)

---

## The Problem

Every startup founder drowns in context-switching: 50 unread emails, 6 meetings, missed follow-ups, and no idea what to prioritize. Existing tools add more tabs, more notifications, more cognitive load.

**Astra changes that.** Instead of opening 10 apps, founders talk to one AI that sees everything — their calendar, inbox, company brain, and team tasks — and acts on it in real-time.

---

## What Astra Does

| Capability | How It Works |
|---|---|
| **Hears you naturally** | Gemini 2.5 Flash Native Audio — real-time PCM16 bidirectional streaming |
| **Speaks back as a human** | Native audio synthesis, zero TTS middleware, zero latency |
| **Sees your screen & camera** | JPEG frames streamed to Gemini Live vision in real-time |
| **Can be interrupted** | Native VAD (Voice Activity Detection) handles barge-in gracefully |
| **Remembers everything** | Firestore-powered long-term memory — facts, episodes, semantic search |
| **Routes your emails** | AI email classification + team routing via Gemini |
| **Manages your tasks** | Voice-created Kanban board with priorities, assignees, due dates |
| **Tracks relationships** | CRM with health scores, tone analysis, follow-up alerts |
| **Surfaces risks proactively** | Background agents monitor for overdue commitments and declining relationships |
| **60 voice tools** | Calendar, email, Drive, Tasks, Contacts, brain queries — all by voice |

**Zero third-party AI services.** One Google API key. One platform.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (React + Vite)                                              │
│                                                                      │
│  ┌───────────────────┐  ┌────────────────────────────────────────┐  │
│  │  AI Avatar         │  │  Dashboard / Brain / Tasks / CRM      │  │
│  │  • FFT lip-sync    │  │  • Real-time KPIs                     │  │
│  │  • State rings     │  │  • Kanban task board                  │  │
│  │  • Camera feed     │  │  • Email routing inbox                │  │
│  └───────────────────┘  │  • Relationship intelligence           │  │
│                          │  • Company brain memory                │  │
│  ┌───────────────────┐  │  • Calendar timeline                   │  │
│  │  Audio Pipeline    │  └────────────────────────────────────────┘  │
│  │  Mic → 16kHz PCM  │                                              │
│  │  Speaker ← 24kHz  │                                              │
│  └───────────────────┘                                              │
└────────────────────────────┬─────────────────────────────────────────┘
              WebSocket /ws/interview/{id}
        (binary PCM16 audio + JSON control)
                             │
┌────────────────────────────▼─────────────────────────────────────────┐
│  FastAPI Backend (Google Cloud Run)                                   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  GeminiLiveBridge — Real-time voice session manager          │   │
│  │  • Proxies browser audio ↔ Gemini Live API                  │   │
│  │  • Dispatches 51+ ADK FunctionTools during live stream      │   │
│  │  • Routes transcript events to browser                       │   │
│  │  • Post-session summarization → long-term memory            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Multi-Agent System (Google ADK)                              │   │
│  │                                                               │   │
│  │  VoiceAgent (primary)        — 60 voice tools, live session  │   │
│  │  EmailScannerAgent (bg)      — scans inbox, extracts insights│   │
│  │  RiskMonitorAgent (bg)       — detects risks, creates alerts │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Company Brain (Firestore Vector Search)                      │   │
│  │  • Insights: commitments, risks, decisions, action items     │   │
│  │  • Relationships: health scores, tone trends, follow-ups     │   │
│  │  • Tasks: Kanban with priorities, tags, comments             │   │
│  │  • Email routing: AI classification, team assignment         │   │
│  │  • Long-term memory: facts, episodes, semantic search        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Google Workspace Integrations                                │   │
│  │  Gmail · Calendar · Drive · Tasks · Contacts                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
          ┌──────────────────▼──────────────────┐
          │  Gemini 2.5 Flash Native Audio       │
          │  Live API (google-genai SDK)         │
          │  • PCM16 16kHz in / 24kHz out       │
          │  • 8 built-in voices                │
          │  • Tool calling during live stream   │
          │  • Vision: JPEG inline images        │
          │  • VAD + barge-in support            │
          └─────────────────────────────────────┘
```

---

## Hackathon Requirements

| Requirement | How We Satisfy It |
|---|---|
| Leverage a Gemini model | Gemini 2.5 Flash Native Audio (Live API) — the core of everything |
| Google GenAI SDK or ADK | Both: `google-genai` for Live API + `google-adk` for 60 FunctionTools |
| Google Cloud service | Cloud Run (hosting) + Cloud Build (CI/CD) + Firestore (vector search + memory) + Secret Manager |
| Live Agents | Real-time bidirectional PCM16 audio + camera vision + barge-in + 3 concurrent agents |

---

## Google Cloud Services Used

| Service | Purpose |
|---|---|
| **Cloud Run** | Hosts the full-stack app with WebSocket support, auto-scaling |
| **Cloud Build** | CI/CD pipeline — builds Docker image, pushes to Artifact Registry, deploys |
| **Firestore** | Vector search for semantic memory, stores all brain data (insights, tasks, relationships, alerts) |
| **Secret Manager** | Securely stores API keys and credentials |
| **Artifact Registry** | Docker image storage |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **LLM + Voice** | Gemini 2.5 Flash Native Audio (Live API) |
| **Agent Framework** | Google ADK — 60 FunctionTools, 3 concurrent agents |
| **Embeddings** | text-embedding-004, 768 dimensions, cosine similarity |
| **Backend** | Python FastAPI + google-genai SDK |
| **Frontend** | React 18 + Vite (custom SVG avatar, dark/light theme) |
| **Audio** | Web AudioWorklet API (capture 16kHz, playback 24kHz) |
| **Database** | Google Cloud Firestore (vector search + persistence) |
| **Memory** | Custom FirestoreMemoryService (facts, episodes, semantic search) |
| **Integrations** | Gmail, Google Calendar, Drive, Tasks, Contacts |
| **Hosting** | Google Cloud Run |
| **CI/CD** | Google Cloud Build |
| **Container** | Docker (multi-stage Node 20 + Python 3.11) |

---

## Reproducible Testing Instructions

Follow these steps to run and test Astra OS on your machine. Estimated setup time: **5–10 minutes**.

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Python | 3.11+ | [python.org](https://www.python.org/downloads/) |
| Node.js | 20+ | [nodejs.org](https://nodejs.org/) |
| Google API Key | Gemini Live access | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| Google Cloud Project | Firestore enabled | [console.cloud.google.com](https://console.cloud.google.com) |
| Chrome Browser | Latest | Required for Web Audio API + microphone access |

### Step 1: Clone and Configure

```bash
git clone https://github.com/khwahish1509/update_name
cd update_name/astracoach

# Copy environment template
cp .env.example .env
```

Open `.env` and fill in:
```
GOOGLE_API_KEY=your_google_api_key_here
FIRESTORE_PROJECT_ID=your-gcp-project-id
```

### Step 2: Start the Backend

```bash
cd backend
pip install -r requirements.txt
python main.py
```

You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.
```

Verify the backend is running:
```bash
curl http://localhost:8000/health
# Expected: {"status": "ok", ...}
```

### Step 3: Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

You should see:
```
VITE v5.4.x  ready in 500ms
➜  Local:   http://localhost:5173/
```

### Step 4: Test the Application

Open **http://localhost:5173** in Chrome.

#### Test 1: Dashboard Preview (no microphone needed)
1. On the setup screen, click **"Preview Dashboard"** (demo mode)
2. Verify the dashboard loads with populated data:
   - 5 KPI cards with animated numbers (Total Sessions, Brain Events, Relationships, Active Alerts, Insights)
   - Pending Alerts section with color-coded severity badges (CRITICAL, HIGH, MEDIUM)
   - Relationship Health cards with percentage bars
3. Click through each sidebar tab — **Email**, **CRM**, **Tasks**, **Calendar**, **Brain** — and verify each shows data

#### Test 2: Voice Interaction (requires microphone)
1. Return to setup screen, enter your name, choose a voice
2. Click **"Start Session"** → allow microphone access
3. Say: **"Brief me on my day"**
   - Watch tool pills animate in the transcript area (get_brain_summary, get_overdue_commitments, get_pending_alerts)
   - Astra should respond with a spoken briefing covering your schedule, overdue items, and alerts
4. Say: **"Create a task for the team to review the pitch deck, high priority, due Friday"**
   - Watch the "create_task" tool pill appear
   - Switch to **Tasks** tab — the new task should appear in the Kanban board
5. Say: **"What emails need my attention?"**
   - Watch the "get_recent_emails" tool pill
   - Astra should summarize your inbox with urgency classification

#### Test 3: Barge-in / Interruption
1. During a voice session, ask Astra a question that triggers a long response (e.g., "Tell me about all my relationships")
2. While Astra is speaking, **interrupt mid-sentence** with a new question
3. Astra should stop speaking immediately and process your new input — this demonstrates native VAD barge-in

#### Test 4: Screen Sharing + Vision
1. During a voice session, click the **"Share"** button in the top bar
2. Share a browser tab (e.g., a spreadsheet, document, or any visual content)
3. Say: **"What do you see on my screen?"**
4. Astra should describe and analyze the shared content using Gemini's multimodal vision

#### Test 5: Company Brain Memory
1. Have a conversation with Astra where you mention a decision (e.g., "We decided to switch to usage-based pricing")
2. End the session (click "End")
3. Start a new session
4. Ask: **"What did we decide about pricing?"**
5. Astra should recall the decision from the previous session using semantic vector search

#### Test 6: API Endpoints (verify backend directly)
```bash
# Health check
curl http://localhost:8000/health

# Brain summary (KPIs, session count, insights)
curl http://localhost:8000/brain/summary

# List brain insights
curl http://localhost:8000/brain/insights

# List all tasks
curl http://localhost:8000/brain/tasks/all

# List relationships
curl http://localhost:8000/brain/relationships

# List pending alerts
curl http://localhost:8000/brain/alerts

# Memory status (facts, episodes, events)
curl http://localhost:8000/brain/memory/status

# Semantic memory search
curl "http://localhost:8000/brain/memory/search?q=pricing+decision"

# Available voices
curl http://localhost:8000/api/voices

# Interactive API docs (Swagger UI)
open http://localhost:8000/docs
```

### Testing on Cloud Run (deployed version)

Visit the live deployment: **https://astracoach-rypr3jtzka-uc.a.run.app**

All tests above work identically on the deployed version. The Cloud Run instance has full access to Firestore, Secret Manager, and all Google Workspace integrations.

---

## Deploy to Google Cloud Run

### One-time setup
```bash
# Enable APIs
gcloud services enable \
  cloudbuild.googleapis.com run.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com

# Create Artifact Registry repo
gcloud artifacts repositories create astracoach \
  --repository-format=docker --location=us-central1

# Store API key as secret
echo -n "your-google-api-key" | gcloud secrets create GOOGLE_API_KEY --data-file=-

# Grant Cloud Run access to the secret
PROJECT_NUMBER=$(gcloud projects describe $GOOGLE_CLOUD_PROJECT --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding GOOGLE_API_KEY \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Deploy
```bash
chmod +x deploy.sh
./deploy.sh
# Or directly:
gcloud builds submit --config cloudbuild.yaml .
```

---

## Project Structure

```
astracoach/
├── backend/
│   ├── main.py                         # FastAPI app: 41 REST endpoints + WebSocket
│   ├── gemini_session.py               # GeminiLiveBridge: real-time voice session manager
│   ├── session_store.py                # In-memory session state management
│   ├── agent_tools.py                  # ADK agent configuration + tool registry
│   ├── agents/
│   │   ├── brain_tools.py              # 60 ADK FunctionTools (voice-callable)
│   │   └── background.py              # EmailScanner + RiskMonitor background agents
│   ├── brain/
│   │   ├── models.py                   # Pydantic models (insights, tasks, alerts, teams)
│   │   ├── store.py                    # Firestore CRUD + vector search queries
│   │   └── embeddings.py              # text-embedding-004 pipeline (768-dim)
│   ├── integrations/
│   │   ├── gmail_client.py             # Gmail API (read, send, reply, search)
│   │   ├── calendar_client.py          # Google Calendar (events, scheduling)
│   │   ├── drive_client.py             # Google Drive (search, list, create docs)
│   │   ├── tasks_client.py             # Google Tasks (CRUD, complete)
│   │   └── contacts_client.py          # Google Contacts (search, lookup)
│   ├── memory/
│   │   └── firestore_memory_service.py # Long-term memory (facts, episodes, events)
│   └── requirements.txt
├── frontend/
│   ├── public/
│   │   ├── capture-processor.js        # AudioWorklet: mic → 16kHz PCM16
│   │   └── playback-processor.js       # AudioWorklet: 24kHz PCM16 → speaker
│   └── src/
│       ├── App.jsx                     # Root with ThemeProvider
│       ├── main.jsx                    # React entry point
│       ├── index.css                   # Global styles + animations
│       ├── ThemeContext.jsx            # Dark/light theme system (40+ tokens)
│       ├── SetupScreen.jsx            # Session config + demo mode
│       ├── InterviewRoom.jsx          # Voice session UI + Simli avatar
│       ├── hooks/
│       │   ├── useAudioPipeline.js    # Web Audio capture/playback pipeline
│       │   ├── useInterviewSession.js # WebSocket session management
│       │   ├── useScreenShareCropper.js # Screen share + JPEG frame capture
│       │   └── useSimliAvatar.js      # Simli talking avatar (optional)
│       └── components/
│           ├── DashboardView.jsx      # Dashboard, Brain, Tasks, CRM, Email, Calendar
│           ├── BrainDashboard.jsx     # Company Brain: facts, episodes, events
│           └── GeminiAvatar.jsx       # Animated SVG AI avatar with FFT lip-sync
├── Dockerfile                          # Multi-stage build (Node 20 + Python 3.11)
├── cloudbuild.yaml                     # Cloud Build CI/CD pipeline
├── deploy.sh                           # One-command deployment script
├── .env.example                        # Environment variable template
├── .gitignore                          # Git exclusions (secrets, deps, artifacts)
├── .gcloudignore                       # Cloud Build exclusions
├── .dockerignore                       # Docker build exclusions
├── architecture_diagram.svg            # System architecture diagram
└── agent_flow.svg                      # Multi-agent pipeline diagram
```

---

## The "Beyond Text" Factor

Astra OS isn't a chatbot with a voice wrapper. Here's what makes it genuinely multimodal:

1. **See + Hear + Speak + Remember + Act** — Five modalities working simultaneously in a single Gemini session. Share your screen while talking while Astra recalls last week's decisions and creates a task — all at once.

2. **Tool transparency** — When Astra calls tools (calendar check, email scan, task creation), animated pills appear in the transcript — users SEE the agent working in real-time.

3. **Proactive intelligence** — Two background agents (EmailScanner + RiskMonitor) run independently every 15 and 30 minutes. They surface alerts before you ask.

4. **Natural barge-in** — Interrupt Astra mid-sentence. Gemini Live's native Voice Activity Detection handles it gracefully — no wake word, no waiting.

5. **Persistent Company Brain** — Every conversation enriches the brain via Firestore vector search (text-embedding-004, 768 dimensions, cosine similarity). Astra gets smarter with every session.

6. **Zero middleware voice** — No STT → LLM → TTS chain. Raw PCM audio flows directly between the browser and Gemini. This eliminates 500ms+ of latency that every other voice AI has.

---

## What Makes This Stand Out

**Before Gemini 2.5 Flash Native Audio**, building this required 5+ services: Deepgram (ASR) + OpenAI (LLM) + ElevenLabs (TTS) + Pipecat (orchestration) + a database + a separate memory system.

**Astra OS does ALL of that with ONE model, ONE API key, ONE WebSocket connection** — plus a Company Brain that no competitor has. This is the paradigm shift the hackathon is celebrating.

---

*Built for the Gemini Live Agent Challenge · Gemini 2.5 Flash + Google ADK + Cloud Run + Firestore*
