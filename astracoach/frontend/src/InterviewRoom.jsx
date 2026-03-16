/**
 * InterviewRoom.jsx — Astra OS Hub-and-Spoke Layout
 * ===================================================
 * The main live-agent session screen with a professional OS-like layout:
 *
 *   ┌──────────┬──────────────────────────┬─────────────┐
 *   │ Sidebar  │   Main Content Area      │  AI Panel   │
 *   │ Nav      │   (Dashboard/Widgets)    │  (Avatar +  │
 *   │ (72px    │                          │  Transcript │
 *   │ icons)   │                          │  + Actions) │
 *   ├──────────┴──────────────────────────┴─────────────┤
 *   │  🎤 Global Voice Bar (always visible, 48px)        │
 *   └────────────────────────────────────────────────────┘
 *
 * Audio flow preserved from original:
 *   Mic → AudioWorklet(capture) → WebSocket (binary PCM16)
 *   WebSocket → AudioWorklet(playback) → GainNode → AnalyserNode → Speaker
 *   AnalyserNode → GeminiAvatar (FFT at 60fps)
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import GeminiAvatar from './components/GeminiAvatar'
import DashboardView from './components/DashboardView'
import { useAudioPipeline } from './hooks/useAudioPipeline'
import { useInterviewSession } from './hooks/useInterviewSession'
import { useScreenShareCropper } from './hooks/useScreenShareCropper'
import { useSimliAvatar } from './hooks/useSimliAvatar'
import { useTheme, ThemeToggle } from './ThemeContext'

const SIMLI_API_KEY = import.meta.env.VITE_SIMLI_API_KEY || ''
const SIMLI_FACE_ID = import.meta.env.VITE_SIMLI_FACE_ID || 'tmp9i8bbq7c'
const SIMLI_ENABLED = Boolean(SIMLI_API_KEY)

// ── Sidebar navigation items ────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
  { id: 'email', icon: 'email', label: 'Email' },
  { id: 'crm', icon: 'crm', label: 'CRM' },
  { id: 'tasks', icon: 'tasks', label: 'Tasks' },
  { id: 'calendar', icon: 'calendar', label: 'Calendar' },
  { id: 'brain', icon: 'brain', label: 'Brain' },
]

export default function InterviewRoom({ session, onEnd }) {
  const { session_id, config, backendUrl, avatarImage, demoMode } = session
  const { theme: T } = useTheme()
  const S = getStyles(T)

  // ── UI state ────────────────────────────────────────────────────────────
  const [elapsed, setElapsed] = useState(0)
  const [muted, setMuted] = useState(false)
  const [camOn, setCamOn] = useState(true)
  const [started, setStarted] = useState(!!demoMode)
  const [ending, setEnding] = useState(false)
  const [activeNav, setActiveNav] = useState('dashboard')
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false)
  const [showCam, setShowCam] = useState(true)
  const [lastCommand, setLastCommand] = useState(null)

  const camVideoRef = useRef(null)
  const camStreamRef = useRef(null)
  const simliRef = useRef({})
  const transcriptEndRef = useRef(null)

  // ── 1. Audio pipeline ───────────────────────────────────────────────────
  const audio = useAudioPipeline({
    onPcmChunk: (buf) => iv.sendPcm(buf),
    onSpeechStart: () => iv.onSpeechStart?.(),
    onSpeechEnd: () => iv.onSpeechEnd?.(),
  })

  // ── 2. WebSocket session ────────────────────────────────────────────────
  const iv = useInterviewSession({
    sessionId: session_id,
    wsBaseUrl: backendUrl,
    onPcmReceived: (buf) => {
      if (simli.isConnected) {
        simliRef.current?.sendPcm24kHz?.(buf)
      } else {
        audio.playPcm(buf)
      }
    },
    onInterrupted: () => {
      audio.flushPcm()
      simliRef.current?.clearBuffer?.()
    },
    onResumeAudio: () => audio.resumePcm(),
  })

  // ── 3. Screen share ─────────────────────────────────────────────────────
  const screenshare = useScreenShareCropper({ sendFrame: iv.sendScreenFrame })

  useEffect(() => {
    if (screenshare.isActive) iv.pauseCameraFrames()
    else iv.resumeCameraFrames()
  }, [screenshare.isActive, iv])

  useEffect(() => {
    if (camVideoRef.current) iv.setVideoRef(camVideoRef.current)
  }, [iv])

  // ── 4. Simli avatar ─────────────────────────────────────────────────────
  const simli = useSimliAvatar({
    apiKey: SIMLI_API_KEY,
    faceId: SIMLI_FACE_ID,
    onConnected: () => console.log('[Simli] Connected'),
    onDisconnected: () => console.log('[Simli] Disconnected'),
  })
  simliRef.current = simli

  useEffect(() => {
    if (SIMLI_ENABLED) {
      simli.initialize().catch(() => { })
    }
  }, [])

  // ── Timer ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const fmt = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // ── Auto-scroll transcript ──────────────────────────────────────────────
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [iv.transcript.length])

  // ── Voice command visual feedback ────────────────────────────────────────
  useEffect(() => {
    const lastEntry = iv.transcript[iv.transcript.length - 1]
    if (lastEntry && lastEntry.role === 'user') {
      setLastCommand(lastEntry.text)
      const timer = setTimeout(() => setLastCommand(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [iv.transcript.length])

  // ── Start session ───────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (demoMode) { setStarted(true); return }
    await audio.start()
    await audio.resume()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      camStreamRef.current = stream
      if (camVideoRef.current) camVideoRef.current.srcObject = stream
    } catch { setCamOn(false) }
    iv.connect()
    if (SIMLI_ENABLED) {
      simli.initialize().catch(() => { })
    }
    setStarted(true)
  }, [audio, iv, simli, demoMode])

  const handleMute = () => {
    const next = !muted
    setMuted(next)
    audio.setMuted(next)
  }

  const handleScreenShare = useCallback(async () => {
    if (screenshare.isActive) screenshare.stop()
    else await screenshare.start()
  }, [screenshare])

  const handleEnd = async () => {
    setEnding(true)
    if (demoMode) { onEnd(); return }
    screenshare.stop()
    audio.stop()
    iv.disconnect()
    await simli.close()
    camStreamRef.current?.getTracks().forEach(t => t.stop())
    try {
      await fetch(`${backendUrl}/api/session/${session_id}/end`, { method: 'POST' })
    } catch { }
    onEnd()
  }

  useEffect(() => { audio.setMuted(muted) }, [muted, audio])

  const avatarState = !started ? 'idle' : iv.avatarState
  const showTranscript = iv.transcript.length > 0
  const simliActive = SIMLI_ENABLED && simli.isConnected

  useEffect(() => {
    audio.setPlaybackMuted(simliActive)
  }, [simliActive, audio])

  // ── State color helper ──────────────────────────────────────────────────
  const stateColor = avatarState === 'speaking' ? T.success
    : avatarState === 'listening' ? T.accent
      : avatarState === 'thinking' ? T.accentPurple : '#475569'

  return (
    <div style={S.root}>

      {/* ═══════════════════════════════════════════════════════════════════
          SIDEBAR NAVIGATION
          ═══════════════════════════════════════════════════════════════════ */}
      <div style={S.sidebar}>
        <div style={S.sidebarTop}>
          <div style={S.sidebarLogo}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="5" />
              <circle cx="12" cy="12" r="1" fill="currentColor" />
            </svg>
          </div>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              style={{
                ...S.navBtn,
                ...(activeNav === item.id ? S.navBtnActive : {}),
              }}
              onClick={() => setActiveNav(item.id)}
              title={item.label}
            >
              <div style={S.navIcon}>
                {item.id === 'dashboard' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1"/>
                    <rect x="14" y="3" width="7" height="7" rx="1"/>
                    <rect x="3" y="14" width="7" height="7" rx="1"/>
                    <rect x="14" y="14" width="7" height="7" rx="1"/>
                  </svg>
                )}
                {item.id === 'email' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2"/>
                    <path d="M2 6l10 8 10-8"/>
                  </svg>
                )}
                {item.id === 'crm' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                )}
                {item.id === 'tasks' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 11 12 14 22 4"/>
                    <path d="M21 12a9 9 0 1 1-9-9m9 9H3a9 9 0 0 0 9-9m0 0V3"/>
                  </svg>
                )}
                {item.id === 'calendar' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                )}
                {item.id === 'brain' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.59 4.59A2 2 0 1 1 7.59 8.59M3 12a9 9 0 0 1 9-9m0 0a9 9 0 0 1 9 9m0 0a9 9 0 0 1-9 9m0 0a9 9 0 0 1-9-9m9 0a3 3 0 0 1 3 3m-3-3a3 3 0 0 0-3 3"/>
                    <circle cx="12" cy="12" r="1" fill="currentColor"/>
                  </svg>
                )}
              </div>
              <span style={S.navLabel}>{item.label}</span>
            </button>
          ))}
        </div>
        <div style={S.sidebarBottom}>
          <button style={S.navBtn} onClick={() => setShowCam(!showCam)} title="Toggle camera">
            <div style={S.navIcon}>
              {showCam ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 7l-7 5 7 5V7z"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23"/>
                  <path d="M21 9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10"/>
                </svg>
              )}
            </div>
            <span style={S.navLabel}>Camera</span>
          </button>
          <button style={{ ...S.navBtn, ...S.navBtnEnd }} onClick={handleEnd} title="End session">
            <div style={S.navIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
            </div>
            <span style={S.navLabel}>End</span>
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          MAIN CONTENT AREA
          ═══════════════════════════════════════════════════════════════════ */}
      <div style={S.mainArea}>

        {/* Top header bar */}
        <div style={S.topBar}>
          <div style={S.topBarLeft}>
            <div style={{ ...S.statusIndicator, background: stateColor, boxShadow: `0 0 8px ${stateColor}` }} />
            <span style={S.topBarTitle}>Astra</span>
          </div>
          <div style={S.topBarCenter}>
            {lastCommand && (
              <div style={{
                ...S.commandPill,
                animation: 'commandFadeOut 4s ease-out forwards',
              }}>
                <span style={{ fontSize: 11, fontWeight: 600 }}>🎤 You</span>
                <span style={{ fontSize: 12, marginLeft: 6 }}>{lastCommand.substring(0, 40)}{lastCommand.length > 40 ? '...' : ''}</span>
              </div>
            )}
            {!lastCommand && iv.activeTool && (
              <div style={S.toolBadge}>
                <span className="spin" style={S.toolSpinIcon}>&#8635;</span>
                {iv.activeTool.replace(/_/g, ' ')}
              </div>
            )}
          </div>
          <div style={S.topBarRight}>
            {screenshare.isActive && (
              <span style={S.screenShareBadge}>
                <span style={S.liveDot} />Sharing
              </span>
            )}
            <ThemeToggle size={16} style={{ color: T.textSecondary }} />
            <button
              style={{ ...S.headerBtn, ...(screenshare.isActive ? S.headerBtnActive : {}) }}
              onClick={handleScreenShare}
              title="Share screen"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                <path d="M8 7H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-3m-7 0h6m0 0V7a2 2 0 0 0-2-2m-2 2h2V7a2 2 0 0 1 2 2m-4 0h4"/>
              </svg>
              {screenshare.isActive ? 'Stop' : 'Share'}
            </button>
            <button
              style={{ ...S.headerBtn, ...(muted ? S.headerBtnDanger : {}) }}
              onClick={handleMute}
            >
              {muted ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                  <path d="M1 1l22 22M3 10v4a9 9 0 0 0 18 0v-4" opacity="0.5"/>
                  <path d="M9 9v2a3 3 0 0 0 6 0V9"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                </svg>
              )}
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              style={S.aiPanelToggle}
              onClick={() => setAiPanelCollapsed(!aiPanelCollapsed)}
              title={aiPanelCollapsed ? 'Show AI panel' : 'Hide AI panel'}
            >
              {aiPanelCollapsed ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Content + AI Panel row */}
        <div style={S.contentRow}>

          {/* Main content view */}
          <div style={S.contentPane}>
            {/* Start overlay — shown before session begins */}
            {!started && (
              <div style={S.startOverlay}>
                <div style={S.startContent}>
                  <div style={S.startOrb}>
                    <div style={S.startOrbRing} />
                    <GeminiAvatar
                      state="idle"
                      analyserNode={null}
                      name="Astra"
                      base64Image={avatarImage || null}
                    />
                  </div>
                  <h2 style={S.startTitle}>Astra is ready</h2>
                  <p style={S.startDesc}>
                    Your AI Chief of Staff is standing by. Click to begin your voice session — try saying 'Brief me' or 'Check my emails'.
                  </p>
                  <button style={{ ...S.startBtn, ...S.breatheBtn }} onClick={handleStart}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                    </svg>
                    Start Session
                  </button>
                </div>
              </div>
            )}

            {/* Dashboard / Active view */}
            {started && (
              <DashboardView
                activeView={activeNav}
                backendUrl={backendUrl}
                transcript={iv.transcript}
                config={config}
              />
            )}
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              AI PANEL (Right side — cinematic avatar + PIP camera + transcript)
              ═══════════════════════════════════════════════════════════════ */}
          {!aiPanelCollapsed && (
            <div style={S.aiPanel}>

              {/* ── Avatar hero area (fills most of the panel) ── */}
              <div style={S.avatarHero}>
                {/* Cinematic dark backdrop with blurred avatar */}
                {avatarImage && (
                  <div style={{
                    ...S.avatarBackdrop,
                    backgroundImage: `url(${avatarImage.startsWith('data:') ? avatarImage : `data:image/png;base64,${avatarImage}`})`,
                  }} />
                )}

                {/* Simli video layer (always mounted, hidden when not connected) */}
                <div style={{
                  ...S.simliLayer,
                  ...(SIMLI_ENABLED && !simliActive
                    ? { position: 'absolute', opacity: 0, pointerEvents: 'none', zIndex: -1 }
                    : {}),
                }}>
                  <video ref={simli.videoRef} autoPlay playsInline style={S.simliVideo} />
                  <audio ref={simli.audioRef} autoPlay playsInline muted={!simliActive} />
                </div>

                {SIMLI_ENABLED && simli.isLoading && !simli.isConnected && (
                  <div style={S.simliLoading}>
                    <span style={S.spinner} className="spin" /> Loading avatar...
                  </div>
                )}

                {/* GeminiAvatar (fullscreen fills the hero area) */}
                {!simliActive && (
                  <div style={S.avatarFill}>
                    <GeminiAvatar
                      state={avatarState}
                      analyserNode={audio.analyserNode}
                      name={config.persona_name || 'Astra'}
                      base64Image={avatarImage || null}
                      fullScreen={true}
                    />
                  </div>
                )}

                {/* Live Caption Overlay */}
                {iv.transcript.length > 0 && iv.transcript[iv.transcript.length - 1]?.role === 'model' && (
                  <div style={{
                    ...S.captionBar,
                    animation: 'fadeInUp 0.3s ease-out',
                  }}>
                    <div style={S.captionText}>
                      {iv.transcript[iv.transcript.length - 1].text}
                    </div>
                  </div>
                )}

                {/* PIP Camera (floating overlay, bottom-right of avatar) */}
                {showCam && (
                  <div style={S.pipCam}>
                    <video ref={camVideoRef} autoPlay muted playsInline style={S.pipCamVideo} />
                    {!camOn && <div style={S.pipCamOff}>Camera off</div>}
                    <div style={S.pipCamLabel}>
                      <span style={S.pipCamDot} />You
                    </div>
                  </div>
                )}
                {!showCam && (
                  <video ref={camVideoRef} autoPlay muted playsInline style={{ display: 'none' }} />
                )}

                {/* State bar at bottom of avatar area */}
                <div style={S.avatarBottomBar}>
                  <div style={S.avatarStateRow}>
                    <div style={{
                      ...S.avatarStateDot,
                      background: stateColor,
                      boxShadow: `0 0 8px ${stateColor}`,
                      animation: avatarState !== 'idle' ? 'dotPulse 1.5s ease-in-out infinite' : 'none',
                    }} />
                    <span style={S.avatarName}>{config.persona_name || 'Astra'}</span>
                    <span style={{ ...S.avatarStateLabel, color: stateColor }}>
                      {avatarState === 'speaking' ? 'Speaking'
                        : avatarState === 'listening' ? 'Listening'
                          : avatarState === 'thinking' ? 'Thinking...'
                            : 'Ready'}
                    </span>
                  </div>
                  {iv.activeTool && (
                    <div style={S.avatarToolPill}>
                      <span className="spin" style={{ display: 'inline-block', fontSize: 11 }}>&#8635;</span>
                      {iv.activeTool.replace(/_/g, ' ')}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Transcript (compact, bottom section) ── */}
              <div style={S.transcriptSection}>
                <div style={S.transcriptHeader}>
                  <span style={S.transcriptTitle}>Live Transcript</span>
                  {showTranscript && (
                    <span style={S.transcriptCount}>{iv.transcript.length}</span>
                  )}
                </div>
                <div style={S.transcriptBody}>
                  {!showTranscript ? (
                    <div style={S.transcriptEmpty}>
                      {started ? 'Start speaking to Astra...' : 'Transcript appears here...'}
                    </div>
                  ) : (
                    iv.transcript.map((t, i) => (
                      <div key={i} style={{
                        ...S.transcriptEntry,
                        ...(t.role === 'model' ? S.modelEntry : S.userEntry),
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <div style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: t.role === 'model' ? T.modelColor : T.userColor,
                            flexShrink: 0,
                          }} />
                          <span style={{
                            ...S.tRole,
                            color: t.role === 'model' ? T.modelColor : T.userColor,
                          }}>
                            {t.role === 'model' ? 'ASTRA — AI CHIEF OF STAFF' : 'YOU'}
                          </span>
                        </div>
                        <span style={S.tText}>{t.text}</span>
                      </div>
                    ))
                  )}
                  <div ref={transcriptEndRef} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            GLOBAL VOICE BAR (bottom)
            ═══════════════════════════════════════════════════════════════════ */}
        <div style={S.voiceBar}>
          <div style={S.voiceBarLeft}>
            <div style={{ ...S.voiceBarDot, background: stateColor, boxShadow: `0 0 6px ${stateColor}` }} />
            <span style={S.voiceBarStatus}>
              {!started ? 'Not connected'
                : muted ? 'Muted'
                  : avatarState === 'listening' ? 'Listening'
                    : avatarState === 'speaking' ? 'Speaking'
                      : avatarState === 'thinking' ? 'Thinking'
                        : 'Ready'}
            </span>
          </div>
          <div style={S.voiceBarCenter}>
            {iv.error && <span style={S.voiceBarError}>&#9888; {iv.error}</span>}
            {screenshare.error && <span style={S.voiceBarError}>&#9888; {screenshare.error}</span>}
          </div>
          <div style={S.voiceBarRight}>
            <span style={S.voiceBarHint}>{fmt(elapsed)}</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes dotPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes commandPulse {
          0%, 100% {
            box-shadow: 0 0 12px rgba(59, 130, 246, 0.4), inset 0 0 20px rgba(59, 130, 246, 0.1);
          }
          50% {
            box-shadow: 0 0 20px rgba(59, 130, 246, 0.6), inset 0 0 30px rgba(59, 130, 246, 0.15);
          }
        }
        @keyframes commandFadeOut {
          0% {
            opacity: 1;
            transform: scale(1);
          }
          90% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: scale(0.95);
          }
        }
        @keyframes breathe {
          0%, 100% {
            box-shadow: 0 8px 32px rgba(59, 130, 246, 0.4);
            transform: scale(1);
          }
          50% {
            box-shadow: 0 12px 48px rgba(59, 130, 246, 0.6);
            transform: scale(1.02);
          }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const getStyles = (t) => ({
  root: {
    width: '100dvw', height: '100dvh',
    display: 'flex',
    background: t.bg,
    color: t.text,
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    overflow: 'hidden',
  },

  // ── Sidebar ─────────────────────────────────────────────────────────────
  sidebar: {
    width: 72, flexShrink: 0,
    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    background: t.bgGlass,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderRight: `1px solid ${t.border}`,
    padding: '16px 0',
    zIndex: 100,
  },
  sidebarTop: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
  },
  sidebarBottom: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
  },
  sidebarLogo: {
    width: 44, height: 44, borderRadius: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: t.gradientPrimary,
    marginBottom: 8,
    color: 'white',
  },
  navBtn: {
    width: 56, padding: '8px 0',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    background: 'none', border: 'none',
    borderRadius: 10, cursor: 'pointer',
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
    color: t.textDim,
    borderLeft: '3px solid transparent',
  },
  navBtnActive: {
    background: t.navActive,
    borderLeft: `3px solid ${t.accentCyan}`,
    color: t.accentCyan,
  },
  navBtnEnd: {
    color: t.danger,
  },
  navIcon: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1,
    color: 'inherit',
  },
  navLabel: { fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', color: 'inherit' },

  // ── Main area ───────────────────────────────────────────────────────────
  mainArea: {
    flex: 1, display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },

  // ── Top bar ─────────────────────────────────────────────────────────────
  topBar: {
    height: 52, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 20px',
    background: t.bgGlass,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderBottom: `1px solid ${t.border}`,
  },
  topBarLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  topBarCenter: { display: 'flex', alignItems: 'center' },
  topBarRight: { display: 'flex', alignItems: 'center', gap: 10 },
  statusIndicator: {
    width: 8, height: 8, borderRadius: '50%',
    transition: 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  topBarTitle: { fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' },
  topBarBadge: {
    fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
    background: t.bgSurface,
    border: `1px solid ${t.border}`,
    color: t.textSecondary,
  },
  toolBadge: {
    display: 'flex', alignItems: 'center', gap: 5,
    fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
    background: 'rgba(168,85,247,0.12)',
    border: '1px solid rgba(168,85,247,0.3)',
    color: '#c4b5fd',
  },
  toolSpinIcon: { display: 'inline-block', fontSize: 12 },
  commandPill: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 14px', borderRadius: 20,
    background: 'rgba(59, 130, 246, 0.12)',
    border: '1px solid rgba(59, 130, 246, 0.3)',
    color: '#60a5fa',
    fontSize: 12, fontWeight: 600,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    animation: 'commandPulse 2s ease-in-out infinite',
    maxWidth: 280,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  timer: {
    fontSize: 18, fontWeight: 600, fontFamily: '"SF Mono", "Fira Code", monospace',
    color: t.textSecondary,
    fontVariantNumeric: 'tabular-nums',
  },
  headerBtn: {
    padding: '6px 14px', borderRadius: 8,
    background: t.bgSurface,
    border: `1px solid ${t.border}`,
    color: t.textSecondary,
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  headerBtnActive: {
    background: t.successSoft,
    border: `1px solid rgba(34,197,94,0.3)`,
    color: t.success,
  },
  headerBtnDanger: {
    background: t.dangerSoft,
    border: `1px solid rgba(239,68,68,0.3)`,
    color: t.danger,
  },
  screenShareBadge: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 12, fontWeight: 600,
    color: t.success,
  },
  liveDot: {
    width: 6, height: 6, borderRadius: '50%',
    background: t.success, display: 'inline-block',
    animation: 'dotPulse 1.5s ease-in-out infinite',
    boxShadow: `0 0 6px ${t.success}`,
  },
  aiPanelToggle: {
    width: 32, height: 32, borderRadius: 8,
    background: t.bgSurface,
    border: `1px solid ${t.border}`,
    color: t.textSecondary,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
  },

  // ── Content row ─────────────────────────────────────────────────────────
  contentRow: {
    flex: 1, display: 'flex', overflow: 'hidden',
  },

  // ── Main content pane ───────────────────────────────────────────────────
  contentPane: {
    flex: 1, overflow: 'auto', position: 'relative',
    padding: 0,
  },

  // ── Start overlay ───────────────────────────────────────────────────────
  startOverlay: {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: t.bgOverlay,
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    zIndex: 50,
  },
  startContent: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
    maxWidth: 440,
  },
  startOrb: {
    width: 280, height: 280,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  startOrbRing: {
    position: 'absolute', inset: 0,
    borderRadius: '50%',
    border: `2px solid ${t.borderAccent}`,
    animation: 'dotPulse 3s ease-in-out infinite',
  },
  startTitle: {
    fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em',
    textAlign: 'center',
  },
  startDesc: {
    fontSize: 14, color: t.textSecondary, textAlign: 'center', lineHeight: 1.6,
  },
  startBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
    padding: '16px 40px', borderRadius: 12,
    background: t.gradientPrimary,
    border: 'none', color: 'white', fontSize: 15, fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
    boxShadow: `0 8px 32px ${t.accentGlow}`,
  },
  breatheBtn: {
    animation: 'breathe 2.5s ease-in-out infinite',
  },

  // ── AI Panel ────────────────────────────────────────────────────────────
  aiPanel: {
    width: '38%', maxWidth: 480, flexShrink: 0,
    display: 'flex', flexDirection: 'column',
    background: t.bgPanel,
    borderLeft: `1px solid ${t.border}`,
    overflow: 'hidden',
  },

  // ── Avatar hero area (cinematic, fills most of panel) ──────────────────
  avatarHero: {
    flex: 1, minHeight: 0,
    position: 'relative',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    background: t.gradientBg,
  },
  avatarBackdrop: {
    position: 'absolute', inset: 0,
    backgroundSize: 'cover', backgroundPosition: 'center',
    filter: t.avatarBackdropFilter,
    opacity: t.avatarBackdropOpacity, transform: 'scale(1.3)',
    zIndex: 0,
  },
  avatarFill: {
    width: '100%', height: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', zIndex: 1,
  },
  simliLayer: {
    width: '100%', height: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', zIndex: 1,
  },
  simliVideo: {
    width: '100%', height: '100%',
    objectFit: 'contain',
  },
  simliLoading: {
    display: 'flex', alignItems: 'center', gap: 10,
    fontSize: 13, color: t.textSecondary,
    position: 'relative', zIndex: 1,
  },
  spinner: {
    width: 16, height: 16, borderRadius: '50%',
    border: `2px solid ${t.borderAccent}`,
    borderTopColor: t.accent, display: 'inline-block',
  },

  // PIP Camera (floating overlay on avatar)
  pipCam: {
    position: 'absolute', bottom: 60, right: 20,
    width: 160, height: 120,
    borderRadius: 12, overflow: 'hidden',
    background: t.bgGlass,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${t.pipCamBorder}`,
    zIndex: 10,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  pipCamVideo: {
    width: '100%', height: '100%',
    objectFit: 'cover', transform: 'scaleX(-1)',
    display: 'block',
  },
  pipCamOff: {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, color: t.textMuted,
  },
  pipCamLabel: {
    position: 'absolute', top: 8, left: 8,
    display: 'flex', alignItems: 'center', gap: 4,
    fontSize: 11, fontWeight: 600, color: t.text,
    background: 'rgba(0,0,0,0.6)',
    padding: '3px 10px', borderRadius: 6,
    backdropFilter: 'blur(8px)',
  },
  pipCamDot: {
    width: 5, height: 5, borderRadius: '50%',
    background: t.success, display: 'inline-block',
    boxShadow: `0 0 4px ${t.success}`,
  },

  // Avatar bottom bar (name + state + tool)
  avatarBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px',
    background: t.gradientFade,
    zIndex: 5,
  },
  avatarStateRow: {
    display: 'flex', alignItems: 'center', gap: 10,
  },
  avatarStateDot: {
    width: 8, height: 8, borderRadius: '50%',
    transition: 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)',
    flexShrink: 0,
  },
  avatarName: {
    fontSize: 14, fontWeight: 700, color: t.text,
  },
  avatarStateLabel: {
    fontSize: 12, fontWeight: 500,
    transition: 'color 300ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  avatarToolPill: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 8,
    background: 'rgba(168,85,247,0.15)',
    border: '1px solid rgba(168,85,247,0.3)',
    color: '#c4b5fd',
  },
  captionBar: {
    position: 'absolute', bottom: 60, left: 0, right: 0,
    padding: '14px 20px',
    background: 'rgba(15, 23, 42, 0.85)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    zIndex: 8,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  captionText: {
    color: 'white',
    fontSize: 14, fontWeight: 500, lineHeight: 1.4,
    textAlign: 'center',
    maxWidth: '90%',
    textShadow: '0 1px 3px rgba(0,0,0,0.5)',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },

  // ── Transcript (compact bottom section) ────────────────────────────────
  transcriptSection: {
    flexShrink: 0,
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    height: 200,
    borderTop: `1px solid ${t.border}`,
    background: t.bgGlass,
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  },
  transcriptHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: `1px solid ${t.borderSubtle}`,
    flexShrink: 0,
  },
  transcriptTitle: {
    fontSize: 11, fontWeight: 700, color: t.textSecondary,
    textTransform: 'uppercase', letterSpacing: '0.08em',
  },
  transcriptCount: {
    fontSize: 11, fontWeight: 600,
    background: t.borderSubtle,
    padding: '2px 8px', borderRadius: 10,
    color: t.textDim,
  },
  transcriptBody: {
    flex: 1, overflowY: 'auto', padding: '10px 12px',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  transcriptEmpty: {
    fontSize: 12, color: t.textMuted,
    textAlign: 'center', padding: '40px 20px',
  },
  transcriptEntry: {
    padding: '9px 11px', borderRadius: 8,
    display: 'flex', flexDirection: 'column', gap: 3,
  },
  modelEntry: {
    background: t.transcriptModel,
    border: `1px solid ${t.transcriptModelBorder}`,
  },
  userEntry: {
    background: t.transcriptUser,
    border: `1px solid ${t.transcriptUserBorder}`,
  },
  tRole: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  tText: { fontSize: 13, color: t.text, lineHeight: 1.5 },

  // ── Voice bar ───────────────────────────────────────────────────────────
  voiceBar: {
    height: 48, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 20px',
    background: t.bgGlass,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderTop: `1px solid ${t.border}`,
  },
  voiceBarLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  voiceBarCenter: { display: 'flex', alignItems: 'center', gap: 8 },
  voiceBarRight: { display: 'flex', alignItems: 'center', gap: 8 },
  voiceBarDot: {
    width: 6, height: 6, borderRadius: '50%',
    transition: 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  voiceBarStatus: {
    fontSize: 12, fontWeight: 500, color: t.textSecondary,
  },
  voiceBarError: {
    fontSize: 11, color: t.danger,
    background: t.dangerSoft,
    padding: '3px 10px', borderRadius: 6,
    border: `1px solid rgba(239,68,68,0.2)`,
  },
  voiceBarHint: {
    fontSize: 11, color: t.textMuted,
  },
})
