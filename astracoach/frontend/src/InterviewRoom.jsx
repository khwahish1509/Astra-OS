/**
 * AgentRoom.jsx  (file kept as InterviewRoom.jsx for routing compatibility)
 * =========================================================================
 * The main live-agent session screen. Works with any persona — interview
 * coach, language tutor, sales coach, or any custom system prompt.
 *
 * Layout:
 *   LEFT  — Avatar (Simli photorealistic when connected; GeminiAvatar SVG fallback)
 *   RIGHT — User camera + live transcript + tool activity indicator
 *   TOP   — Timer, persona info, controls
 *
 * Audio flow:
 *   Mic → AudioWorklet → useAudioPipeline.sendPcm → WebSocket (binary)
 *   WebSocket binary → audio.playPcm → AudioWorklet → Speaker  (fallback / amplitude)
 *   WebSocket binary → simli.sendPcm24kHz → Simli WebRTC → <audio>  (avatar audio)
 *   AudioWorklet amplitude → GeminiAvatar audioLevel prop (used only when Simli is off)
 *
 * Simli avatar handoff:
 *   simli.onConnected    → audio.setPlaybackVolume(0)  — Simli WebRTC carries audio
 *   simli.onDisconnected → audio.setPlaybackVolume(1)  — AudioWorklet fallback resumes
 *   GainNode transition is click-free (60 ms exponential ramp)
 *
 * Barge-in flow:
 *   onSpeechStart → activity_start WS msg → backend interrupts Gemini
 *   onInterrupted → flushPcm (drain playback queue immediately)
 *   onResumeAudio → resumePcm (re-open worklet gate after barge-in)
 *
 * Vision flow:
 *   Camera → canvas → JPEG → WebSocket (JSON) → Backend → Gemini
 *
 * Hook ordering (important — avoids undefined-reference issues):
 *   1. useAudioPipeline  — no deps on other hooks
 *   2. useSimliAvatar    — onConnected/onDisconnected call audio.setPlaybackVolume
 *   3. useInterviewSession — onPcmReceived routes to both audio and simli
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import GeminiAvatar from './components/GeminiAvatar'
import { useAudioPipeline }    from './hooks/useAudioPipeline'
import { useSimliAvatar }      from './hooks/useSimliAvatar'
import { useInterviewSession } from './hooks/useInterviewSession'

// ── Simli API key ────────────────────────────────────────────────────────────
// Set VITE_SIMLI_API_KEY in your .env to enable the photorealistic avatar.
// If the key is absent the app silently falls back to the GeminiAvatar SVG.
const SIMLI_API_KEY = import.meta.env.VITE_SIMLI_API_KEY || ''

// ── Component ────────────────────────────────────────────────────────────────

export default function InterviewRoom({ session, onEnd }) {
  const { session_id, config, backendUrl } = session

  // ── UI state ─────────────────────────────────────────────────────────────
  const [elapsed,        setElapsed]        = useState(0)
  const [muted,          setMuted]          = useState(false)
  const [camOn,          setCamOn]          = useState(true)
  const [audioLevel,     setAudioLevel]     = useState(0)
  const [started,        setStarted]        = useState(false)
  const [ending,         setEnding]         = useState(false)
  const [simliConnected, setSimliConnected] = useState(false)

  const camVideoRef  = useRef(null)   // user's camera <video> element
  const camStreamRef = useRef(null)   // user's MediaStream (for cleanup)

  // ── Simli availability check ──────────────────────────────────────────────
  // Simli requires both an API key AND a face ID from the selected persona.
  // If either is missing we render the GeminiAvatar SVG instead.
  const simliEnabled = Boolean(SIMLI_API_KEY) && Boolean(config.simli_face_id)

  // ── 1. Audio pipeline ─────────────────────────────────────────────────────
  // Defined first so simli (below) can reference audio.setPlaybackVolume.
  const audio = useAudioPipeline({
    onPcmChunk:   (buf) => iv.sendPcm(buf),          // iv closure — valid at call-time
    onAmplitude:  (amp) => setAudioLevel(amp),
    onSpeechStart: ()   => iv.onSpeechStart?.(),     // barge-in start
    onSpeechEnd:   ()   => iv.onSpeechEnd?.(),       // barge-in end
  })

  // ── 2. Simli photorealistic avatar ────────────────────────────────────────
  // onConnected   → mute AudioWorklet (Simli WebRTC carries audio from now on)
  // onDisconnected → restore AudioWorklet (fallback / Simli offline)
  const simli = useSimliAvatar({
    apiKey: SIMLI_API_KEY,
    faceId: config.simli_face_id || '',
    onConnected: () => {
      setSimliConnected(true)
      audio.setPlaybackVolume(0)    // ← audio defined above — always valid
    },
    onDisconnected: () => {
      setSimliConnected(false)
      audio.setPlaybackVolume(1)    // ← restore AudioWorklet playback
    },
  })

  // ── 3. WebSocket session ──────────────────────────────────────────────────
  // onPcmReceived dual-routes PCM:
  //   • audio.playPcm       — AudioWorklet (amplitude tracking + fallback speaker)
  //   • simli.sendPcm24kHz  — Simli (downsample 24→16 kHz, lip-sync avatar)
  const iv = useInterviewSession({
    sessionId:    session_id,
    wsBaseUrl:    backendUrl,
    onPcmReceived: (buf) => {
      audio.playPcm(buf)           // always feed worklet for amplitude
      simli.sendPcm24kHz(buf)      // Simli no-ops when not connected
    },
    onInterrupted: () => audio.flushPcm(),    // barge-in: drop queued audio
    onResumeAudio: () => audio.resumePcm(),   // barge-in done: re-open worklet gate
  })

  // Wire user camera element into session hook (for JPEG frame capture)
  useEffect(() => {
    if (camVideoRef.current) iv.setVideoRef(camVideoRef.current)
  }, [iv])

  // ── Timer ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const fmt = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // ── Start session ─────────────────────────────────────────────────────────
  // Must be triggered by a user gesture so AudioContext and WebRTC are allowed.
  const handleStart = useCallback(async () => {
    // 1. Start audio pipeline (opens AudioContext at 16 / 24 kHz)
    await audio.start()
    await audio.resume()

    // 2. Open user camera stream
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      camStreamRef.current = stream
      if (camVideoRef.current) camVideoRef.current.srcObject = stream
    } catch {
      setCamOn(false)   // camera denied — continue without it
    }

    // 3. Connect to Gemini Live via WebSocket
    iv.connect()

    // 4. Start Simli WebRTC session (must happen after user gesture)
    //    Simli streams a lip-synced video + audio back via WebRTC.
    //    No-op when simliEnabled is false (missing API key / face ID).
    if (simliEnabled) {
      simli.initialize()
    }

    setStarted(true)
  }, [audio, iv, simli, simliEnabled])

  // ── Mute / unmute mic ─────────────────────────────────────────────────────
  const handleMute = () => {
    const next = !muted
    setMuted(next)
    audio.setMuted(next)
  }

  // ── End session ───────────────────────────────────────────────────────────
  const handleEnd = async () => {
    setEnding(true)
    simli.close()                                               // close Simli WebRTC first
    audio.stop()                                                // close AudioContexts
    iv.disconnect()                                             // close WebSocket
    camStreamRef.current?.getTracks().forEach(t => t.stop())   // release camera
    try {
      await fetch(`${backendUrl}/api/session/${session_id}/end`, { method: 'POST' })
    } catch { /* ignore — session is ending anyway */ }
    onEnd()
  }

  // Keep audio mute state in sync with React state
  useEffect(() => {
    audio.setMuted(muted)
  }, [muted, audio])

  // ── Derived display flags ─────────────────────────────────────────────────
  const avatarState    = !started ? 'idle' : iv.avatarState
  const showTranscript = iv.transcript.length > 0
  const showSimliVideo = simliEnabled && simliConnected    // true → show Simli <video>

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>

      {/*
       * ── Simli media elements ──────────────────────────────────────────────
       * IMPORTANT: These MUST remain mounted at all times so that
       * SimliClient.Initialize() has valid DOM refs when called.
       * Visibility is controlled by CSS (display / opacity), NOT conditional
       * rendering. Removing them from the DOM would break the WebRTC stream.
       *
       * The <video> is positioned to fill the avatar pane once Simli connects.
       * The <audio> is always hidden — Simli routes audio through it.
       */}
      <video
        ref={simli.videoRef}
        autoPlay
        playsInline
        style={showSimliVideo ? S.simliVideoActive : S.simliVideoHidden}
      />
      <audio ref={simli.audioRef} autoPlay style={{ display: 'none' }} />

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div style={S.topBar} className="glass">
        <div style={S.topLeft}>
          <div style={S.dot} />
          <span style={S.brand}>AstraAgent</span>

          {config.persona_name && (
            <span style={S.badge}>✦ {config.persona_name}</span>
          )}
          {config.voice && (
            <span style={S.voiceBadge}>🔊 {config.voice}</span>
          )}

          {/* Simli status badge — visible only when the key is configured */}
          {simliEnabled && started && (
            simli.isLoading
              ? <span style={S.simliBadge}>
                  <span className="spin" style={S.simliBadgeSpin}>⟳</span>
                  Avatar connecting…
                </span>
              : simliConnected
                ? <span style={{ ...S.simliBadge, ...S.simliBadgeLive }}>
                    <span style={S.simliBadgeDot} /> Avatar live
                  </span>
                : simli.error
                  ? <span style={{ ...S.simliBadge, ...S.simliBadgeErr }}>⚠ Avatar offline</span>
                  : null
          )}
        </div>

        <div style={S.timer}>{fmt(elapsed)}</div>

        <div style={S.topRight}>
          {started && (
            <>
              <Btn active={muted} onClick={handleMute} title={muted ? 'Unmute' : 'Mute mic'}>
                {muted ? '🔇' : '🎙️'}
              </Btn>
              <Btn active={false} onClick={() => {}} title="Camera">
                {camOn ? '📷' : '📵'}
              </Btn>
            </>
          )}
          <button style={S.endBtn} onClick={handleEnd} disabled={ending}>
            {ending ? 'Ending…' : 'End Session'}
          </button>
        </div>
      </div>

      {/* ── Main stage ────────────────────────────────────────────────────── */}
      <div style={S.stage}>

        {/* ── LEFT: Avatar pane ─────────────────────────────────────────── */}
        <div style={S.avatarPane}>

          {/* Gemini model badge */}
          <div style={S.gemBadge}>
            <span style={S.gemDot} />
            Gemini 2.5 Flash · Native Audio
          </div>

          {/* Avatar display area */}
          <div style={S.avatarCenter}>

            {/*
             * GeminiAvatar (SVG fallback) — always rendered so state machine
             * stays active. Hidden behind Simli video when Simli is live.
             * Audio level continues to update even when hidden.
             */}
            <div style={{ display: showSimliVideo ? 'none' : 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <GeminiAvatar
                state={avatarState}
                audioLevel={audioLevel}
                name={config.persona_name || 'Agent'}
              />
            </div>

            {/*
             * Simli loading spinner — shown while WebRTC is being established.
             * Rendered between "Allow Mic & Begin" click and stream becoming live.
             */}
            {simliEnabled && simli.isLoading && (
              <div style={S.simliLoader}>
                <div className="spin" style={S.simliLoaderRing} />
                <span style={S.simliLoaderTxt}>Connecting avatar…</span>
              </div>
            )}

            {/* Active tool indicator */}
            {iv.activeTool && (
              <div style={S.toolPill}>
                <span style={S.toolSpin} className="spin">⟳</span>
                Using: {iv.activeTool.replace(/_/g, ' ')}
              </div>
            )}

            {/* WebSocket error display */}
            {iv.error && (
              <div style={S.errPill}>⚠ {iv.error}</div>
            )}
          </div>

          {/* ── Start overlay — shown before session begins ── */}
          {!started && (
            <div style={S.startOverlay}>
              {config.persona_name && (
                <div style={S.startPersonaLabel}>
                  <span style={S.startPersonaName}>{config.persona_name}</span>
                </div>
              )}
              <button style={S.startBtn} onClick={handleStart}>
                <span style={{ fontSize: 24 }}>🎙️</span>
                <span>Allow Mic & Begin</span>
                {audio.micError && <span style={S.micErr}>{audio.micError}</span>}
              </button>
              {simliEnabled && (
                <p style={S.startNote}>
                  🎭 Photorealistic avatar enabled via Simli.ai<br />
                  Microphone + camera access needed for live conversation.
                </p>
              )}
              {!simliEnabled && (
                <p style={S.startNote}>
                  Microphone access is needed for live conversation.<br />
                  Allow it in your browser when prompted.
                </p>
              )}
            </div>
          )}

          {/* ── Status strip (bottom of avatar pane) ── */}
          <div style={S.statusStrip}>
            <StatusDot state={avatarState} />
            {iv.wsState === 'connecting' && <span style={S.statusTxt}>Connecting to Gemini…</span>}
            {iv.wsState === 'ready'      && <span style={S.statusTxt}>Session ready</span>}
            {iv.wsState === 'active'     && <span style={S.statusTxt}>Live session</span>}
            {iv.wsState === 'ended'      && <span style={S.statusTxt}>Session ended</span>}
            {muted && <span style={S.mutedBadge}>🔇 Muted</span>}
          </div>
        </div>

        {/* ── RIGHT: Camera + Transcript + Tips ─────────────────────────── */}
        <div style={S.rightPane}>

          {/* User camera feed */}
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
              <video
                ref={camVideoRef}
                autoPlay
                muted
                playsInline
                style={{ ...S.video, transform: 'scaleX(-1)' }}
              />
              {!camOn && (
                <div style={S.noCamera}>
                  <span>📷</span>
                  <span style={S.noCamTxt}>Camera off</span>
                </div>
              )}
            </div>
          </div>

          {/* Live transcript */}
          <div
            style={{ ...S.transcriptCard, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            className="glass"
          >
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
                  <div
                    key={i}
                    style={{
                      ...S.transcriptEntry,
                      ...(t.role === 'model' ? S.modelEntry : S.userEntry),
                    }}
                  >
                    <span style={{
                      ...S.tRole,
                      color: t.role === 'model' ? '#93c5fd' : '#86efac',
                    }}>
                      {t.role === 'model'
                        ? (config.persona_name || 'Agent')
                        : (config.user_name || 'You')}
                    </span>
                    <span style={S.tText}>{t.text}</span>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Session tips */}
          <div style={S.tipsCard} className="glass">
            <div style={S.tipsTitle}>💡 Session Tips</div>
            <div style={S.tipsList}>
              {[
                'Speak naturally — Gemini understands context',
                'Interrupt anytime — barge-in is fully supported',
                'Look at the camera for best vision context',
                'Ask the agent to use a tool anytime',
              ].map((t, i) => (
                <div key={i} style={S.tip}>{t}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Small reusable components ─────────────────────────────────────────────────

function Btn({ active, onClick, title, children }) {
  return (
    <button
      style={{
        ...S.iconBtn,
        background: active ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)',
      }}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}

function StatusDot({ state }) {
  const color =
    state === 'speaking'  ? '#22c55e' :
    state === 'listening' ? '#4f7dff' :
    state === 'thinking'  ? '#a855f7' : '#475569'
  return (
    <div style={{ ...S.statusDot, background: color, boxShadow: `0 0 6px ${color}` }} />
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  // Layout
  root: {
    display: 'flex', flexDirection: 'column',
    height: '100vh', background: '#07070f', overflow: 'hidden',
  },

  // ── Simli media elements ──────────────────────────────────────────────────
  // Always mounted in the DOM (WebRTC ref requirement).
  // simliVideoHidden: positioned off-screen + invisible. Simli can still attach
  //   its WebRTC stream; we just don't show it yet.
  // simliVideoActive: shown inside the avatar pane via absolute positioning.
  simliVideoHidden: {
    position: 'fixed',
    top: 0, left: 0,
    width: 1, height: 1,
    opacity: 0,
    pointerEvents: 'none',
    zIndex: -1,
  },
  simliVideoActive: {
    position: 'absolute',
    top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 280, height: 280,
    borderRadius: '50%',              // circle crop — matches GeminiAvatar orb aesthetic
    objectFit: 'cover',
    border: '2px solid rgba(79,125,255,0.4)',
    boxShadow: '0 0 40px rgba(79,125,255,0.2), 0 0 0 1px rgba(255,255,255,0.06)',
    zIndex: 2,
  },

  // ── Simli loading spinner ──────────────────────────────────────────────────
  simliLoader: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    position: 'absolute',
    top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 3,
  },
  simliLoaderRing: {
    width: 40, height: 40,
    border: '3px solid rgba(79,125,255,0.15)',
    borderTop: '3px solid #4f7dff',
    borderRadius: '50%',
  },
  simliLoaderTxt: {
    fontSize: 12, color: 'rgba(147,197,253,0.7)',
  },

  // ── Top bar ───────────────────────────────────────────────────────────────
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '9px 18px', borderRadius: 0,
    borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
  },
  topLeft:  { display: 'flex', alignItems: 'center', gap: 10 },
  topRight: { display: 'flex', alignItems: 'center', gap: 8 },
  dot: {
    width: 7, height: 7, borderRadius: '50%',
    background: 'linear-gradient(135deg,#4f7dff,#a855f7)',
  },
  brand: { fontSize: 14, fontWeight: 700, color: '#eef0fa' },
  badge: {
    fontSize: 11, background: 'rgba(79,125,255,0.1)', padding: '2px 9px',
    borderRadius: 6, color: 'rgba(147,197,253,0.8)', border: '1px solid rgba(79,125,255,0.2)',
  },
  voiceBadge: {
    fontSize: 11, background: 'rgba(168,85,247,0.08)', padding: '2px 9px',
    borderRadius: 6, color: 'rgba(196,181,253,0.7)', border: '1px solid rgba(168,85,247,0.18)',
  },

  // Simli status badges
  simliBadge: {
    display: 'flex', alignItems: 'center', gap: 5,
    fontSize: 11, background: 'rgba(79,125,255,0.07)', padding: '2px 9px',
    borderRadius: 6, color: 'rgba(147,197,253,0.6)', border: '1px solid rgba(79,125,255,0.15)',
  },
  simliBadgeLive: {
    background: 'rgba(34,197,94,0.07)', color: 'rgba(134,239,172,0.8)',
    border: '1px solid rgba(34,197,94,0.2)',
  },
  simliBadgeErr: {
    background: 'rgba(239,68,68,0.07)', color: 'rgba(252,165,165,0.7)',
    border: '1px solid rgba(239,68,68,0.2)',
  },
  simliBadgeSpin:  { display: 'inline-block', fontSize: 12 },
  simliBadgeDot: {
    width: 6, height: 6, borderRadius: '50%', background: '#22c55e',
    display: 'inline-block', animation: 'dotPulse 1s ease-in-out infinite',
  },

  timer: {
    fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
    color: '#eef0fa', letterSpacing: '0.04em',
  },
  iconBtn: {
    width: 34, height: 34, borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)',
    color: '#eef0fa', cursor: 'pointer', fontSize: 15,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  endBtn: {
    padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
    color: '#fca5a5', cursor: 'pointer',
  },

  // ── Stage ─────────────────────────────────────────────────────────────────
  stage: { display: 'flex', flex: 1, overflow: 'hidden' },

  // ── Avatar pane (left) ────────────────────────────────────────────────────
  avatarPane: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',                               // anchors Simli video + overlays
    background: '#07070f',
    borderRight: '1px solid rgba(255,255,255,0.05)',
  },
  gemBadge: {
    position: 'absolute', top: 14, left: 14,
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 11, color: 'rgba(238,240,250,0.5)',
    background: 'rgba(255,255,255,0.04)', padding: '4px 10px',
    borderRadius: 20, border: '1px solid rgba(255,255,255,0.07)',
  },
  gemDot: {
    width: 6, height: 6, borderRadius: '50%', background: '#4f7dff',
    display: 'inline-block', animation: 'dotPulse 2s ease-in-out infinite',
  },
  avatarCenter: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
    position: 'relative',  // needed so simliVideoActive (absolute) positions inside
  },
  toolPill: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
    color: '#c4b5fd', background: 'rgba(168,85,247,0.1)',
    padding: '5px 12px', borderRadius: 20, border: '1px solid rgba(168,85,247,0.25)',
  },
  toolSpin:  { display: 'inline-block', fontSize: 14 },
  errPill: {
    fontSize: 12, color: '#fca5a5', background: 'rgba(239,68,68,0.08)',
    padding: '5px 12px', borderRadius: 20, border: '1px solid rgba(239,68,68,0.2)',
  },

  // Start overlay
  startOverlay: {
    position: 'absolute', inset: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 14, background: 'rgba(7,7,15,0.88)', backdropFilter: 'blur(10px)',
    zIndex: 10,
  },
  startPersonaLabel: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  startPersonaName: {
    fontSize: 13, fontWeight: 600, color: 'rgba(147,197,253,0.8)',
    background: 'rgba(79,125,255,0.1)', padding: '3px 12px', borderRadius: 20,
    border: '1px solid rgba(79,125,255,0.2)',
  },
  startBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    padding: '20px 40px', borderRadius: 16,
    background: 'linear-gradient(135deg,#4f7dff,#7c3aed)',
    border: 'none', color: 'white', fontSize: 15, fontWeight: 700, cursor: 'pointer',
  },
  micErr:    { fontSize: 11, color: '#fca5a5', marginTop: 4 },
  startNote: { fontSize: 12, color: 'rgba(238,240,250,0.35)', textAlign: 'center', lineHeight: 1.6 },

  // Status strip
  statusStrip: {
    position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'rgba(255,255,255,0.04)', padding: '5px 14px',
    borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)',
    zIndex: 1,
  },
  statusDot:  { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  statusTxt:  { fontSize: 11, color: 'rgba(238,240,250,0.45)' },
  mutedBadge: {
    fontSize: 11, color: '#fca5a5', background: 'rgba(239,68,68,0.1)',
    padding: '1px 8px', borderRadius: 20,
  },

  // ── Right pane ─────────────────────────────────────────────────────────────
  rightPane: {
    width: 300, display: 'flex', flexDirection: 'column', gap: 10, padding: 12,
    overflowY: 'auto', background: 'rgba(255,255,255,0.008)',
  },

  // Camera card
  camCard:    { borderRadius: 12, overflow: 'hidden', flexShrink: 0 },
  camHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '7px 11px', borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  camLabel: { fontSize: 11, fontWeight: 600, color: 'rgba(238,240,250,0.55)' },
  camLive: {
    display: 'flex', alignItems: 'center', gap: 5, fontSize: 10,
    fontWeight: 700, letterSpacing: '0.08em', color: '#86efac',
  },
  camLiveDot: {
    width: 6, height: 6, borderRadius: '50%', background: '#22c55e',
    display: 'inline-block', animation: 'dotPulse 1s ease-in-out infinite',
  },
  camBox:  { position: 'relative', aspectRatio: '4/3', background: '#050509' },
  video:   { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  noCamera: {
    position: 'absolute', inset: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 6, fontSize: 28,
  },
  noCamTxt: { fontSize: 11, color: 'rgba(238,240,250,0.3)' },

  // Transcript
  transcriptCard:  { borderRadius: 12 },
  transcriptHeader: {
    padding: '8px 12px', fontSize: 11, fontWeight: 600,
    color: 'rgba(238,240,250,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
  },
  transcriptCount: { fontSize: 10, color: 'rgba(238,240,250,0.3)' },
  transcriptBody: {
    padding: 10, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6,
  },
  transcriptEmpty: { fontSize: 12, color: 'rgba(238,240,250,0.25)', fontStyle: 'italic' },
  transcriptEntry: {
    display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px', borderRadius: 8,
  },
  modelEntry: { background: 'rgba(79,125,255,0.06)', borderLeft: '2px solid rgba(79,125,255,0.4)' },
  userEntry:  { background: 'rgba(34,197,94,0.05)',  borderLeft: '2px solid rgba(34,197,94,0.3)' },
  tRole: { fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' },
  tText: { fontSize: 12, color: 'rgba(238,240,250,0.8)', lineHeight: 1.55 },

  // Tips card
  tipsCard: { borderRadius: 12, padding: 12, flexShrink: 0 },
  tipsTitle: {
    fontSize: 11, fontWeight: 600, color: 'rgba(238,240,250,0.4)',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
  },
  tipsList: { display: 'flex', flexDirection: 'column', gap: 5 },
  tip: {
    fontSize: 11, color: 'rgba(238,240,250,0.5)', lineHeight: 1.5,
    paddingBottom: 5, borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
}
