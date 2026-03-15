# Astra OS — UI/UX Vision Document
## Gemini Live Agent Challenge: "The Live Agent" Category

**Deadline: March 16, 2026 | Grand Prize: $25,000 | Total Pool: $80,000**

---

## 1. Hackathon Scoring Breakdown (What Actually Wins)

The judging criteria tell us exactly where to invest effort:

| Criterion | Weight | What Judges Look For |
|-----------|--------|---------------------|
| **Innovation & Multimodal UX** | **40%** | "The Beyond Text Factor" — does it break the text box paradigm? Does the agent See, Hear, Speak seamlessly? Distinct persona/voice? Live and context-aware vs disjointed? |
| **Technical Implementation** | **30%** | Effective use of GenAI SDK/ADK, robust Google Cloud hosting, sound agent logic, graceful error handling, grounding (no hallucinations) |
| **Demo & Presentation** | **30%** | Clear problem/solution, architecture diagram, visual proof of Cloud deployment, actual software demo |

**Key Insight:** 40% of the score is purely about how the UI/UX feels. The "Beyond Text Factor" is literally the highest-weighted single criterion. A mediocre backend with a breathtaking UI will outscore brilliant backend logic with a basic chat interface.

**For "The Live Agent" specifically, judges ask:**
- Does it handle barge-in (interruptions) naturally?
- Does it have a distinct persona/voice?
- Is the experience live and context-aware?

---

## 2. What Current Astra OS Does Well (Don't Touch These)

Before redesigning, here's what's already strong:

1. **FFT-Driven Avatar Lip-Sync** — The 3-slice Canvas portrait technique with frequency-band mouth animation is industry-leading. ElevenLabs, Google, and OpenAI don't do this. This IS the "Beyond Text Factor."

2. **BrainDashboard** — Real-time insights, relationships, commitments. No competitor has an AI chief of staff that surfaces structured intelligence during a voice call. This is unique.

3. **Dark Glassmorphism Theme** — Already polished. `#07070f` base with `rgba(14,14,26,0.4)` glass layers, blue/purple accents. This matches the aesthetic trend across all top-tier voice AIs.

4. **Multi-Persona System** — Coaching, tutoring, sales, medical templates with editable prompts. Demonstrates ADK flexibility.

5. **Robust Audio Pipeline** — AudioWorklets at 16kHz/24kHz, Simli fallback, barge-in support. The technical foundation is solid.

---

## 3. Competitor Analysis: What Top Voice AIs Look Like

### ElevenLabs (The Gold Standard for Voice Orbs)
- **Signature:** 3D WebGL orb (Three.js + React Three Fiber) that deforms in real-time to audio frequency data
- **States:** Idle (soft glow), Listening (expanding waveforms), Thinking (slow rotation), Speaking (pulsing reactive waves)
- **Takeaway:** Audio reactivity creates a visceral connection. Users SEE their voice affecting the AI.

### ChatGPT Voice Mode (The Benchmark)
- **Signature:** Was a blue orb, now integrated into chat thread with real-time waveform + live text transcription
- **Key Innovation:** Text appears AS the AI speaks — users read and hear simultaneously
- **Takeaway:** Multimodal sync (voice + text + visuals in one view) is now the expectation.

### Google Gemini Live (The Direct Competitor)
- **Signature:** Blue/purple ambient lighting, 10 distinct voice personas, natural barge-in
- **Key Innovation:** Device-native lighting effects, immediate listening after response completion
- **Takeaway:** Ambient visual feedback + distinct persona voice = "alive" feeling.

### Hume AI (The Emotional Intelligence Leader)
- **Signature:** Minimalist UI — the voice itself carries the emotional state, not flashy animations
- **Takeaway:** Don't over-animate. Authenticity and emotional tone in the voice matter more than visual effects.

### Universal Design Trends (2025-2026)
- Blue/purple dominant palettes (trust, intelligence, calm)
- Dark interfaces for focus and rest
- Micro-animations (50-300ms) for state transitions
- Audio-synchronized visuals over independent animations
- Glass-morphism + transparency for modern aesthetic
- "Zero UI" movement — voice-first, visuals secondary

---

## 4. The Winning UI Vision for Astra OS

### Core Philosophy: "The Founder's Command Center"

Astra OS isn't just a voice assistant with a pretty orb. It's a **live operating system for founders** — the AI sees your context (calendar, email, company brain), hears you naturally, speaks with a distinct persona, and surfaces actionable intelligence in real-time. The UI must communicate this depth.

