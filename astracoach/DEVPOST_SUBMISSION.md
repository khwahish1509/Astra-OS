# Devpost Submission — Astra OS

---

## Elevator Pitch

**AI broke out of the chatbox. We gave it a job.** Astra OS is a voice-first AI Chief of Staff that sees your screen, reads your email, tracks your commitments, and runs your startup — powered entirely by Gemini.

---

## About the Project

### Inspiration

The idea started with frustration.

Every morning as a founder, I wake up to the same chaos: 47 unread emails, 6 calendar invites, a Slack thread about a production bug, investor follow-ups I forgot about, and a team standup in 20 minutes that I haven't prepped for. I open Gmail, then Calendar, then Notion, then Slack — four apps, four contexts, four places where something important might be slipping through the cracks.

I don't need another dashboard. I don't need another notification. I need someone who already knows everything and can just *tell me* what matters.

When Google released Gemini 2.5 Flash with Native Audio — real-time bidirectional voice streaming with tool calling during live conversation — I realized something had fundamentally changed. This wasn't a chatbot with voice bolted on. This was an AI that could genuinely *hear* me, *see* my screen, *remember* our past conversations, and *act* on my behalf. All through a single model. No STT/TTS middleware. No chained API calls. Just a direct neural connection between my voice and an AI that has access to everything a chief of staff would need.

So I built one.

### What it does

Astra OS is an AI Chief of Staff for startup founders. You talk to it like you'd talk to a trusted executive — naturally, in full sentences, interrupting when you want, asking follow-ups, giving orders. It handles the rest.

**Voice-native operations.** Say "Brief me" and Astra checks your calendar, scans your inbox for urgent items, reviews overdue commitments, identifies at-risk relationships, and delivers a 30-second executive briefing. It pulls from 51 different tools — Gmail, Calendar, Drive, Tasks, Contacts, and its own Company Brain — all during a single live voice stream.

**Email intelligence.** Astra reads your inbox, classifies emails by category and urgency, routes them to the right team members, and can reply on your behalf. When an investor emails about your Series A timeline, Astra doesn't just summarize it — it drafts a reply in your voice, sends it, and creates a follow-up task, all from one voice command.

**Relationship CRM.** Every person you interact with gets a health score. Astra tracks tone trends across emails, monitors response times, counts open commitments, and alerts you when a relationship is declining. When your lead investor hasn't heard from you in a week, Astra flags it before it becomes a problem.

**Task management.** A full Kanban board populated entirely by voice. "Create a task for Arjun to fix the onboarding bug, high priority, due Friday." Done. Tasks have priorities, assignees, due dates, comments, and status tracking — all manageable by voice or through the dashboard.

**Company Brain.** This is the piece that makes Astra different from every other voice assistant. Every conversation is automatically distilled into structured knowledge — commitments, decisions, risks, action items, opportunities. These are embedded using `text-embedding-004` and stored in Firestore with vector search. When you ask "What did we decide about pricing last week?", Astra searches semantically across every past conversation and surfaces the exact decision, who was involved, and what follow-up was planned.

**Screen awareness.** Share your screen and Astra can analyze what you're looking at. Show it a revenue spreadsheet and it'll give you talking points for your investor meeting — because it knows who you're meeting and what they care about.

**Proactive intelligence.** Two background agents — an Email Scanner and a Risk Monitor — run independently. The Email Scanner processes incoming emails every 15 minutes, extracting commitments and risk signals. The Risk Monitor checks for overdue items, declining relationships, and blocked tasks every 30 minutes. When something needs attention, Astra surfaces it proactively during your next conversation, without being asked.

**Natural interaction.** Interrupt Astra mid-sentence. It handles barge-in gracefully through Gemini's native Voice Activity Detection. Ask rapid-fire questions. Change topics. Circle back. The conversation flows the way real conversations do.

### How we built it

The foundation is Gemini 2.5 Flash with Native Audio, accessed through the Live API. Audio streams bidirectionally — 16kHz PCM from the browser microphone, 24kHz PCM back from Gemini — over a single WebSocket connection. There's no transcription step. No TTS synthesis. The model hears raw audio and speaks raw audio, which is what makes the latency feel genuinely conversational.

On top of that, we built a tool layer using Google ADK (Agent Development Kit). 51 FunctionTools are registered with the voice agent, each one handling a specific capability — from `get_recent_emails` to `create_calendar_event` to `recall_memory`. During a live voice session, Gemini can invoke any of these tools mid-conversation, process the results, and continue speaking — all without breaking the audio stream.

