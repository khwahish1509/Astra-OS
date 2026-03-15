/**
 * AgentRoom.jsx  (file kept as InterviewRoom.jsx for routing compatibility)
 * =========================================================================
 * The main live-agent session screen. Works with any persona — interview
 * coach, language tutor, sales coach, or any custom system prompt.
 *
 * Layout:
 *   LEFT  — Avatar pane:
 *             • Simli real-time talking avatar (when VITE_SIMLI_API_KEY is set)
 *             • GeminiAvatar FFT orb / Imagen 3 portrait (fallback)
 *   RIGHT — User camera + live transcript + tool activity indicator
 *   TOP   — Timer, persona info, controls
 *
 * Audio flow:
 *   Mic → AudioWorklet(capture) → WebSocket (binary PCM16)
 *   WebSocket binary → AudioWorklet(playback) → GainNode → AnalyserNode → Speaker
 *   WebSocket binary → Simli sendPcm24kHz → Simli WebRTC → avatar video (lip sync)
 *   AnalyserNode → GeminiAvatar (FFT at 60fps via requestAnimationFrame, fallback mode)
 *
 * Simli avatar:
 *   When VITE_SIMLI_API_KEY is configured, a photorealistic talking head
 *   is streamed in real-time via WebRTC.  Every PCM chunk from Gemini is
 *   forwarded to Simli (downsampled 24→16 kHz) to drive lip sync.
 *   Simli's own audio track is MUTED — we play audio via our own pipeline
 *   so the AnalyserNode, FFT rings, and interruption logic all still work.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import GeminiAvatar from './components/GeminiAvatar'
import BrainDashboard from './components/BrainDashboard'
import { useAudioPipeline } from './hooks/useAudioPipeline'
import { useInterviewSession } from './hooks/useInterviewSession'
import { useScreenShareCropper } from './hooks/useScreenShareCropper'
import { useSimliAvatar } from './hooks/useSimliAvatar'

// ── Simli config — set in .env.local ─────────────────────────────────────────
const SIMLI_API_KEY = import.meta.env.VITE_SIMLI_API_KEY || ''
const SIMLI_FACE_ID = import.meta.env.VITE_SIMLI_FACE_ID || 'tmp9i8bbq7c'
const SIMLI_ENABLED = Boolean(SIMLI_API_KEY)

// ── Component ─────────────────────────────────────────────────────────────────

export default function InterviewRoom({ session, onEnd }) {
  const { session_id, config, backendUrl, avatarImage } = session

  // ── UI state ─────────────────────────────────────────────────────────────
  const [elapsed, setElapsed] = useState(0)
  const [muted, setMuted] = useState(false)
  const [camOn, setCamOn] = useState(true)
  const [started, setStarted] = useState(false)
  const [ending, setEnding] = useState(false)

  const camVideoRef = useRef(null)   // user's camera <video> element
  const camStreamRef = useRef(null)   // user's MediaStream (for cleanup)

  // ── Simli cross-hook ref ──────────────────────────────────────────────────
  // sendPcm24kHz is safe to call even before Simli connects (it no-ops).
  // We store the Simli instance in a ref so onPcmReceived (defined before
  // the simli hook) can always access the latest instance.
  const simliRef = useRef({})

  // ── 1. Audio pipeline ─────────────────────────────────────────────────────
  const audio = useAudioPipeline({
    onPcmChunk: (buf) => iv.sendPcm(buf),
    onSpeechStart: () => iv.onSpeechStart?.(),
    onSpeechEnd: () => iv.onSpeechEnd?.(),
  })

  // ── 2. WebSocket session ──────────────────────────────────────────────────
  const iv = useInterviewSession({
    sessionId: session_id,
    wsBaseUrl: backendUrl,
    onPcmReceived: (buf) => {
      if (simli.isConnected) {
        // EXCLUSIVE PATH: Forward to Simli only.
        // This prevents overlapping audio nodes from affecting timing/speed.
        simliRef.current?.sendPcm24kHz?.(buf)
      } else {
        // FALLBACK PATH: Play Gemini audio through our local pipeline
        audio.playPcm(buf)
      }
    },
    onInterrupted: () => {
      audio.flushPcm()
      simliRef.current?.clearBuffer?.()
    },
    onResumeAudio: () => audio.resumePcm(),
  })

  // ── 3. Screen share smart cropper ────────────────────────────────────────
  const screenshare = useScreenShareCropper({
    sendFrame: iv.sendScreenFrame,
  })

  // Pause / resume camera frame loop when screen share state changes
  useEffect(() => {
    if (screenshare.isActive) {
      iv.pauseCameraFrames()
    } else {
      iv.resumeCameraFrames()
    }
  }, [screenshare.isActive, iv])

  // Wire user camera element into session hook (for JPEG frame capture)
  useEffect(() => {
    if (camVideoRef.current) iv.setVideoRef(camVideoRef.current)
  }, [iv])

  // ── 4. Simli real-time avatar ─────────────────────────────────────────────
  const simli = useSimliAvatar({
    apiKey: SIMLI_API_KEY,
    faceId: SIMLI_FACE_ID,
    onConnected: () => console.log('[Simli] ✅ Talking avatar connected'),
    onDisconnected: () => console.log('[Simli] Avatar disconnected'),
  })

  // Keep simliRef in sync so onPcmReceived always uses the latest instance
  simliRef.current = simli

  // ── Pre-warm Simli on mount ────────────────────────────────────────────────
  // Start the Simli connection immediately when the component mounts — NOT
  // when the user clicks "Begin".  Reason: livekit video takes ~10-25 seconds
  // to start streaming on first connect; pre-warming eliminates that wait so
  // the avatar is ready by the time the user starts talking.
  //
  // initialize() is one-shot (hasAttemptedRef guard), so calling it again in
  // handleStart() is a harmless no-op if it already ran here.
  useEffect(() => {
    if (SIMLI_ENABLED) {
      simli.initialize().catch(err =>
        console.warn('[Simli] Pre-warm failed (will retry on Begin):', err?.message)
      )
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Timer ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const fmt = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // ── Start session ─────────────────────────────────────────────────────────
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

    // 4. Initialize Simli avatar (if API key is configured)
    //    Non-fatal — if Simli fails, we fall back to GeminiAvatar orb
    if (SIMLI_ENABLED) {
      simli.initialize().catch(err =>
        console.warn('[Simli] Avatar init failed (using fallback):', err.message)
      )
    }

    setStarted(true)
  }, [audio, iv, simli])

  // ── Mute / unmute mic ─────────────────────────────────────────────────────
  const handleMute = () => {
    const next = !muted
    setMuted(next)
    audio.setMuted(next)
  }

  // ── Toggle screen share ───────────────────────────────────────────────────
  const handleScreenShare = useCallback(async () => {
    if (screenshare.isActive) {
      screenshare.stop()
    } else {
      await screenshare.start()
    }
  }, [screenshare])

  // ── End session ───────────────────────────────────────────────────────────
  const handleEnd = async () => {
    setEnding(true)
    screenshare.stop()
    audio.stop()
    iv.disconnect()
    await simli.close()   // close Simli v3 WebRTC + WebSocket (async in v3)
    camStreamRef.current?.getTracks().forEach(t => t.stop())
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
  const avatarState = !started ? 'idle' : iv.avatarState
  const showTranscript = iv.transcript.length > 0
  const simliActive = SIMLI_ENABLED && simli.isConnected
  const isAstraPersona = (config.persona_name || '').toLowerCase().includes('astra')

  // ── Sync local audio volume with Simli connection ──────────────
  // When Simli is connected, we use ITS synced audio stream and mute
  // the "fast" local playback, so movements match the voice perfectly.
  useEffect(() => {
    if (simliActive) {
      console.log('[Audio] Simli active — muting fast local playback for perfect sync')
      audio.setPlaybackMuted(true)
    } else {
      console.log('[Audio] Simli inactive — unmuting local playback')
      audio.setPlaybackMuted(false)
    }
  }, [simliActive, audio])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>

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
        </div>

        <div style={S.timer}>{fmt(elapsed)}</div>

        <div style={S.topRight}>
          {started && (
            <>
              <Btn active={muted} onClick={handleMute} title={muted ? 'Unmute' : 'Mute mic'}>
                {muted ? '🔇' : '🎙️'}
              </Btn>
              <Btn active={false} onClick={() => { }} title="Camera">
                {camOn ? '📷' : '📵'}
              </Btn>
            </>
          )}
          {started && (
            <button
              style={{
                ...S.screenShareBtn,
                ...(screenshare.isActive ? S.screenShareBtnActive : {}),
              }}
              onClick={handleScreenShare}
              title={screenshare.isActive
                ? 'Stop screen share — AI ambient awareness off'
                : 'Share screen — AI sees your full desktop at 1 FPS. Say "read this code" to trigger deep analysis.'}
            >
              {screenshare.isActive ? '🖥 Watching' : '🖥 Share Screen'}
            </button>
          )}
          <button style={S.endBtn} onClick={handleEnd} disabled={ending}>
            {ending ? 'Ending…' : 'End Session'}
          </button>
        </div>
      </div>

      {/* ── Screen share error toast ──────────────────────────────────────── */}
      {screenshare.error && (
        <div style={S.shareErrToast}>⚠ {screenshare.error}</div>
      )}

      {/* ── Ambient awareness badge ───────────────────────────────────────── */}
      {screenshare.isActive && (
        <div style={S.ambientBadge}>
          <span style={S.ambientDot} />
          Full desktop · 1 FPS · AI ambient awareness on
        </div>
      )}

      {/* ── Main stage ────────────────────────────────────────────────────── */}
      <div style={S.stage}>

        {/* ── LEFT: Avatar pane ─────────────────────────────────────────── */}
        <div style={S.avatarPane}>

          {/* ── Cinematic Ambient Backdrop Layer ── */}
          {avatarImage && (
            <div
              style={{
                ...S.backdropLayer,
                backgroundImage: `url(${avatarImage.startsWith('data:') ? avatarImage : `data:image/png;base64,${avatarImage}`})`
              }}
            />
          )}

          {/* Astra OS Brain Dashboard (top-right corner) */}
          <BrainDashboard isAstra={isAstraPersona} />

          {/* Simli Video Layer */}
          {/* Gemini model badge */}
          <div style={S.gemBadge}>
            <span style={S.gemDot} />
            Gemini 2.5 Flash · Native Audio
            {simliActive && (
              <span style={{ marginLeft: 6, color: 'rgba(134,239,172,0.8)' }}>
                · Simli Avatar
              </span>
            )}
            {!simliActive && avatarImage && (
              <span style={{ marginLeft: 6, color: 'rgba(134,239,172,0.7)' }}>
                · Imagen 3 Avatar
              </span>
            )}
          </div>

          {/* Avatar display area */}
          <div style={S.avatarCenter}>

            {/* ── Simli real-time talking avatar video ─────────────────────
             *  ALWAYS rendered (even when not connected) so videoRef/audioRef
             *  are attached to DOM elements when initialize() is called.
             *  Hidden via CSS when not yet connected.
             */}
            <div style={{
              ...S.simliWrapper,
              display: 'flex',
              // Keep video composited at all times — display:none blocks
              // requestVideoFrameCallback, causing a 60s deadlock where
              // LivekitTransport's 'start' event never fires.
              // Instead, hide visually via opacity+z-index.
              ...(SIMLI_ENABLED && !simliActive
                ? { position: 'absolute', opacity: 0, pointerEvents: 'none', zIndex: -1 }
                : {}),
            }}>
              <video
                ref={simli.videoRef}
                autoPlay
                playsInline
                style={{
                  ...S.simliVideo,
                  boxShadow: avatarState === 'speaking'
                    ? '0 0 40px rgba(79,125,255,0.5), 0 0 80px rgba(79,125,255,0.2)'
                    : avatarState === 'listening'
                      ? '0 0 30px rgba(79,125,255,0.3)'
                      : '0 0 20px rgba(79,125,255,0.15)',
                  border: avatarState === 'speaking'
                    ? '2px solid rgba(79,125,255,0.6)'
                    : '2px solid rgba(79,125,255,0.2)',
                  transition: 'box-shadow 0.3s ease, border-color 0.3s ease',
                }}
              />
              {/* Simli audio: unmuted when active so we hear the SYNCED stream.
               *  Local playback is muted via audio.setPlaybackMuted(true) to avoid echo. */}
              <audio ref={simli.audioRef} autoPlay playsInline muted={!simliActive} />

              {/* State indicator overlay */}
              <div style={S.simliStateRow}>
                <StatusDot state={avatarState} />
                <span style={{
                  ...S.simliStateTxt,
                  color: avatarState === 'speaking' ? '#86efac'
                    : avatarState === 'listening' ? '#93c5fd'
                      : avatarState === 'thinking' ? '#c4b5fd'
                        : '#64748b',
                }}>
                  {avatarState === 'speaking' ? '● Speaking'
                    : avatarState === 'listening' ? '◎ Listening'
                      : avatarState === 'thinking' ? '⟳ Thinking…'
                        : '○ Idle'}
                </span>
              </div>
            </div>

            {/* NOTE: NO duplicate ref elements here.
             *  The <video ref={simli.videoRef}> and <audio ref={simli.audioRef}> above
             *  (inside simliWrapper) are ALWAYS in the DOM (just CSS-hidden when not active).
             *  Adding a second element with the same ref would overwrite videoRef.current,
             *  causing Simli to attach its video track to a hidden/detached element — making
             *  the avatar invisible even after a successful WebRTC connection.
             */}

            {/* ── Simli loading indicator ──────────────────────────────── */}
            {SIMLI_ENABLED && simli.isLoading && !simli.isConnected && (
              <div style={S.simliLoading}>
                <div style={S.simliLoadSpinner} className="spin" />
                <span>Loading avatar…</span>
              </div>
            )}

            {/* ── GeminiAvatar fallback (Imagen 3 portrait or SVG orb) ── */}
            {!simliActive && (
              <GeminiAvatar
                state={avatarState}
                analyserNode={audio.analyserNode}
                name={config.persona_name || 'Agent'}
                base64Image={avatarImage || null}
                fullScreen={true}
              />
            )}

            {/* Simli avatar name row (only when Simli is active) */}
            {simliActive && (
              <div style={S.nameRow}>
                <span style={S.nameText}>{config.persona_name || 'Agent'}</span>
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

            {/* Simli error (non-fatal — falls back to GeminiAvatar) */}
            {SIMLI_ENABLED && simli.error && !simli.isConnected && !simli.isLoading && (
              <div style={S.simliErrPill}>
                Avatar unavailable — using fallback
              </div>
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
              <p style={S.startNote}>
                Microphone access is needed for live conversation.<br />
                Allow it in your browser when prompted.
              </p>
            </div>
          )}

          {/* ── Status strip (bottom of avatar pane) ── */}
          <div style={S.statusStrip}>
            <StatusDot state={avatarState} />
            {iv.wsState === 'connecting' && <span style={S.statusTxt}>Connecting to Gemini…</span>}
            {iv.wsState === 'ready' && <span style={S.statusTxt}>Session ready</span>}
            {iv.wsState === 'active' && <span style={S.statusTxt}>Live session</span>}
            {iv.wsState === 'ended' && <span style={S.statusTxt}>Session ended</span>}
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

          {/* Session tips — context-aware for Astra */}
          <div style={S.tipsCard} className="glass">
            <div style={S.tipsTitle}>{isAstraPersona ? '⚡ Voice Commands' : '💡 Session Tips'}</div>
            <div style={S.tipsList}>
              {(isAstraPersona ? [
                '"Brief me" — get a full status update',
                '"Check my emails" — scan recent inbox',
                '"How\'s my relationship with [name]?"',
                '"What\'s on my calendar today?"',
                '"Send an email to [name] about [topic]"',
                '"What commitments am I behind on?"',
              ] : [
                'Speak naturally — Gemini understands context',
                'Interrupt anytime — barge-in is fully supported',
                'Look at the camera for best vision context',
                'Ask the agent to use a tool anytime',
              ]).map((t, i) => (
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
    state === 'speaking' ? '#22c55e' :
      state === 'listening' ? '#4f7dff' :
        state === 'thinking' ? '#a855f7' : '#475569'
  return (
    <div style={{ ...S.statusDot, background: color, boxShadow: `0 0 6px ${color}` }} />
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  // Layout
  root: {
    width: '100dvw', height: '100dvh',
    display: 'flex', flexDirection: 'column',
    background: '#07070f', // Very dark base
    color: '#eef0fa', // Light text
    fontFamily: '"Inter", "Outfit", sans-serif',
    overflow: 'hidden',
  },

  // ── Top bar ───────────────────────────────────────────────────────────────
  topBar: {
    height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 32px',
    background: 'rgba(14, 14, 26, 0.4)', // Glassmorphic dark
    boxShadow: '0 4px 30px rgba(0,0,0,0.2)',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    zIndex: 1000,
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
  },
  topLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  topRight: { display: 'flex', alignItems: 'center', gap: 8 },
  dot: {
    width: 7, height: 7, borderRadius: '50%',
    background: 'linear-gradient(135deg,#4f7dff,#a855f7)',
  },
  brand: {
    fontSize: '18px', fontWeight: 700,
    letterSpacing: '-0.02em',
    color: '#eef0fa', // Light text
  },
  badge: {
    background: 'rgba(79,125,255,0.12)', // accent-soft
    color: '#4f7dff',
    padding: '4px 10px', borderRadius: '6px',
    fontSize: '12px', fontWeight: 600,
    border: '1px solid rgba(79,125,255,0.2)'
  },
  voiceBadge: {
    background: 'rgba(34,197,94,0.12)',
    color: '#22c55e',
    padding: '4px 10px', borderRadius: '6px',
    fontSize: '12px', fontWeight: 600,
    border: '1px solid rgba(34,197,94,0.2)'
  },
  timer: {
    fontSize: '24px', fontWeight: 600, fontFamily: 'monospace',
    color: '#eef0fa', // Light
  },
  iconBtn: {
    width: 34, height: 34, borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)',
    color: 'rgba(238,240,250,0.7)', cursor: 'pointer', fontSize: 15,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(255,255,255,0.03)',
    boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
    transition: 'all 0.2s',
  },
  endBtn: {
    padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
    color: '#ef4444', cursor: 'pointer',
    transition: 'all 0.2s hover:background:rgba(239,68,68,0.25)',
  },

  // ── Screen share button ────────────────────────────────────────────────────
  screenShareBtn: {
    padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    background: 'rgba(79,125,255,0.15)', border: '1px solid rgba(79,125,255,0.4)',
    color: '#4f7dff', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 5,
    transition: 'all 0.2s',
  },
  screenShareBtnActive: {
    background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)',
    color: '#22c55e',
    animation: 'dotPulse 1.5s ease-in-out infinite',
  },

  // ── Ambient badge ─────────────────────────────────────────────────────────
  ambientBadge: {
    position: 'fixed',
    top: 52, left: '50%', transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 11, fontWeight: 600,
    color: '#22c55e',
    background: 'rgba(34,197,94,0.15)',
    border: '1px solid rgba(34,197,94,0.4)',
    padding: '4px 14px', borderRadius: 20,
    pointerEvents: 'none',
    zIndex: 9999,
    whiteSpace: 'nowrap',
    letterSpacing: '0.03em',
    backdropFilter: 'blur(12px)',
  },
  ambientDot: {
    width: 6, height: 6, borderRadius: '50%',
    background: '#22c55e', display: 'inline-block',
    animation: 'dotPulse 1.5s ease-in-out infinite',
    flexShrink: 0,
    boxShadow: '0 0 8px #22c55e',
  },

  // ── Screen share error toast ───────────────────────────────────────────────
  shareErrToast: {
    position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
    color: '#ef4444', fontSize: 12, padding: '8px 16px', borderRadius: 10,
    zIndex: 9998,
    backdropFilter: 'blur(12px)',
  },

  // ── Stage ─────────────────────────────────────────────────────────────────
  stage: {
    flex: 1, position: 'relative',
    display: 'flex', gap: '32px', padding: '32px',
    background: 'transparent', // The root background handles the dark theme
    overflow: 'hidden',
  },

  // ── Avatar pane (left) ────────────────────────────────────────────────────
  avatarPane: {
    position: 'relative', flex: 1,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(14, 14, 26, 0.4)', // Dark glass
    borderRadius: '24px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.05)',
    backdropFilter: 'blur(24px)',
    overflow: 'hidden',
  },
  backdropLayer: {
    position: 'absolute', inset: 0,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'blur(80px) brightness(0.6) saturate(1.1)', // Adjusted for dark mode
    opacity: 0.5,
    zIndex: -1,
    transform: 'scale(1.2)',
  },
  gemBadge: {
    position: 'absolute', top: 14, left: 14,
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 11, color: 'rgba(238,240,250,0.7)',
    background: 'rgba(255,255,255,0.05)',
    padding: '4px 10px',
    borderRadius: 20, border: '1px solid rgba(255,255,255,0.07)',
    backdropFilter: 'blur(12px)',
  },
  gemDot: {
    width: 6, height: 6, borderRadius: '50%', background: '#4f7dff',
    display: 'inline-block', animation: 'dotPulse 2s ease-in-out infinite',
    boxShadow: '0 0 8px #4f7dff',
  },
  avatarCenter: {
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },

  // ── Simli video avatar ─────────────────────────────────────────────────────
  simliWrapper: {
    width: '100%', height: '100%',
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  simliVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    background: 'transparent',
    display: 'block',
  },
  simliStateRow: {
    display: 'flex', alignItems: 'center', gap: 6,
  },
  simliStateTxt: {
    fontSize: 12, letterSpacing: '0.03em',
    transition: 'color 0.3s ease',
  },
  simliLoading: {
    display: 'flex', alignItems: 'center', gap: 10,
    color: '#eef0fa', // Light text
    background: 'rgba(79,125,255,0.15)', // Glass dark blue
    border: '1px solid rgba(79,125,255,0.4)',
    padding: '10px 20px', borderRadius: 12,
  },
  simliLoadSpinner: {
    width: 16, height: 16, borderRadius: '50%',
    border: '2px solid rgba(79,125,255,0.4)',
    borderTopColor: '#4f7dff',
  },
  simliErrPill: {
    fontSize: 11, color: '#f59e0b',
    background: 'rgba(245,158,11,0.15)',
    border: '1px solid rgba(245,158,11,0.4)',
    padding: '4px 12px', borderRadius: 20,
  },

  // Name row below Simli video
  nameRow: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
    marginTop: -4,
  },
  nameText: {
    color: '#eef0fa', fontSize: 16, fontWeight: 700, letterSpacing: '-0.2px', // Light text
  },

  toolPill: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
    color: '#a855f7', background: 'rgba(168,85,247,0.15)', // Purple glow
    padding: '5px 12px', borderRadius: 20, border: '1px solid rgba(168,85,247,0.4)',
  },
  toolSpin: { display: 'inline-block', fontSize: 14 },
  errPill: {
    fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.15)',
    padding: '5px 12px', borderRadius: 20, border: '1px solid rgba(239,68,68,0.4)',
  },

  // Start overlay
  startOverlay: {
    position: 'absolute', inset: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 14, background: 'rgba(14, 14, 26, 0.7)', backdropFilter: 'blur(16px)', // Dark glass
    zIndex: 10,
  },
  startPersonaLabel: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  startPersonaName: {
    fontSize: 13, fontWeight: 600, color: '#4f7dff',
    background: 'rgba(79,125,255,0.15)',
    padding: '3px 12px', borderRadius: 20,
    border: '1px solid rgba(79,125,255,0.4)',
  },
  startBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    padding: '18px 40px', borderRadius: 14, cursor: 'pointer', fontSize: 15, fontWeight: 600,
    background: 'linear-gradient(135deg, rgba(79,125,255,0.2), rgba(168,85,247,0.2))',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#eef0fa', // Light text
    transition: 'all 0.2s',
    boxShadow: '0 4px 20px rgba(79,125,255,0.15)',
  },
  micErr: { fontSize: 11, color: '#ef4444', marginTop: 4 }, // Red
  startNote: {
    fontSize: 11, color: 'rgba(238,240,250,0.5)', textAlign: 'center', lineHeight: 1.6, // Dim text
  },

  // Status strip at bottom of avatar pane
  statusStrip: {
    position: 'absolute', bottom: 16,
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'rgba(0,0,0,0.2)', padding: '6px 12px', borderRadius: '16px', backdropFilter: 'blur(8px)',
  },
  statusDot: {
    width: 8, height: 8, borderRadius: '50%',
    transition: 'background 0.3s ease, box-shadow 0.3s ease',
  },
  statusTxt: { fontSize: 12, color: 'rgba(238,240,250,0.7)' },
  mutedBadge: {
    fontSize: 11, color: '#ef4444', background: 'rgba(239,68,68,0.15)',
    padding: '2px 8px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)',
  },

  // ── Right pane ────────────────────────────────────────────────────────────
  rightPane: {
    width: 320, display: 'flex', flexDirection: 'column',
    gap: 12, overflow: 'hidden', zIndex: 10,
    pointerEvents: 'auto',
  },
  camCard: {
    borderRadius: 16, overflow: 'hidden', flexShrink: 0,
    background: 'rgba(14, 14, 26, 0.4)', backdropFilter: 'blur(24px)', // Dark glass
    border: '1px solid rgba(255,255,255,0.05)', pointerEvents: 'auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  },
  camHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  camLabel: { fontSize: 12, fontWeight: 600, color: '#eef0fa' },
  camLive: {
    display: 'flex', alignItems: 'center', gap: 5,
    fontSize: 11, color: '#22c55e', fontWeight: 600,
  },
  camLiveDot: {
    width: 6, height: 6, borderRadius: '50%', background: '#22c55e',
    display: 'inline-block', animation: 'dotPulse 1.5s ease-in-out infinite',
    boxShadow: '0 0 6px #22c55e',
  },
  camBox: { position: 'relative', height: 200, background: '#07070f' },
  video: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  noCamera: {
    position: 'absolute', inset: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 8, fontSize: 28, color: 'rgba(238,240,250,0.3)',
  },
  noCamTxt: { fontSize: 12 },

  // Transcript
  transcriptCard: {
    borderRadius: 16, overflow: 'hidden',
    background: 'rgba(14, 14, 26, 0.4)', backdropFilter: 'blur(24px)',
    border: '1px solid rgba(255,255,255,0.05)', flex: 1, display: 'flex', flexDirection: 'column',
    pointerEvents: 'auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  },
  transcriptHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#eef0fa',
    borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0,
  },
  transcriptCount: {
    fontSize: 10, color: 'rgba(238,240,250,0.7)',
    background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 10,
  },
  transcriptBody: { overflowY: 'auto', flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 },
  transcriptEmpty: { fontSize: 11, color: 'rgba(238,240,250,0.3)', textAlign: 'center', padding: '20px 0' },
  transcriptEntry: { display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px', borderRadius: 10 },
  modelEntry: { background: 'rgba(79,125,255,0.1)', border: '1px solid rgba(79,125,255,0.2)' },
  userEntry: { background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' },
  tRole: { fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' },
  tText: { fontSize: 13, color: '#eef0fa', lineHeight: 1.5 },

  // Tips
  tipsCard: {
    borderRadius: 16, padding: '12px 14px', flexShrink: 0,
    background: 'rgba(14, 14, 26, 0.4)', backdropFilter: 'blur(24px)',
    border: '1px solid rgba(255,255,255,0.05)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    pointerEvents: 'auto',
  },
  tipsTitle: { fontSize: 11, fontWeight: 700, color: 'rgba(238,240,250,0.7)', marginBottom: 10, letterSpacing: '0.04em' },
  tipsList: { display: 'flex', flexDirection: 'column', gap: 6 },
  tip: { fontSize: 11, color: 'rgba(238,240,250,0.5)', lineHeight: 1.4 },
}
