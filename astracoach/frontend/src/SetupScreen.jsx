/**
 * SetupScreen.jsx — Persona Studio
 * ==================================
 * The main launch pad. Users can:
 *  1. Pick a pre-built persona template (Interview Coach, Language Tutor, etc.)
 *  2. Customise the template prompt OR write from scratch
 *  3. Choose voice, name, then launch the live session
 *
 * The system_prompt they write becomes the FULL agent persona —
 * Gemini Live uses it directly with no modification (except the
 * universal live-session suffix the backend appends).
 */

import { useState, useEffect } from 'react'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

// ── Persona Templates ─────────────────────────────────────────────
// These are just starting-point prompts. The user can edit freely.
const TEMPLATES = [
  {
    id: 'astra',
    icon: '🌟',
    name: 'Astra — AI Chief of Staff',
    tagline: 'Your founder\'s operating system. Tracks commitments, relationships & risks.',
    color: '#7c3aed',
    prompt: `You are Astra — the founder's AI chief of staff. You are not an assistant. You are the operational backbone of this startup. You think like a seasoned COO who's been in the trenches.

VOICE & TONE:
- You sound like a sharp, calm executive who's been briefed on everything
- No filler. No "certainly!" No "great question!" — founders hate that
- Speak in short, punchy sentences. Max 3-4 sentences per response
- Use the founder's first name. Reference specific people, deals, and dates
- When something is urgent, your voice should carry weight — "This needs your attention now"
- When things are good, be warm but brief — "Looking clean today. Nothing on fire."

OPERATING PRINCIPLES:
- ALWAYS call tools before answering. Never guess at data. Never hallucinate a name, date, or commitment
- If the founder asks about a person, call get_relationship_health first
- If they ask about emails, call get_recent_emails first
- If they ask "what's going on" or "brief me", call get_brain_summary, then get_overdue_commitments, then get_pending_alerts — in that order
- If they mention a meeting, call get_todays_schedule or get_upcoming_meetings
- After giving information, always suggest the next action: "Want me to draft a reply?" or "Should I flag this as resolved?"

BRIEFING PROTOCOL (when founder says "brief me" / "what do I need to know" / "morning update"):
Call these tools in sequence, then synthesize:
1. get_brain_summary — get the big picture numbers
2. get_overdue_commitments — what's slipping
3. get_pending_alerts — what's flagged
4. get_at_risk_relationships — who needs attention
5. get_todays_schedule — what's coming today
Deliver it like a 30-second executive briefing. Most critical item first. Numbers, names, deadlines.

EMAIL ACTIONS:
- When asked to send or reply to an email, confirm the recipient and key message before calling send_email or reply_to_email
- Draft emails in the founder's voice — direct, professional, no fluff
- After sending, say "Sent." and move on. Don't over-explain

RELATIONSHIP INTELLIGENCE:
- Track every person mentioned. If the founder says "How's things with Sarah?", call get_relationship_health immediately
- If health score is below 0.4, flag it proactively: "Heads up — your relationship with Sarah has dropped to 35%. Last contact was 12 days ago."
- Use tone_trend data to add color: "The tone in recent emails has been cooling"

TASK MANAGEMENT:
- When the founder commits to something in conversation, note it
- When they complete something, offer to mark it done: "Want me to close that task?"
- Surface blocked tasks without being asked

YOU ARE NOT:
- A chatbot that says "How can I help you today?"
- An assistant that qualifies everything with disclaimers
- Verbose. Ever. If it can be said in 10 words, don't use 20

You are the founder's unfair advantage. You remember everything. You see patterns. You never drop the ball.`,
  },
  {
    id: 'interview',
    icon: '💼',
    name: 'Interview Coach',
    tagline: 'Tough but fair. Preps you for FAANG.',
    color: '#4f7dff',
    prompt: `You are Alex Chen, a senior technical recruiter at a top tech company conducting a mock interview. You are warm but direct, and give specific, actionable feedback.

Interview structure:
1. Brief warm welcome (30 seconds)
2. 4-6 questions: mix of behavioral (STAR format) + technical/situational
3. Gentle micro-coaching after key answers
4. Closing with 2-3 specific improvement tips

Always probe deeper: if an answer is shallow, ask "Can you walk me through a specific example?" Keep responses under 60 words for natural pacing. Research the candidate's target company using web_search at the start.`,
  },
  {
    id: 'language',
    icon: '🌍',
    name: 'Language Tutor',
    tagline: 'Immersive conversation practice.',
    color: '#10b981',
    prompt: `You are Sofia, a native Spanish speaker and patient language tutor. Your goal is to help the user practice conversational Spanish through natural dialogue.

How you teach:
- Speak primarily in Spanish, but switch to English when the user is confused
- Gently correct grammar mistakes by repeating the sentence correctly: "Ah, you mean: [correct version]..."
- Ask open-ended questions to keep the conversation flowing
- Adapt difficulty to the user's level — start easy, push gradually
- After every 5 exchanges, give a brief tip on a grammar point you noticed

Start by asking the user's name and what they want to talk about today.`,
  },
  {
    id: 'socrates',
    icon: '🏛️',
    name: 'Socratic Tutor',
    tagline: 'Learn anything through questions.',
    color: '#f59e0b',
    prompt: `You are a brilliant Socratic tutor. You never give direct answers — instead, you guide the student to discover the answer themselves through questions.

Your method:
- Ask targeted questions that expose what the student already knows
- When they're stuck, ask a simpler sub-question
- When they get something right, validate it then push further: "Good. So then what would happen if...?"
- Use analogies from everyday life to make abstract ideas concrete
- Never lecture — only question and guide

You can tutor any subject: math, science, history, philosophy, coding, literature. Ask the student what subject they want to explore today.`,
  },
  {
    id: 'sales',
    icon: '📈',
    name: 'Sales Coach',
    tagline: 'Roleplay cold calls and objection handling.',
    color: '#8b5cf6',
    prompt: `You are Marcus, a veteran sales coach with 20 years of experience. You run live sales roleplay scenarios to help salespeople improve.

Session flow:
1. Ask the user what they sell and who their ideal customer is
2. Roleplay as a realistic prospect — skeptical but not hostile
3. React naturally to their pitch: ask tough questions, raise real objections
4. After each practice round, give a 30-second debrief on what worked and what to improve
5. Focus on: opening hooks, objection handling, closing techniques

Push back realistically. Don't make it too easy. A good sales rep should earn the deal.`,
  },
  {
    id: 'doctor',
    icon: '🩺',
    name: 'Medical Tutor',
    tagline: 'Clinical case walkthroughs for students.',
    color: '#ef4444',
    prompt: `You are Dr. Patel, an experienced attending physician who teaches medical students through clinical case discussions. You are thorough, patient, and passionate about evidence-based medicine.

How you teach:
- Present a patient case step by step (history, then vitals, then labs)
- Ask the student for their differential diagnosis at each stage
- Guide them through clinical reasoning with questions: "What finding makes you think that?"
- Reference real guidelines (UpToDate, ACC, WHO) using web_search when discussing management
- Celebrate good reasoning; gently correct gaps without being dismissive

Emphasise: systematic thinking, patient safety, and "why" over memorisation. Start by presenting today's case.

⚠️ Educational purpose only — not medical advice.`,
  },
  {
    id: 'therapist',
    icon: '🧠',
    name: 'Reflective Listener',
    tagline: 'A supportive space to think out loud.',
    color: '#06b6d4',
    prompt: `You are a warm, non-judgmental reflective listener. Your role is to help the user process their thoughts and feelings through active listening and gentle questions. You do NOT give advice unless explicitly asked.

Your approach:
- Reflect back what you hear: "It sounds like you're feeling..."
- Ask open questions that deepen reflection: "What do you think is driving that?"
- Validate emotions without projecting: "That makes a lot of sense given what you described"
- Notice patterns and gently name them: "I've noticed you mention [X] a few times..."
- If distress seems serious, compassionately suggest professional support

Keep responses short (2-3 sentences). You are a thinking partner, not a therapist.`,
  },
  {
    id: 'custom',
    icon: '✏️',
    name: 'Custom Persona',
    tagline: 'Write your own from scratch.',
    color: '#94a3b8',
    prompt: `You are [NAME], a [DESCRIPTION].

Your goal: [WHAT THE AGENT DOES]

How you behave:
- [PERSONALITY TRAIT 1]
- [PERSONALITY TRAIT 2]
- [PERSONALITY TRAIT 3]

Session structure:
1. [STEP 1]
2. [STEP 2]
3. [STEP 3]

Replace everything in [brackets] with your own content.`,
  },
]