The Company Brain is built on Firestore. Every insight (commitment, risk, decision, action item, opportunity) is embedded using Google's `text-embedding-004` model and stored with its vector representation. When the brain needs to recall something, it runs a cosine-similarity vector search across all stored insights — no keyword matching, pure semantic retrieval. This is what lets Astra answer questions like "What risks did we identify about the ByteByteGo deal?" even if the word "risk" was never explicitly used in the original conversation.

The backend is FastAPI running on Cloud Run. It manages WebSocket connections, proxies audio between the browser and Gemini, dispatches tool calls, runs background agents, and serves the REST API for the dashboard. Session state, relationship data, tasks, alerts, and routing rules all persist in Firestore.

The frontend is React with a custom audio pipeline built on the Web Audio API. AudioWorklet processors handle mic capture and speaker playback at the correct sample rates. The AI avatar uses Canvas-based rendering with FFT-driven lip sync — it analyzes the audio frequency spectrum at 60fps to animate the mouth, glow rings, and state indicators in real-time.

The multi-agent architecture runs three concurrent agents:

1. **VoiceAgent** — the primary agent, running on Gemini 2.5 Flash Native Audio through ADK's `run_live()`. Handles all voice interactions with 51 tools.
2. **EmailScannerAgent** — background agent running on Gemini 2.0 Flash. Scans Gmail every 15 minutes, extracts structured insights from each email, embeds them, updates relationship health scores.
3. **RiskMonitorAgent** — background agent checking for overdue commitments, at-risk relationships (health < 0.4), and tasks blocked for more than 24 hours.

Everything deploys through Cloud Build with a single command. The Dockerfile runs a multi-stage build — Node 20 for the React frontend, Python 3.11-slim for the backend — producing a single container that serves both the API and the static frontend from Cloud Run.

### Challenges we ran into

**The WebSocket-to-Live-API bridge.** Gemini's Live API uses its own WebSocket protocol for audio streaming. Browsers have their own WebSocket connection to our backend. Bridging these two — with proper binary audio routing, JSON control messages, and error recovery — was the hardest technical challenge. If a single frame gets misrouted, the audio glitches or the session drops. We went through four major iterations of the bridge architecture before landing on the current design.

**Tool calling during live audio.** When Gemini invokes a tool mid-conversation, the audio stream needs to pause naturally (not cut out abruptly), the tool needs to execute, and the audio needs to resume seamlessly. Getting the timing right — so Astra says "Let me check that" and then pauses naturally while the tool runs — required careful coordination between the ADK runner, our tool dispatch layer, and the frontend state machine.

**Firestore vector search at scale.** Composite indexes with vector fields have specific constraints — you can't combine certain filter types with vector similarity search. We had to restructure our queries to work within these constraints while still supporting filtered semantic search (e.g., "find all active commitments related to Series A").

**Audio sample rate mismatch.** The browser captures at 16kHz. Gemini outputs at 24kHz. The AudioWorklet processors need to handle both rates without introducing artifacts. We ended up writing custom ring-buffer implementations in the AudioWorklet scope to ensure smooth playback without clicks or gaps.

**Background agent coordination.** The Email Scanner and Risk Monitor run on separate asyncio tasks. When they generate alerts that need to be surfaced during a live voice session, we had to build an injection mechanism — a queue that the VoiceAgent polls every 60 seconds, surfacing high-priority alerts as natural conversational interjections without disrupting the flow.

### Accomplishments that we're proud of

**51 voice tools running during live streaming.** Not after the session. Not in a separate text interface. During real-time bidirectional audio. We haven't seen another project that does this at this scale.

**Zero third-party AI.** One Google API key powers everything — voice understanding, voice synthesis, email analysis, insight extraction, avatar generation (Imagen), vector embeddings, and semantic search. No OpenAI. No ElevenLabs for synthesis. No Deepgram for recognition. One platform.

**The Company Brain actually works.** Ask Astra about a decision you made three sessions ago and it recalls accurately — not because it memorized the transcript, but because it semantically searched embedded insights from Firestore. This is the feature that made us realize we'd built something genuinely useful, not just a demo.

**Email-to-insight-to-alert pipeline.** An email arrives → the EmailScanner extracts a commitment → the RiskMonitor detects it's overdue two days later → Astra surfaces it in your morning briefing. No manual input. The system learns and monitors autonomously.

**Natural barge-in.** Interrupting Astra mid-sentence works exactly like interrupting a human colleague. Gemini's native VAD handles it gracefully — no wake word, no button, just start talking.

### What we learned

