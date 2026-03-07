# AstraCoach 🌟 — AI Interview Coach

> **Real-time AI interview coaching powered 100% by Google.**
> *Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com)*

---

## Why This Wins

Most hackathon submissions wrap an existing chatbot in a UI. AstraCoach is fundamentally different: it puts **Gemini 2.5 Flash's native audio pipeline at the core**, creating an experience that was impossible to build 12 months ago.

| What It Does | How It Works |
|---|---|
| **Hears you naturally** | Gemini Live API receives your PCM16 microphone stream in real-time |
| **Speaks back as a human** | Gemini's native audio synthesis — no TTS middleware, no latency |
| **Sees your camera** | JPEG frames streamed to Gemini vision during the conversation |
| **Can be interrupted** | Gemini Live's VAD (Voice Activity Detection) handles barge-in natively |
| **Uses intelligent tools** | ADK FunctionTools: Google Search, answer evaluation, coaching |
| **Animates to its voice** | Custom SVG avatar with audio-amplitude-driven lip sync |

**Zero third-party AI services.** One Google API key. That's it.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (React + Vite)                                           │
│                                                                   │
│  ┌──────────────────────┐   ┌─────────────────────────────────┐  │
│  │  GeminiAvatar        │   │  Candidate Camera + Transcript  │  │
│  │  • SVG animated face │   │  • getUserMedia video           │  │
│  │  • Lip sync from     │   │  • JPEG frames → WS → Gemini   │  │
│  │    PlaybackWorklet   │   │  • Live transcript panel        │  │
│  │    amplitude         │   │                                 │  │
│  └──────────────────────┘   └─────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Audio Pipeline                                           │    │
│  │  Mic → AudioContext(16kHz) → CaptureWorklet → PCM16     │    │
│  │  PCM16 → WebSocket (binary frames) → Backend             │    │
│  │  Backend → WebSocket (binary frames) → PCM16             │    │
│  │  PCM16 → AudioContext(24kHz) → PlaybackWorklet → Speaker │    │
│  │  PlaybackWorklet → amplitude → avatar lip sync           │    │
│  └──────────────────────────────────────────────────────────┘    │
└────────────────────────────────────┬─────────────────────────────┘
                    WebSocket /ws/interview/{id}
              (binary PCM16 audio + JSON control msgs)
                                     │
┌────────────────────────────────────▼─────────────────────────────┐
│  FastAPI Backend (Google Cloud Run)                               │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  GeminiLiveBridge  (gemini_session.py)                     │  │
│  │  • Proxies browser audio ↔ Gemini Live API                │  │
│  │  • Handles ToolCall events → dispatches ADK tools          │  │
│  │  • Routes transcript events → browser                      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ADK FunctionTools  (interview_tools.py)                   │  │
│  │  • evaluate_candidate_answer  (score + feedback)           │  │
│  │  • get_next_question          (role + difficulty aware)    │  │
│  │  • give_body_language_coaching (vision-triggered)          │  │
│  │  • search_company_info        (Google grounding)           │  │
│  └────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────┬─────────────────────────────┘
                                     │
                    ┌────────────────▼──────────────────┐
                    │  Gemini 2.5 Flash Native Audio     │
                    │  Live API (google-genai SDK)       │
                    │  • PCM16 16kHz in / 24kHz out     │
                    │  • 8 built-in voices (Aoede, …)   │
                    │  • Tool calling during live stream │
                    │  • Vision: JPEG inline images      │
                    │  • VAD + interruption support      │
                    └────────────────────────────────────┘