export default function SetupScreen({ onStart }) {
  const [selectedId, setSelectedId] = useState('astra')
  const [prompt, setPrompt] = useState(TEMPLATES[0].prompt)
  const [personaName, setPersonaName] = useState(TEMPLATES[0].name)
  const [userName, setUserName] = useState('')
  const [voice, setVoice] = useState('Charon')
  const [voices, setVoices] = useState([])
  const [tab, setTab] = useState('templates')  // 'templates' | 'editor'
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState(null)   // 'avatar' | 'session' | null
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${BACKEND}/api/voices`)
      .then(r => r.json())
      .then(d => setVoices(d.voices || []))
      .catch(() => { })
  }, [])

  const selectTemplate = (tpl) => {
    setSelectedId(tpl.id)
    setPrompt(tpl.prompt)
    setPersonaName(tpl.name)
    setTab('editor')
  }

  const handleStart = async () => {
    if (!prompt.trim()) { setError('Please write a persona prompt.'); return }
    setError('')
    setLoading(true)

    // ── Phase 1: Generate AI portrait avatar via Imagen 3 ─────────────────
    // Non-fatal: if this fails we fall back to the SVG orb avatar gracefully.
    let avatarImage = null
    setLoadingStep('avatar')
    try {
      const avatarRes = await fetch(`${BACKEND}/api/generate-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona_description: personaName.trim() || 'a professional AI assistant',
        }),
      })
      if (avatarRes.ok) {
        const avatarData = await avatarRes.json()
        avatarImage = avatarData.image || null
        console.log('[SetupScreen] ✅ Portrait generated via', avatarData.model)
      } else {
        console.warn('[SetupScreen] Avatar API returned', avatarRes.status, '— using SVG fallback')
      }
    } catch (e) {
      // Network error or backend not running — non-fatal, just use SVG orb
      console.warn('[SetupScreen] Avatar generation failed (SVG fallback):', e.message)
    }

    // ── Phase 2: Create the live agent session ────────────────────────────
    setLoadingStep('session')
    try {
      const res = await fetch(`${BACKEND}/api/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona_name: personaName.trim() || 'AI Agent',
          system_prompt: prompt.trim(),
          voice,
          user_name: userName.trim(),
        }),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.detail || 'Server error')
      }
      const data = await res.json()
      // Pass avatarImage alongside the session data — InterviewRoom picks it up
      onStart({ ...data, backendUrl: BACKEND, avatarImage })
    } catch (e) {
      setError(e.message || 'Failed — is the backend running?')
    } finally {
      setLoading(false)
      setLoadingStep(null)
    }
  }

  const selectedTpl = TEMPLATES.find(t => t.id === selectedId) || TEMPLATES[0]

  return (
    <div style={S.root}>
      <div style={S.blob1} /><div style={S.blob2} />

      <div style={S.shell}>
        {/* ── Left: Header + Template Gallery ── */}
        <div style={S.left}>
          <div style={S.logoRow}>
            <div style={S.logoMark}>A</div>
            <div>
              <div style={S.logoTitle}>AstraAgent</div>
              <div style={S.logoSub}>Live AI Agent Platform</div>
            </div>
          </div>

          <p style={S.pitch}>
            Write a prompt. Launch any AI persona — interviewer, tutor, coach, companion.
            Powered by Gemini 2.5 Flash Live + ADK.
          </p>

          <div style={S.pillRow}>
            {['Hears you', 'Sees you', 'Speaks back', 'Any persona'].map(p => (
              <span key={p} style={S.pill}>{p}</span>
            ))}
          </div>

          {/* Template grid */}
          <div style={S.tplLabel}>Choose a starting template</div>
          <div style={S.tplGrid}>
            {TEMPLATES.map(t => (
              <button key={t.id} onClick={() => selectTemplate(t)}
                style={{ ...S.tplCard, ...(selectedId === t.id ? { ...S.tplActive, borderColor: t.color + '80', background: t.color + '12' } : {}) }}>
                <span style={S.tplIcon}>{t.icon}</span>
                <div style={S.tplName}>{t.name}</div>
                <div style={S.tplTagline}>{t.tagline}</div>
                {selectedId === t.id && <div style={{ ...S.tplDot, background: t.color }} />}
              </button>
            ))}
          </div>
        </div>

        {/* ── Right: Persona Editor + Launch ── */}
        <div style={S.right} className="glass">

          {/* Tabs */}
          <div style={S.tabRow}>
            {['editor', 'settings'].map(t => (
              <button key={t} style={{ ...S.tabBtn, ...(tab === t ? S.tabActive : {}) }}
                onClick={() => setTab(t)}>
                {t === 'editor' ? '✏️ Persona Prompt' : '⚙️ Settings'}
              </button>
            ))}
          </div>

          {tab === 'editor' && (
            <>
              <div style={S.editorHeader}>
                <span style={{ ...S.tplIcon, fontSize: 20 }}>{selectedTpl.icon}</span>
                <input style={S.nameInput} value={personaName}
                  onChange={e => setPersonaName(e.target.value)}
                  placeholder="Persona name…" />
              </div>

              <div style={S.promptHelp}>
                Edit the system prompt below. This is what defines your agent's personality,
                goals, and behaviour. Be specific — Gemini follows it precisely.
              </div>

              <textarea
                style={S.promptArea}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Write your agent's system prompt here…"
                rows={14}
                spellCheck={false}
              />

              <div style={S.charCount}>{prompt.length} chars</div>
            </>
          )}

          {tab === 'settings' && (
            <div style={S.settingsPane}>
              <div style={S.settingGroup}>
                <label style={S.settingLabel}>Your name (optional)</label>
                <input style={S.settingInput} placeholder="e.g. Khwahish"
                  value={userName} onChange={e => setUserName(e.target.value)} />
                <div style={S.settingHint}>The agent will address you by name</div>
              </div>

              <div style={S.settingGroup}>
                <label style={S.settingLabel}>Agent voice</label>
                {voices.length > 0 ? (
                  <select style={S.settingInput} value={voice}
                    onChange={e => setVoice(e.target.value)}>
                    {voices.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                ) : (
                  <select style={S.settingInput} value={voice}
                    onChange={e => setVoice(e.target.value)}>
                    {['Charon', 'Orus', 'Fenrir', 'Puck', 'Aoede', 'Kore', 'Leda', 'Zephyr'].map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                )}
                <div style={S.settingHint}>Gemini's built-in neural voice for this agent</div>
              </div>

              <div style={S.settingGroup}>
                <label style={S.settingLabel}>Available tools (always on)</label>
                {[
                  '🔍 Web Search (Google)',
                  '📊 Evaluate Response',
                  '🎯 Live Coaching',
                  '🧠 Remember Context',
                  '📋 Structured Plan',
                  '🔬 Document Analysis (ReasoningAgent)',
                ].map(t => (
                  <div key={t} style={S.toolItem}><span style={S.toolCheck}>✓</span>{t}</div>
                ))}
                <div style={S.settingHint}>
                  Hold up a document or resume to the camera — the agent will
                  automatically delegate to ReasoningAgent for deep analysis
                </div>
              </div>
            </div>
          )}

          {error && <div style={S.error}>{error}</div>}

          <button style={{ ...S.launchBtn, ...(loading ? S.launchLoading : {}) }}
            onClick={handleStart} disabled={loading}>
            {loadingStep === 'avatar'
              ? <><span style={S.spinner} className="spin" /> Generating portrait via Imagen 3…</>
              : loadingStep === 'session'
                ? <><span style={S.spinner} className="spin" /> Launching agent…</>
                : <><span>🚀</span> Launch {personaName || 'Agent'}</>
            }
          </button>

          <div style={S.footer}>
            Gemini 2.5 Flash Native Audio · Imagen 3 Avatar · ADK Tri-Agent · Cloud Run
          </div>
        </div>
      </div>
    </div>
  )
}

const S = {
  root: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 24, position: 'relative', overflow: 'hidden'
  },
  blob1: {
    position: 'fixed', width: 800, height: 800, borderRadius: '50%', top: -300, left: -300,
    background: 'radial-gradient(circle,rgba(79,125,255,0.1) 0%,transparent 70%)',
    pointerEvents: 'none'
  },
  blob2: {
    position: 'fixed', width: 700, height: 700, borderRadius: '50%', bottom: -250, right: -250,
    background: 'radial-gradient(circle,rgba(168,85,247,0.08) 0%,transparent 70%)',
    pointerEvents: 'none'
  },
  shell: { display: 'flex', gap: 24, maxWidth: 980, width: '100%', alignItems: 'flex-start' },
  left: { width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 },
  logoRow: { display: 'flex', alignItems: 'center', gap: 12 },
  logoMark: {
    width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg,#4f7dff,#a855f7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 20, fontWeight: 900, color: 'white', flexShrink: 0
  },
  logoTitle: { fontSize: 20, fontWeight: 700, color: '#eef0fa' },
  logoSub: { fontSize: 11, color: 'rgba(238,240,250,0.4)' },
  pitch: {
    fontSize: 13, color: 'rgba(238,240,250,0.6)', lineHeight: 1.7,
    borderLeft: '2px solid rgba(79,125,255,0.4)', paddingLeft: 12
  },
  pillRow: { display: 'flex', flexWrap: 'wrap', gap: 5 },
  pill: {
    fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
    background: 'rgba(79,125,255,0.1)', color: 'rgba(79,125,255,0.85)',
    border: '1px solid rgba(79,125,255,0.2)'
  },
  tplLabel: {
    fontSize: 11, fontWeight: 600, color: 'rgba(238,240,250,0.4)',
    textTransform: 'uppercase', letterSpacing: '0.06em'
  },
  tplGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  tplCard: {
    padding: '12px 10px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)',
    background: 'rgba(255,255,255,0.02)', cursor: 'pointer', textAlign: 'left',
    position: 'relative', transition: 'all 0.2s'
  },
  tplActive: {},
  tplDot: { position: 'absolute', top: 8, right: 8, width: 7, height: 7, borderRadius: '50%' },
  tplIcon: { fontSize: 22, display: 'block', marginBottom: 5 },
  tplName: { fontSize: 12, fontWeight: 700, color: '#eef0fa', marginBottom: 2 },
  tplTagline: { fontSize: 10, color: 'rgba(238,240,250,0.4)', lineHeight: 1.4 },
  right: { flex: 1, display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden', minHeight: 500 },
  tabRow: { display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 4px' },
  tabBtn: {
    padding: '11px 16px', fontSize: 12, fontWeight: 600, color: 'rgba(238,240,250,0.45)',
    background: 'none', border: 'none', cursor: 'pointer', borderBottom: '2px solid transparent',
    marginBottom: '-1px', transition: 'all 0.2s'
  },
  tabActive: { color: '#4f7dff', borderBottomColor: '#4f7dff' },
  editorHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 0' },
  nameInput: {
    flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8, padding: '7px 10px', color: '#eef0fa', fontSize: 14,
    fontWeight: 600, outline: 'none', fontFamily: 'inherit'
  },
  promptHelp: { fontSize: 11, color: 'rgba(238,240,250,0.35)', padding: '8px 16px 0', lineHeight: 1.5 },
  promptArea: {
    margin: '10px 16px 0', borderRadius: 10, background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)', color: '#eef0fa', fontSize: 12,
    lineHeight: 1.7, padding: '12px 14px', resize: 'vertical', outline: 'none',
    fontFamily: 'inherit', minHeight: 220
  },
  charCount: {
    fontSize: 10, color: 'rgba(238,240,250,0.2)', textAlign: 'right',
    padding: '4px 18px 0'
  },
  settingsPane: { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 18, flex: 1 },
  settingGroup: { display: 'flex', flexDirection: 'column', gap: 5 },
  settingLabel: {
    fontSize: 11, fontWeight: 600, color: 'rgba(238,240,250,0.45)',
    textTransform: 'uppercase', letterSpacing: '0.05em'
  },
  settingInput: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 8, padding: '8px 11px', color: '#eef0fa', fontSize: 13,
    outline: 'none', fontFamily: 'inherit'
  },
  settingHint: { fontSize: 10, color: 'rgba(238,240,250,0.28)' },
  toolItem: {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
    color: 'rgba(238,240,250,0.55)', padding: '3px 0'
  },
  toolCheck: { color: '#22c55e', fontWeight: 700 },
  error: {
    margin: '0 16px', background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8,
    padding: '9px 12px', color: '#fca5a5', fontSize: 12
  },
  launchBtn: {
    margin: '12px 16px 8px', padding: '13px', borderRadius: 11,
    background: 'linear-gradient(135deg,#4f7dff,#7c3aed)',
    border: 'none', color: 'white', fontSize: 14, fontWeight: 700,
    cursor: 'pointer', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: 10, transition: 'opacity 0.2s'
  },
  launchLoading: { opacity: 0.65, cursor: 'not-allowed' },
  spinner: {
    width: 15, height: 15, border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: 'white', borderRadius: '50%', display: 'inline-block'
  },
  footer: {
    fontSize: 10, color: 'rgba(238,240,250,0.22)', textAlign: 'center',
    padding: '0 16px 14px'
  },
}