Gemini 2.5 Flash with Native Audio is a paradigm shift. Before this, building a voice AI with real-time tool access required chaining five services (ASR → LLM → TTS → orchestration → database) with hundreds of milliseconds of latency at each step. Now it's one WebSocket. The implications for what a single developer can build are massive.

We also learned that the "memory" problem is the real differentiator. Every voice AI can answer a question. Very few can remember what you talked about last week, connect it to an email that arrived yesterday, and surface it proactively tomorrow. The vector-embedded Company Brain turned Astra from a voice assistant into something that genuinely feels like it knows your business.

And we learned that the demo is the product. If you can't show it working in real-time, it doesn't matter how good the code is. Every architectural decision we made optimized for one thing: making the live demo feel effortless and magical.

### What's next for Astra OS

**Multi-founder support.** Right now Astra serves one founder. The architecture supports multi-tenant — each founder gets their own brain, their own relationships, their own agents. We want to make Astra available to every early-stage team.

**Deeper Google Workspace integration.** Astra currently reads emails and calendar events. We want it to parse Google Docs for meeting notes, analyze Sheets for financial data, and sync with Google Chat for team communication — turning the full Workspace suite into Astra's sensorium.

**Custom agent creation.** Let founders define their own background agents: "Monitor Hacker News for mentions of our company." "Alert me when a competitor raises a round." "Track my burn rate weekly." The ADK framework makes this extensible.

**Mobile companion.** A lightweight mobile app that lets you talk to Astra on the go — during your commute, between meetings, while walking. The same voice, the same memory, the same tools.

**Open source the Company Brain.** The pattern of embedding structured insights from conversations into a vector-searchable knowledge base is powerful beyond startups. We want to open-source the brain architecture so others can build domain-specific memory systems on top of Gemini and Firestore.

---

## Built With

- **Gemini 2.5 Flash** — Native Audio Live API (bidirectional PCM streaming + 51 tool calls)
- **Gemini 2.0 Flash** — Email insight extraction + screen content analysis
- **Google ADK** (Agent Development Kit) — Multi-agent orchestration with FunctionTools
- **Google GenAI SDK** (`google-genai`) — Live API WebSocket management
- **Firestore** — Vector search (text-embedding-004, 768-dim, cosine) + all persistent data
- **Cloud Run** — Auto-scaling container hosting with WebSocket support
- **Cloud Build** — CI/CD pipeline (Docker build → Artifact Registry → deploy)
- **Secret Manager** — Secure credential storage
- **Artifact Registry** — Docker image storage
- **Imagen 4.0** — AI avatar generation
- **Gmail API** — Email read, send, reply, search
- **Google Calendar API** — Schedule management + Google Meet creation
- **Google Drive API** — File search and document access
- **Google Tasks API** — Personal task management
- **Google Contacts API** — Contact lookup and search
- **Python** / **FastAPI** — Backend API + WebSocket server
- **React** / **Vite** — Frontend SPA with dark/light theme
- **Web Audio API** — AudioWorklet for PCM capture (16kHz) and playback (24kHz)
- **Docker** — Multi-stage build (Node 20 + Python 3.11)

---

## "Try it out" Links

- **Live Demo:** https://astracoach-rypr3jtzka-uc.a.run.app
- **Source Code:** https://github.com/khwahish1509/astracoach
- **Architecture Diagram:** *(see attached image gallery)*
- **Demo Video:** *(see embedded video)*

---

## Project Media — Image Descriptions

### Image 1: Architecture Diagram (architecture_diagram.png)
Full system architecture showing: Browser (React + Audio Pipeline) → WebSocket → FastAPI Backend (Cloud Run) → Gemini 2.5 Flash Live API. Includes Company Brain (Firestore), Multi-Agent System (VoiceAgent + EmailScanner + RiskMonitor), and Google Workspace integrations.

### Image 2: Multi-Agent Flow Diagram (agent_flow.png)
Flow diagram showing: Email arrives → EmailScannerAgent extracts insights → Firestore vector store → RiskMonitorAgent detects issues → Alert created → VoiceAgent surfaces during live session. Shows the autonomous intelligence pipeline.

### Image 3: Dashboard Screenshot (dashboard.png)
The Astra OS dashboard with KPI cards (animated counters + trend arrows), pending alerts with severity badges, relationship health cards, and quick voice commands.

### Image 4: Voice Session Screenshot (voice_session.png)
Live voice session showing the AI avatar with FFT lip-sync, tool execution pills in the header, live transcript, and PIP camera feed.

### Image 5: Company Brain Screenshot (brain.png)
The Brain tab showing learned facts, session episodes with summaries, and the events timeline — demonstrating persistent cross-session memory.
