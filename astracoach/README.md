# Astra OS — The Founder's Operating System

> **Voice-first AI Chief of Staff powered 100% by Google.**
> *Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com) — "The Live Agent" Category*

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
| **51+ voice tools** | Calendar, email, Drive, Tasks, Contacts, brain queries — all by voice |

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
│  │  VoiceAgent (primary)        — 51 brain tools, live session  │   │
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
| ✅ Leverage a Gemini model | Gemini 2.5 Flash Native Audio (Live API) — the core of everything |
| ✅ Google GenAI SDK or ADK | Both: `google-genai` for Live API + `google-adk` for 51+ FunctionTools |
| ✅ Google Cloud service | Cloud Run (hosting) + Cloud Build (CI/CD) + Firestore (vector search + memory) + Secret Manager |
| ✅ Live Agents | Real-time bidirectional PCM16 audio + camera vision + barge-in + 3 concurrent agents |

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
| **Agent Framework** | Google ADK — 51+ FunctionTools + 3 agents |
| **Backend** | Python FastAPI + google-genai SDK |
| **Frontend** | React + Vite (custom SVG avatar, dark/light theme) |
| **Audio** | Web AudioWorklet API (capture 16kHz, playback 24kHz) |
| **Database** | Google Cloud Firestore (vector search + persistence) |
| **Memory** | Custom FirestoreMemoryService (facts, episodes, semantic search) |
| **Integrations** | Gmail, Google Calendar, Drive, Tasks, Contacts |
| **Hosting** | Google Cloud Run |
| **CI/CD** | Google Cloud Build |
| **Container** | Docker (multi-stage) |

---

## Quick Start (Local)

### Prerequisites
- Python 3.11+
- Node.js 20+
- [Google API Key](https://aistudio.google.com/app/apikey) with Gemini Live access
- Google Cloud project with Firestore enabled

### 1. Clone & configure
```bash
git clone https://github.com/your-username/astracoach
cd astracoach
cp .env.example .env
# Edit .env — add GOOGLE_API_KEY and FIRESTORE_PROJECT_ID
```

### 2. Backend
```bash
cd backend
pip install -r requirements.txt
python main.py
# API: http://localhost:8000
# Docs: http://localhost:8000/docs
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
# App: http://localhost:5173
```

### 4. Use it
1. Open `http://localhost:5173`
2. Configure your AI Chief of Staff persona
3. Click **Start Session** → allow mic access
4. Talk naturally — "Brief me on my day", "What emails need attention?", "Create a task for Arjun"
5. Explore the dashboard — Brain, Tasks, CRM, Email Routing, Calendar

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

# Grant Cloud Run access
PROJECT_NUMBER=$(gcloud projects describe $GOOGLE_CLOUD_PROJECT --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding GOOGLE_API_KEY \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Deploy
```bash
gcloud builds submit --config cloudbuild.yaml .
```

---

## Project Structure

```
astracoach/
├── backend/
│   ├── main.py                    # FastAPI: 40+ REST endpoints + WebSocket
│   ├── gemini_session.py          # Gemini Live API bridge (the core)
│   ├── session_store.py           # Session state management
│   ├── agents/
│   │   ├── brain_tools.py         # 51+ ADK FunctionTools for voice
│   │   └── background.py          # EmailScanner + RiskMonitor agents
│   ├── brain/
│   │   ├── models.py              # Data models (insights, tasks, alerts, teams)
│   │   ├── store.py               # Firestore CRUD + vector search
│   │   └── embeddings.py          # text-embedding-004 pipeline
│   ├── integrations/
│   │   ├── gmail_client.py        # Gmail API client
│   │   ├── calendar_client.py     # Google Calendar client
│   │   ├── drive_client.py        # Google Drive client
│   │   ├── tasks_client.py        # Google Tasks client
│   │   └── contacts_client.py     # Google Contacts client
│   ├── memory/
│   │   └── firestore_memory_service.py  # Long-term memory (facts, episodes)
│   └── requirements.txt
├── frontend/
│   ├── public/
│   │   ├── capture-processor.js   # AudioWorklet: mic → PCM16
│   │   └── playback-processor.js  # AudioWorklet: PCM16 → speaker
│   └── src/
│       ├── App.jsx                # Root with ThemeProvider
│       ├── ThemeContext.jsx        # Dark/light theme system
│       ├── SetupScreen.jsx        # Session configuration UI
│       ├── InterviewRoom.jsx      # Voice session experience
│       └── components/
│           ├── DashboardView.jsx  # Dashboard, Brain, Tasks, CRM, Email, Calendar
│           └── GeminiAvatar.jsx   # Animated SVG AI face with FFT lip-sync
├── Dockerfile                     # Multi-stage build (Node + Python)
├── cloudbuild.yaml                # Cloud Build CI/CD pipeline
└── .env.example
```

---

## The "Beyond Text" Factor

Astra OS isn't a chatbot with a voice wrapper. Here's what makes it genuinely multimodal:

1. **Voice + Vision + Memory simultaneously** — Talk to Astra while it watches your screen, remembers context from last week, and surfaces relevant calendar events
2. **Tool transparency** — When Astra calls tools (calendar check, email scan, task creation), animated pills appear in the transcript — users SEE the agent working
3. **Proactive intelligence** — Background agents independently scan emails and monitor risks, surfacing alerts before you ask
4. **Natural barge-in** — Interrupt Astra mid-sentence. Gemini Live's native VAD handles it gracefully
5. **Persistent brain** — Every conversation enriches the Company Brain. Astra gets smarter with every session

---

## Demo Script (for Judges)

1. **Open Astra** — Dark-themed setup screen, configure Chief of Staff persona
2. **Start session** — Avatar appears with animated rings, Astra greets you with today's context
3. **"Brief me on my day"** — Watch tool pills animate as Astra checks calendar, emails, and tasks
4. **Interrupt mid-sentence** — Demonstrate natural barge-in (highest-scored criterion)
5. **"Remember what we discussed about the Series A?"** — Astra recalls from long-term memory
6. **"Create a task for Arjun to fix the onboarding bug, high priority"** — Voice task creation
7. **Switch to Dashboard** — Show real-time data: KPIs, alerts, relationships, tasks
8. **Brain tab** — Facts learned, session episodes, event timeline
9. **Task Board** — Kanban view with the task just created by voice
10. **Email Routing** — AI-classified emails routed to teams

---

## What Makes This Stand Out

**Before Gemini 2.5 Flash Native Audio**, building this required 5+ services: Deepgram (ASR) + OpenAI (LLM) + ElevenLabs (TTS) + Pipecat (orchestration) + a database + a separate memory system.

**Astra OS does ALL of that with ONE model, ONE API key, ONE WebSocket connection** — plus a Company Brain that no competitor has. This is the paradigm shift the hackathon is celebrating.

---

*Built for the Gemini Live Agent Challenge · Gemini 2.5 Flash + Google ADK + Cloud Run + Firestore*
