# Astra OS — One-Pager

## Voice-First AI Chief of Staff for Startup Founders

---

**Founder:** Khwahish (Solo)
**Live Demo:** astracoach-rypr3jtzka-uc.a.run.app
**GitHub:** github.com/khwahish1509/update_name
**Stack:** 100% Google Gemini — zero third-party AI

---

## The Problem

Solo founders and small startup teams juggle 12+ tools daily — Gmail, Calendar, Slack, Notion, CRM, Drive — losing 3.5 hours per day to context-switching. Critical follow-ups get missed because no single system connects conversations to calendars to tasks. Founders spend more time managing tools than building their product.

## The Solution

Astra OS replaces 12 open tabs with one voice conversation. It's an AI operating system for founders that can see your screen, hear you naturally, speak back in real-time, remember every decision, and act across all your tools — all in a single Gemini session.

**Five modalities, simultaneously:** See (screen analysis via Gemini vision) • Hear (real-time native audio, natural barge-in) • Speak (sub-200ms voice latency, no STT/TTS chain) • Remember (persistent Company Brain with vector search) • Act (60 voice-callable tools across Google Workspace)

## How It's Different

Most voice assistants are wrappers around chat. Astra OS is fundamentally different:

**vs. ChatGPT:** Can't access your email, calendar, or files. No persistent memory across sessions. No background monitoring.

**vs. Siri/Alexa:** Basic integrations. No long-term memory. Can't see your screen. Can't act proactively.

**vs. Everyone:** Before Gemini 2.5 Flash Native Audio, building this required 5+ services (Deepgram + OpenAI + ElevenLabs + Pipecat + database). Astra OS does everything with one model, one API key, one WebSocket connection — plus a Company Brain that no competitor has.

## What's Built (This Is Live, Not a Prototype)

- 60 voice-callable tools (Gmail, Calendar, Drive, Tasks, Contacts, Company Brain)
- 3 concurrent AI agents: VoiceAgent (real-time), EmailScanner (every 15 min), RiskMonitor (every 30 min)
- Persistent Company Brain: Firestore + text-embedding-004 vector search (768 dimensions, cosine similarity)
- Full-stack deployment: React 18 frontend + Python FastAPI backend on Google Cloud Run
- Production CI/CD: Cloud Build + Secret Manager + Docker multi-stage builds
- Natural barge-in, screen sharing + vision analysis, dark/light theme, FFT-driven avatar lip-sync

## Technical Architecture

| Layer | Technology |
|---|---|
| Voice | Gemini 2.5 Flash Native Audio (Live API, raw PCM streaming) |
| Agents | Google ADK — 60 FunctionTools, 3 concurrent agents |
| Memory | Custom FirestoreMemoryService (facts, episodes, semantic search) |
| Backend | Python FastAPI + google-genai SDK |
| Frontend | React 18 + Vite (custom animated SVG avatar) |
| Infra | Google Cloud Run + Cloud Build + Firestore + Secret Manager |

## The Ask

**Mentorship:** Connections to founders and operators who've scaled AI products.
**Feedback:** Honest product and business model feedback.
**Connections:** Introductions to potential early adopters — solo founders and small teams.
**Funding:** Prize money funds cloud infrastructure to scale from demo to paying users.

---

*Built solo. Deployed live. Powered entirely by Google Gemini.*