```

---

## Hackathon Requirements ✅

| Requirement | How We Satisfy It |
|---|---|
| ✅ Leverage a Gemini model | Gemini 2.5 Flash Native Audio (Live API) |
| ✅ Google GenAI SDK **or** ADK | Both: `google-genai` for Live API + `google-adk` FunctionTools |
| ✅ At least one Google Cloud service | Cloud Run (hosting) + Cloud Build (CI/CD) |
| ✅ Live Agents — Real-time Audio/Vision | Native PCM16 audio streaming, camera vision, barge-in support |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **LLM + Voice** | Gemini 2.5 Flash Native Audio (Live API) |
| **Agent Framework** | Google ADK (FunctionTool, dispatching) |
| **Backend** | Python FastAPI + google-genai SDK |
| **Frontend** | React + Vite (zero avatar SDKs — custom SVG) |
| **Audio** | Web AudioWorklet API (capture 16kHz, playback 24kHz) |
| **Hosting** | Google Cloud Run |
| **CI/CD** | Google Cloud Build |
| **Container** | Docker (multi-stage) |

---

## Quick Start (Local)

### Prerequisites
- Python 3.11+
- Node.js 20+
- [Google API Key](https://aistudio.google.com/app/apikey) with Gemini Live access

### 1. Clone & configure
```bash
git clone https://github.com/your-username/astracoach
cd astracoach
cp .env.example .env
# Edit .env — add your GOOGLE_API_KEY
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
2. Choose role, company, difficulty, and Gemini voice
3. Click **Start Interview** → allow mic access when prompted
4. The AI interviewer greets you and begins the session
5. Speak naturally — interrupt freely, it handles barge-in
6. Your camera feed is analyzed in the background (posture, eye contact)

---

## Deploy to Google Cloud Run

### One-time setup
```bash
# Enable APIs
gcloud services enable \
  cloudbuild.googleapis.com run.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com

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
gcloud builds submit --config cloudbuild.yaml .
```

---

## Project Structure

```
astracoach/
├── backend/
│   ├── main.py              # FastAPI: REST + WebSocket endpoints
│   ├── gemini_session.py    # Gemini Live API bridge (the core)
│   ├── interview_tools.py   # ADK FunctionTools + dispatcher
│   ├── session_store.py     # In-memory session state
│   └── requirements.txt
├── frontend/
│   ├── public/
│   │   ├── capture-processor.js   # AudioWorklet: mic → PCM16
│   │   ├── playback-processor.js  # AudioWorklet: PCM16 → speaker + amplitude
│   │   └── index.html
│   └── src/
│       ├── App.jsx
│       ├── SetupScreen.jsx          # Interview config UI
│       ├── InterviewRoom.jsx        # Main interview experience
│       ├── components/
│       │   └── GeminiAvatar.jsx     # Animated SVG AI face
│       └── hooks/
│           ├── useAudioPipeline.js  # Audio capture + playback
│           └── useInterviewSession.js  # WS session + state
├── Dockerfile
├── cloudbuild.yaml
├── .env.example
└── README.md
```

---

## Demo Script (for Judges)

1. **Setup** — "Software Engineer" at "Google", difficulty "FAANG-level", voice "Charon"
2. **Start** — allow mic → Gemini Live session opens, Alex Chen's animated avatar appears
3. **Notice** the avatar state transitions: idle → listening (when you speak) → thinking → speaking
4. **Interrupt** the interviewer mid-sentence — Gemini's VAD handles it gracefully
5. **Answer poorly** — watch the avatar transition to "thinking" as it uses `evaluate_candidate_answer` tool
6. **Hold up your resume** to the camera — Gemini will comment on it naturally in conversation
7. **Live transcript** appears on the right as both sides speak
8. After the interview, notice the coaching feedback Alex delivers

---

## What Makes This Stand Out

**The pipeline is genuinely new.** Before Gemini 2.5 Flash Native Audio, building this required:
- A separate ASR service (Deepgram, Whisper)
- A separate LLM (OpenAI, Anthropic)
- A separate TTS service (ElevenLabs, Cartesia)
- Complex orchestration between them (Pipecat, LiveKit)
- A third-party avatar (Tavus, HeyGen)

**AstraCoach does ALL of that with ONE model, ONE API key, ONE WebSocket connection.**
The Gemini Live API is the ASR + LLM + TTS simultaneously. This is the paradigm shift
the hackathon is celebrating.

---

*Built for the Gemini Live Agent Challenge · Google ADK + Gemini 2.5 Flash + Cloud Run*
