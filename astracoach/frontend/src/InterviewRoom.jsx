/**
 * InterviewRoom.jsx
 * ==================
 * The main interview experience.
 *
 * Layout:
 *   LEFT  — Gemini Avatar (animated, audio-driven lip sync) + waveform
 *   RIGHT — Candidate camera + live transcript + tool activity indicator
 *   TOP   — Timer, session info, controls
 *
 * Audio flow:
 *   Mic → AudioWorklet → useAudioPipeline.sendPcm → WebSocket (binary)
 *   WebSocket (binary) → useAudioPipeline.playPcm → AudioWorklet → Speaker
 *   AudioWorklet amplitude → GeminiAvatar audioLevel prop
 *
 * Vision flow:
 *   Camera → canvas → JPEG → WebSocket (JSON) → Backend → Gemini
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import GeminiAvatar from './components/GeminiAvatar'
import { useAudioPipeline } from './hooks/useAudioPipeline'
import { useInterviewSession } from './hooks/useInterviewSession'

export default function InterviewRoom({ session, onEnd }) {
  const { session_id, config, backendUrl } = session

  // ── State ────────────────────────────────────────────────
  const [elapsed, setElapsed] = useState(0)
  const [muted, setMuted] = useState(false)
  const [camOn, setCamOn] = useState(true)
  const [audioLevel, setAudioLevel] = useState(0)
  const [started, setStarted] = useState(false)
  const [ending, setEnding] = useState(false)
  const videoRef = useRef(null)
  const camStreamRef = useRef(null)

  // ── Audio pipeline ───────────────────────────────────────
  const audio = useAudioPipeline({
    onPcmChunk: (buf) => iv.sendPcm(buf),
    onAmplitude: (amp) => setAudioLevel(amp),
  })

  // ── Interview session (WebSocket) ─────────────────────────
  const iv = useInterviewSession({
    sessionId: session_id,
    wsBaseUrl: backendUrl,
    onPcmReceived: (buf) => audio.playPcm(buf),
  })

  // Wire camera video element into session hook
  useEffect(() => {
    if (videoRef.current) iv.setVideoRef(videoRef.current)
  }, [iv])

  // ── Timer ────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // ── Start interview (user gesture required for AudioContext) ──
  const handleStart = useCallback(async () => {
    await audio.start()
    await audio.resume()

    // Start camera
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      camStreamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch { setCamOn(false) }

    iv.connect()
    setStarted(true)
  }, [audio, iv])

  // ── Mute mic ─────────────────────────────────────────────
  const handleMute = () => {
    const next = !muted
    setMuted(next)
    audio.setMuted(next)
  }

  // ── End interview ─────────────────────────────────────────
  const handleEnd = async () => {
    setEnding(true)
    audio.stop()
    iv.disconnect()
    camStreamRef.current?.getTracks().forEach(t => t.stop())
    try {
      await fetch(`${backendUrl}/api/session/${session_id}/end`, { method: 'POST' })
    } catch { }
    onEnd()
  }

  // ── Muted mic feedback ───────────────────────────────────
  useEffect(() => {
    audio.setMuted(muted)
  }, [muted, audio])

  const avatarState = !started ? 'idle' : iv.avatarState
  const showTranscript = iv.transcript.length > 0

  return (
    <div style={S.root}>

      {/* ── Top bar ── */}
      <div style={S.topBar} className="glass">
        <div style={S.topLeft}>
          <div style={S.dot} />
          <span style={S.brand}>AstraCoach</span>
          {config.job_role && config.company && (
            <span style={S.badge}>{config.job_role} @ {config.company}</span>
          )}
          {config.difficulty && (
            <span style={{
              ...S.diffBadge,
              color: config.difficulty === 'hard' ? '#fca5a5' : config.difficulty === 'easy' ? '#86efac' : '#fcd34d',
              background: config.difficulty === 'hard' ? 'rgba(239,68,68,0.12)' : config.difficulty === 'easy' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
            }}>{config.difficulty.toUpperCase()}</span>
          )}
        </div>
        <div style={S.timer}>{fmt(elapsed)}</div>
        <div style={S.topRight}>
          {started && (
            <>
              <Btn active={muted} onClick={handleMute} title={muted ? 'Unmute' : 'Mute mic'}>
                {muted ? '🔇' : '🎙️'}
              </Btn>
              <Btn active={false} onClick={() => { }} title="Camera">
                {camOn ? '📷' : '📷'}
              </Btn>
            </>
          )}
          <button style={S.endBtn} onClick={handleEnd} disabled={ending}>
            {ending ? 'Ending…' : 'End Interview'}
          </button>
        </div>
      </div>

      {/* ── Stage ── */}
      <div style={S.stage}>

        {/* ── LEFT: Avatar ── */}
        <div style={S.avatarPane}>
          {/* Gemini badge */}
          <div style={S.gemBadge}>
            <span style={S.gemDot} />
            Gemini 2.5 Flash · Native Audio
          </div>

          <div style={S.avatarCenter}>
            <GeminiAvatar
              state={avatarState}
              audioLevel={audioLevel}
              name="Alex Chen"
            />

            {iv.activeTool && (
              <div style={S.toolPill}>
                <span style={S.toolSpin} className="spin">⟳</span>
                Using: {iv.activeTool.replace(/_/g, ' ')}
              </div>
            )}

            {iv.error && (
              <div style={S.errPill}>⚠ {iv.error}</div>
            )}
          </div>

          {/* Start button overlay — shown before interview begins */}
          {!started && (
            <div style={S.startOverlay}>
              <button style={S.startBtn} onClick={handleStart}>
                <span style={{ fontSize: 24 }}>🎙️</span>
                <span>Allow Mic & Start</span>
                {audio.micError && <span style={S.micErr}>{audio.micError}</span>}
              </button>
              <p style={S.startNote}>
                We need microphone access to begin.<br />
                Allow it in your browser when prompted.
              </p>
            </div>
          )}

          {/* Status strip */}
          <div style={S.statusStrip}>
            <StatusDot state={avatarState} />
            {iv.wsState === 'connecting' && <span style={S.statusTxt}>Connecting to Gemini…</span>}
            {iv.wsState === 'ready' && <span style={S.statusTxt}>Session ready</span>}
            {iv.wsState === 'active' && <span style={S.statusTxt}>Live session</span>}
            {iv.wsState === 'ended' && <span style={S.statusTxt}>Session ended</span>}
            {muted && <span style={S.mutedBadge}>🔇 Muted</span>}
          </div>
        </div>

        {/* ── RIGHT: Camera + Transcript ── */}
        <div style={S.rightPane}>

          {/* Camera */}
          <div style={S.camCard} className="glass">
            <div style={S.camHeader}>
              <span style={S.camLabel}>You</span>
              {camOn && started && (
                <span style={S.camLive}>
                  <span style={S.camLiveDot} />LIVE
                </span>
              )}
            </div>
            <div style={S.camBox}>
              <video ref={videoRef} autoPlay muted playsInline
                style={{ ...S.video, transform: 'scaleX(-1)' }} />
              {!camOn && (
                <div style={S.noCamera}><span>📷</span><span style={S.noCamTxt}>Camera off</span></div>
              )}
            </div>
          </div>

          {/* Transcript */}
          <div style={{ ...S.transcriptCard, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }} className="glass">
            <div style={S.transcriptHeader}>
              💬 Live Transcript
              {showTranscript && (
                <span style={S.transcriptCount}>{iv.transcript.length} turns</span>
              )}
            </div>
            <div style={S.transcriptBody}>
              {!showTranscript
                ? <div style={S.transcriptEmpty}>Transcript will appear here…</div>
                : iv.transcript.map((t, i) => (
                  <div key={i} style={{
                    ...S.transcriptEntry,
                    ...(t.role === 'model' ? S.modelEntry : S.userEntry),
                  }}>
                    <span style={{
                      ...S.tRole,
                      color: t.role === 'model' ? '#93c5fd' : '#86efac',
                    }}>
                      {t.role === 'model' ? 'Alex' : 'You'}
                    </span>
                    <span style={S.tText}>{t.text}</span>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Tips */}
          <div style={S.tipsCard} className="glass">
            <div style={S.tipsTitle}>💡 Live Tips</div>
            <div style={S.tipsList}>
              {['Look at the camera — not the screen', 'Use STAR: Situation, Task, Action, Result', 'Pause to think — silence is confidence'].map((t, i) => (
                <div key={i} style={S.tip}>{t}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Small components ─────────────────────────────────────────────

function Btn({ active, onClick, title, children }) {
  return (
    <button style={{ ...S.iconBtn, background: active ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)' }}
      onClick={onClick} title={title}>
      {children}
    </button>
  )
}

function StatusDot({ state }) {
  const color = state === 'speaking' ? '#22c55e' : state === 'listening' ? '#4f7dff' : state === 'thinking' ? '#a855f7' : '#475569'
  return <div style={{ ...S.statusDot, background: color, boxShadow: `0 0 6px ${color}` }} />
}

// ── Styles ────────────────────────────────────────────────────────
const S = {
  root: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#07070f', overflow: 'hidden' },
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '9px 18px', borderRadius: 0, borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0
  },
  topLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  dot: { width: 7, height: 7, borderRadius: '50%', background: 'linear-gradient(135deg,#4f7dff,#a855f7)' },
  brand: { fontSize: 14, fontWeight: 700, color: '#eef0fa' },
  badge: {
    fontSize: 11, background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 6,
    color: 'rgba(238,240,250,0.55)'
  },
  diffBadge: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, letterSpacing: '0.05em' },
  timer: {
    fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
    color: '#eef0fa', letterSpacing: '0.04em'
  },
  topRight: { display: 'flex', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 34, height: 34, borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)',
    color: '#eef0fa', cursor: 'pointer', fontSize: 15, display: 'flex',
    alignItems: 'center', justifyContent: 'center'
  },
  endBtn: {
    padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
    color: '#fca5a5', cursor: 'pointer'
  },
  stage: { display: 'flex', flex: 1, overflow: 'hidden' },
  avatarPane: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', position: 'relative', background: '#07070f',
    borderRight: '1px solid rgba(255,255,255,0.05)'
  },
  gemBadge: {
    position: 'absolute', top: 14, left: 14, display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 11, color: 'rgba(238,240,250,0.5)', background: 'rgba(255,255,255,0.04)',
    padding: '4px 10px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.07)'
  },
  gemDot: {
    width: 6, height: 6, borderRadius: '50%', background: '#4f7dff',
    display: 'inline-block', animation: 'dotPulse 2s ease-in-out infinite'
  },
  avatarCenter: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 },
  toolPill: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
    color: '#c4b5fd', background: 'rgba(168,85,247,0.1)',
    padding: '5px 12px', borderRadius: 20, border: '1px solid rgba(168,85,247,0.25)'
  },
  toolSpin: { display: 'inline-block', fontSize: 14 },
  errPill: {
    fontSize: 12, color: '#fca5a5', background: 'rgba(239,68,68,0.08)',
    padding: '5px 12px', borderRadius: 20, border: '1px solid rgba(239,68,68,0.2)'
  },
  startOverlay: {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 14,
    background: 'rgba(7,7,15,0.85)', backdropFilter: 'blur(8px)'
  },
  startBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    padding: '20px 40px', borderRadius: 16,
    background: 'linear-gradient(135deg,#4f7dff,#7c3aed)',
    border: 'none', color: 'white', fontSize: 15, fontWeight: 700, cursor: 'pointer'
  },
  micErr: { fontSize: 11, color: '#fca5a5', marginTop: 4 },
  startNote: { fontSize: 12, color: 'rgba(238,240,250,0.35)', textAlign: 'center', lineHeight: 1.6 },
  statusStrip: {
    position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'rgba(255,255,255,0.04)', padding: '5px 14px',
    borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)'
  },
  statusDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  statusTxt: { fontSize: 11, color: 'rgba(238,240,250,0.45)' },
  mutedBadge: {
    fontSize: 11, color: '#fca5a5', background: 'rgba(239,68,68,0.1)',
    padding: '1px 8px', borderRadius: 20
  },
  rightPane: {
    width: 300, display: 'flex', flexDirection: 'column', gap: 10, padding: 12,
    overflowY: 'auto', background: 'rgba(255,255,255,0.008)'
  },
  camCard: { borderRadius: 12, overflow: 'hidden', flexShrink: 0 },
  camHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '7px 11px', borderBottom: '1px solid rgba(255,255,255,0.05)'
  },
  camLabel: { fontSize: 11, fontWeight: 600, color: 'rgba(238,240,250,0.55)' },
  camLive: {
    display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700,
    letterSpacing: '0.08em', color: '#86efac'
  },
  camLiveDot: {
    width: 6, height: 6, borderRadius: '50%', background: '#22c55e',
    display: 'inline-block', animation: 'dotPulse 1s ease-in-out infinite'
  },
  camBox: { position: 'relative', aspectRatio: '4/3', background: '#050509' },
  video: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  noCamera: {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 28
  },
  noCamTxt: { fontSize: 11, color: 'rgba(238,240,250,0.3)' },
  transcriptCard: { borderRadius: 12 },
  transcriptHeader: {
    padding: '8px 12px', fontSize: 11, fontWeight: 600,
    color: 'rgba(238,240,250,0.5)', textTransform: 'uppercase',
    letterSpacing: '0.05em', borderBottom: '1px solid rgba(255,255,255,0.05)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    flexShrink: 0
  },
  transcriptCount: { fontSize: 10, color: 'rgba(238,240,250,0.3)' },
  transcriptBody: {
    padding: 10, overflowY: 'auto', flex: 1, display: 'flex',
    flexDirection: 'column', gap: 6
  },
  transcriptEmpty: { fontSize: 12, color: 'rgba(238,240,250,0.25)', fontStyle: 'italic' },
  transcriptEntry: { display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px', borderRadius: 8 },
  modelEntry: { background: 'rgba(79,125,255,0.06)', borderLeft: '2px solid rgba(79,125,255,0.4)' },
  userEntry: { background: 'rgba(34,197,94,0.05)', borderLeft: '2px solid rgba(34,197,94,0.3)' },
  tRole: { fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' },
  tText: { fontSize: 12, color: 'rgba(238,240,250,0.8)', lineHeight: 1.55 },
  tipsCard: { borderRadius: 12, padding: 12, flexShrink: 0 },
  tipsTitle: {
    fontSize: 11, fontWeight: 600, color: 'rgba(238,240,250,0.4)',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8
  },
  tipsList: { display: 'flex', flexDirection: 'column', gap: 5 },
  tip: {
    fontSize: 11, color: 'rgba(238,240,250,0.5)', lineHeight: 1.5,
    paddingBottom: 5, borderBottom: '1px solid rgba(255,255,255,0.04)'
  },
}