### Layout: Three-Zone Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  [Astra OS]        ● LIVE  00:04:23         [🎤] [📷] [■]  │
│─────────────────────────────────────────────────────────────│
│                        │                                     │
│                        │  ┌─ CONTEXT CARDS ───────────────┐  │
│    ┌──────────────┐    │  │ 📅 Next: Board meeting 2pm    │  │
│    │              │    │  │ 📧 3 unread (1 urgent)        │  │
│    │   AVATAR     │    │  │ 🧠 "Follow up with Sarah"     │  │
│    │   ZONE       │    │  └───────────────────────────────┘  │
│    │              │    │                                     │
│    │  (lip-sync   │    │  ┌─ LIVE TRANSCRIPT ─────────────┐  │
│    │   + rings    │    │  │ You: "What's on my plate?"    │  │
│    │   + state)   │    │  │ Astra: Looking at your day... │  │
│    │              │    │  │  [🔧 get_todays_schedule]     │  │
│    └──────────────┘    │  │ Astra: You have 3 meetings... │  │
│                        │  └───────────────────────────────┘  │
│    ┌──────────────┐    │                                     │
│    │  Your Camera  │    │  ┌─ BRAIN INSIGHTS ─────────────┐  │
│    └──────────────┘    │  │ ⚡ 2 action items pending     │  │
│                        │  │ 📊 Revenue milestone: 85%     │  │
│                        │  │ 🔗 Key relationship: Sarah K  │  │
│─────────────────────────────────────────────────────────────│
│  [Screen Share]  [Brain Dashboard]  [Voice: Aria]           │
└─────────────────────────────────────────────────────────────┘
```

**Zone 1 (Left — 60%):** The Avatar Presence
- Full-height avatar with FFT lip-sync (keep existing!)
- Animated energy rings that pulse with voice frequency
- State indicator overlay: Speaking (blue glow), Listening (green pulse), Thinking (purple orbit)
- Your camera feed as a small PiP below the avatar

**Zone 2 (Right — 40%):** The Intelligence Layer
- **Context Cards** (top): Live, auto-refreshing cards showing calendar, email, tasks, brain insights
- **Live Transcript** (middle): Scrolling conversation with tool-use pills showing what Astra is doing
- **Brain Insights** (bottom): Collapsible panel with actionable alerts, relationships, commitments

### What Makes This "Beyond Text"

1. **Context Cards Update in Real-Time** — When Astra says "you have a meeting at 2pm," the calendar card simultaneously highlights. Visual + audio sync.

2. **Tool-Use Transparency** — When Astra calls `get_todays_schedule`, a subtle animated pill appears in the transcript showing the tool name + spinner. The user SEES the agent working, not just waiting.

3. **Avatar State = Emotional State** — The avatar doesn't just lip-sync. The ring colors shift based on what Astra is doing: blue (speaking), green (listening), purple (thinking/tool-calling), amber (alerting about something important).

4. **Ambient Awareness Indicators** — When screen share is on, a subtle green pulse in the avatar border shows "I can see your screen." When camera is on, a small eye icon appears. The user always knows what Astra perceives.

5. **Proactive Intelligence Surfacing** — Brain insights aren't hidden in a dashboard. They float as subtle notification cards that appear when relevant to the conversation. "You mentioned Sarah — I noticed you haven't followed up since Tuesday."

---

## 5. Animation & Visual Language Spec

### State Machine (4 States)

| State | Avatar Rings | Glow Color | Dot Indicator | Sound |
|-------|-------------|------------|---------------|-------|
| **Idle** | Slow breathe (3s cycle) | Dim white | Solid white dot | — |
| **Listening** | Expand inward (audio-reactive) | Soft green | Pulsing green dot | — |
| **Thinking** | Orbital rotation (1.5s) | Purple shimmer | Spinning purple dot | Subtle "processing" tone |
| **Speaking** | Pulsing outward (FFT-driven) | Blue radiance | Pulsing blue dot | — |

### Ring Animation Details
- 3 concentric rings around avatar (keep existing)
- **Enhancement:** Add subtle particle effects on the rings during speaking state (CSS pseudo-elements, not full Three.js — keep it lightweight)
- **Enhancement:** Rings should have a subtle "breathing" baseline even when idle (opacity oscillation 0.3→0.6 over 3s)
- **Enhancement:** During tool calls, rings briefly flash purple (0.3s transition) to show agent activity

### Glassmorphism Standards
- Card background: `rgba(14, 14, 26, 0.4)`
- Backdrop blur: `12px`
- Border: `1px solid rgba(255, 255, 255, 0.06)`
- Border radius: `16px` (standardize — currently varies 8-20px)
- Shadow: `0 4px 24px rgba(0, 0, 0, 0.3)` (standardize)

### Micro-Interactions
- Button hover: Scale 1.02 + brightness 1.1 (50ms ease)
- Button press: Scale 0.98 (100ms ease)
- Card appear: Fade up 12px + opacity 0→1 (300ms ease-out)
- Card dismiss: Fade down 8px + opacity 1→0 (200ms ease-in)
- Tool pill: Slide in from right + expand (200ms spring)
- Context card update: Subtle flash (border glow 0.3s) when data changes

### Typography Scale (Standardize)
- Display: 24px / 700 weight (avatar name, greeting)
- Heading: 16px / 600 weight (section titles)
- Body: 14px / 400 weight (transcript, descriptions)
- Caption: 12px / 400 weight (timestamps, labels)
- Micro: 11px / 500 weight (badges, tool pills)

---

## 6. What Will Win the Hackathon (Priority Stack)

Given the deadline is TOMORROW, here's the prioritized impact-to-effort ranking:

### Tier 1: HIGH IMPACT, LOW EFFORT (Do These)

1. **Standardize the glassmorphism** — Create a shared `S.glass` style object used everywhere. Unify border-radius to 16px, shadows, backdrop-blur. Takes 30 min, makes everything feel 2x more polished.

2. **Add ring breathing animation at idle** — Simple CSS keyframe on the existing rings. 10 min. Makes the avatar feel "alive" even when not speaking.

3. **Make tool-use pills animate in** — The tool pills already exist in the transcript. Add a slide-in + spinner animation. 15 min. Judges will love seeing the agent's "thinking" visible.

4. **Add state-colored glow to avatar border** — Already partially exists for speaking. Extend to all 4 states with color transitions. 20 min.

5. **Context cards in right panel** — Replace or augment the "tips" section with live context cards (next meeting, unread count, brain alert count). Data already available from preloaded greeting. 45 min.

### Tier 2: MEDIUM IMPACT, MEDIUM EFFORT (If Time Permits)

6. **Live transcript timestamps** — Add elapsed-time stamps (e.g., "0:23") to each transcript entry. 20 min. Adds professionalism.

7. **Smooth transcript scrolling** — Add `scroll-behavior: smooth` + a "new message" indicator at bottom. 15 min.

8. **Brain insights as floating notifications** — When an insight is generated, briefly show it as a toast/card overlay near the avatar before it moves to the panel. 45 min.

9. **Better "Begin Session" animation** — Add a countdown or breathing animation to the start overlay. Currently static. 30 min.

10. **Ambient awareness badges** — Small icons showing what Astra can perceive (🎤 mic, 📷 camera, 🖥️ screen). Already partially exists. Polish with pulse animations. 20 min.

### Tier 3: HIGH IMPACT, HIGH EFFORT (Post-Hackathon)

11. **Three.js orb replacement** — Replace SVG orb fallback with a proper 3D audio-reactive sphere (ElevenLabs-style). 3-4 hours. The portrait lip-sync is better for the demo though.

12. **Responsive design** — Add mobile/tablet layouts. 2-3 hours. Not needed for hackathon demo video.

13. **Full accessibility pass** — ARIA labels, focus rings, color contrast. 2 hours. Important for production, not for hackathon scoring.

---

## 7. The 3-Minute Demo Video Strategy

Since Demo & Presentation is 30% of the score:

### Script Structure
1. **0:00-0:20 — The Hook**: "Every founder has the same problem: 50 unread emails, 6 meetings, and no idea what to prioritize. Meet Astra — your AI Chief of Staff."
2. **0:20-0:50 — The Problem**: Quick montage of founder chaos (calendar overload, Slack pings, missed follow-ups)
3. **0:50-1:30 — The Live Demo**: Actually talk to Astra. Show: voice conversation, real-time calendar check, email triage, brain insights surfacing, tool-use pills appearing, context cards updating
4. **1:30-2:00 — The Architecture**: Show diagram — ADK multi-agent, Firestore memory, 45 voice tools, Google Cloud Run
5. **2:00-2:30 — The "Beyond Text" Moment**: Demonstrate barge-in (interrupt Astra mid-sentence), show Astra remembering context from a previous session (memory system), show screen share analysis
6. **2:30-3:00 — The Vision**: "Astra doesn't just answer questions. It runs your company with you."

### Key Demo Moments to Nail
- **Tool transparency**: The audience must SEE tool-use pills animating in the transcript
- **Barge-in**: Interrupt Astra naturally. This is specifically called out in judging criteria
- **Memory recall**: "Remember what we discussed about the Series A?" — Astra recalls from long-term memory
- **Multi-modal**: Show screen share + voice + brain insights all active simultaneously
- **Persona/Voice**: Astra should sound distinctive — warm, confident, slightly formal (like a real chief of staff)

---

## 8. Summary: The Winning Formula

```
Winning Astra OS =
    Existing FFT Lip-Sync (unique differentiator)
  + Polished Glassmorphism (unified design tokens)
  + Live Context Cards (calendar/email/brain visible)
  + Tool-Use Animation (agent thinking = visible)
  + State Machine Polish (4 clear visual states)
  + Memory Demo (long-term recall = "wow" moment)
  + Clean 3-Min Video (hook → problem → demo → architecture → vision)
```

**What NOT to do:**
- Don't add Three.js / heavy 3D — the portrait lip-sync IS the differentiator
- Don't redesign the layout fundamentally — the two-pane structure works
- Don't add mobile responsiveness — waste of time for a demo video
- Don't over-animate — Hume AI teaches us that authenticity > flash
- Don't build features you can't demo in 3 minutes

**The single most impactful change:** Make the right panel show LIVE context (next meeting, unread emails, brain insights) that visually updates as Astra mentions them. This is the "Beyond Text Factor" — information appearing on screen synced with the voice conversation, not hidden behind tool calls.
