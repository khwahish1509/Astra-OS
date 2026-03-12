/**
 * GeminiAvatar.jsx
 * ==================
 * Real-time FFT-driven animated avatar for the Gemini AI agent.
 * No external avatar libraries — pure React + SVG + Canvas + Web Audio API.
 *
 * Architecture:
 *   - Accepts a Web Audio `analyserNode` (AnalyserNode) prop.
 *   - Runs a requestAnimationFrame loop that reads FFT data each frame.
 *   - Updates SVG rings, face scale, canvas waveform via DOM refs directly —
 *     NO setState inside the RAF loop (zero React re-renders at 60fps).
 *   - Only slow state (blink, glowColor) uses React state.
 *
 * FFT band mapping at 24kHz, fftSize=256 (128 bins, 93.75 Hz/bin):
 *   Bass   = bins 0–4   (0–375 Hz)    → drives ring1 scale
 *   Mid    = bins 5–20  (375–1875 Hz) → drives ring2 scale + mouth shape
 *   Treble = bins 21–50 (1875–4688Hz) → drives ring3 opacity
 *
 * Props:
 *   state        'idle' | 'listening' | 'thinking' | 'speaking'
 *   analyserNode Web Audio AnalyserNode (null until audio pipeline starts)
 *   name         string (agent display name)
 */

import { useEffect, useRef, useState } from 'react'

// ── FFT band helpers ──────────────────────────────────────────────────────────
// All at 24kHz, fftSize=256 → 128 bins, 93.75 Hz per bin
const BASS_START   = 0,  BASS_END   = 4
const MID_START    = 5,  MID_END    = 20
const TREBLE_START = 21, TREBLE_END = 50

function bandAvg(data, start, end) {
  let sum = 0
  for (let i = start; i <= Math.min(end, data.length - 1); i++) sum += data[i]
  return sum / ((end - start + 1) * 255)   // normalized 0–1
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GeminiAvatar({ state = 'idle', analyserNode = null, name = 'Agent' }) {
  // ── Slow React state ─────────────────────────────────────────────
  const [blink, setBlink] = useState(false)

  // ── DOM refs — updated directly in RAF (no setState) ─────────────
  const canvasRef        = useRef(null)
  const ring1Ref         = useRef(null)   // inner ring  — bass
  const ring2Ref         = useRef(null)   // middle ring — mid
  const ring3Ref         = useRef(null)   // outer ring  — treble
  const faceRef          = useRef(null)   // face orb
  const mouthClosedRef   = useRef(null)   // <path> for closed smile
  const mouthOpenRef     = useRef(null)   // <ellipse> for open mouth
  const mouthTeethRef    = useRef(null)   // <rect> teeth hint

  // ── RAF handle ───────────────────────────────────────────────────
  const rafRef  = useRef(null)
  const stateRef = useRef(state)           // ref so RAF closure always has current state
  useEffect(() => { stateRef.current = state }, [state])

  // ── Blink scheduler ──────────────────────────────────────────────
  const blinkTimer = useRef(null)
  useEffect(() => {
    const scheduleBlink = () => {
      const delay = 2500 + Math.random() * 2500
      blinkTimer.current = setTimeout(() => {
        setBlink(true)
        setTimeout(() => { setBlink(false); scheduleBlink() }, 120)
      }, delay)
    }
    scheduleBlink()
    return () => clearTimeout(blinkTimer.current)
  }, [])

  // ── FFT animation loop ────────────────────────────────────────────
  useEffect(() => {
    if (!analyserNode) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      // Reset visuals when no audio
      if (ring1Ref.current) ring1Ref.current.style.transform = 'translate(-50%,-50%) scale(1)'
      if (ring2Ref.current) ring2Ref.current.style.transform = 'translate(-50%,-50%) scale(1)'
      if (ring3Ref.current) ring3Ref.current.style.transform = 'translate(-50%,-50%) scale(1)'
      if (faceRef.current)  faceRef.current.style.transform  = 'scale(1)'
      const canvas = canvasRef.current
      if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    const bufLen   = analyserNode.frequencyBinCount   // 128
    const freqData = new Uint8Array(bufLen)
    const timeData = new Uint8Array(bufLen)

    const animate = () => {
      rafRef.current = requestAnimationFrame(animate)
      analyserNode.getByteFrequencyData(freqData)
      analyserNode.getByteTimeDomainData(timeData)

      const bass   = bandAvg(freqData, BASS_START,   BASS_END)
      const mid    = bandAvg(freqData, MID_START,    MID_END)
      const treble = bandAvg(freqData, TREBLE_START, TREBLE_END)
      const energy = bass * 0.5 + mid * 0.35 + treble * 0.15
      const curState = stateRef.current

      // ── Ring 1 (inner) — bass driven ───────────────────────────
      if (ring1Ref.current) {
        const s = 1 + bass * 0.10
        ring1Ref.current.style.transform = `translate(-50%,-50%) scale(${s.toFixed(3)})`
        ring1Ref.current.style.opacity   = String((curState !== 'idle' ? 0.12 + bass * 0.3 : 0.06).toFixed(3))
      }

      // ── Ring 2 (middle) — mid driven ───────────────────────────
      if (ring2Ref.current) {
        const s = 1 + mid * 0.14
        ring2Ref.current.style.transform = `translate(-50%,-50%) scale(${s.toFixed(3)})`
        ring2Ref.current.style.opacity   = String(
          (curState === 'speaking' ? 0.08 + mid * 0.25
          : curState === 'listening' ? 0.06 + mid * 0.15
          : 0.04).toFixed(3)
        )
      }

      // ── Ring 3 (outer) — treble driven ─────────────────────────
      if (ring3Ref.current) {
        const s = 1 + treble * 0.18
        ring3Ref.current.style.transform = `translate(-50%,-50%) scale(${s.toFixed(3)})`
        ring3Ref.current.style.opacity   = String(
          ((curState === 'speaking' || curState === 'listening') ? treble * 0.18 : 0).toFixed(3)
        )
      }

      // ── Face orb scale ──────────────────────────────────────────
      if (faceRef.current) {
        const faceScale = curState === 'speaking' ? 1 + energy * 0.025 : 1
        faceRef.current.style.transform = `scale(${faceScale.toFixed(4)})`
      }

      // ── Mouth shape ──────────────────────────────────────────────
      const mouthOpen = curState === 'speaking' ? Math.min(1, energy * 4) : 0
      const mouthH    = 4 + mouthOpen * 14
      const mouthY    = 62 - mouthOpen * 4
      const isOpen    = mouthOpen >= 0.12

      if (mouthClosedRef.current) {
        mouthClosedRef.current.style.display = isOpen ? 'none' : ''
        if (!isOpen) {
          mouthClosedRef.current.setAttribute(
            'd', `M 36 ${mouthY.toFixed(1)} Q 50 ${(mouthY + 6).toFixed(1)} 64 ${mouthY.toFixed(1)}`
          )
        }
      }
      if (mouthOpenRef.current) {
        mouthOpenRef.current.style.display = isOpen ? '' : 'none'
        if (isOpen) {
          mouthOpenRef.current.setAttribute('cy',  String((mouthY + mouthH / 2).toFixed(1)))
          mouthOpenRef.current.setAttribute('ry',  String((mouthH / 2).toFixed(1)))
        }
      }
      if (mouthTeethRef.current) {
        mouthTeethRef.current.style.display = isOpen ? '' : 'none'
        if (isOpen) {
          mouthTeethRef.current.setAttribute('y', String(mouthY.toFixed(1)))
        }
      }

      // ── Canvas waveform ──────────────────────────────────────────
      const canvas = canvasRef.current
      if (canvas) {
        const ctx2d = canvas.getContext('2d')
        const W = canvas.width, H = canvas.height
        ctx2d.clearRect(0, 0, W, H)

        if (curState === 'speaking' && energy > 0.01) {
          ctx2d.beginPath()
          const sliceW = W / bufLen
          for (let i = 0; i < bufLen; i++) {
            const v = timeData[i] / 128 - 1         // -1 to 1
            const y = (v * H * 0.42) + H / 2
            const x = i * sliceW
            i === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y)
          }
          const grad = ctx2d.createLinearGradient(0, 0, W, 0)
          const a1 = (0.3 + energy * 0.55).toFixed(2)
          const a2 = (0.45 + energy * 0.55).toFixed(2)
          grad.addColorStop(0,   `rgba(79,125,255,${a1})`)
          grad.addColorStop(0.5, `rgba(168,85,247,${a2})`)
          grad.addColorStop(1,   `rgba(79,125,255,${a1})`)
          ctx2d.strokeStyle = grad
          ctx2d.lineWidth   = 2.5
          ctx2d.stroke()
        }
      }
    }

    animate()
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [analyserNode])   // re-run only when the analyser instance changes

  // ── Glow color (React rendered — slow, smooth) ───────────────────
  const glowColor = state === 'thinking'
    ? 'rgba(168,85,247,0.35)'
    : state === 'listening'
    ? 'rgba(79,125,255,0.4)'
    : state === 'speaking'
    ? 'rgba(79,125,255,0.6)'
    : 'rgba(79,125,255,0.2)'

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div style={styles.wrapper}>

      {/* ── FFT-driven rings (positions set via ref in RAF) ── */}
      <div ref={ring3Ref} style={{ ...styles.ring, ...styles.ring3, opacity: 0 }} />
      <div ref={ring2Ref} style={{ ...styles.ring, ...styles.ring2, opacity: 0.04 }} />
      <div ref={ring1Ref} style={{ ...styles.ring, ...styles.ring1, opacity: state !== 'idle' ? 0.12 : 0.06 }} />

      {/* ── Face orb ── */}
      <div
        ref={faceRef}
        style={{
          ...styles.face,
          boxShadow: `0 0 40px ${glowColor}, 0 0 80px ${glowColor.replace(/[\d.]+\)$/, v => (parseFloat(v) * 0.4).toFixed(2) + ')')}`,
          transition: 'box-shadow 0.3s ease',
        }}
      >

        {/* ── SVG face features ── */}
        <svg width="100" height="100" viewBox="0 0 100 100" style={styles.svg}>
          <defs>
            <radialGradient id="eyeGrad" cx="40%" cy="35%">
              <stop offset="0%" stopColor="#a8c8ff" />
              <stop offset="100%" stopColor="#4f7dff" />
            </radialGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Left eye */}
          <ellipse cx="35" cy="40" rx="7" ry={blink ? 0.8 : 7}
            fill="url(#eyeGrad)" filter="url(#glow)"
            style={{ transition: 'ry 0.08s ease' }}
          />
          <circle cx="35" cy="40" r={blink ? 0 : 3.5}
            fill="#0a1040" style={{ transition: 'r 0.08s ease' }}
          />
          <circle cx="37" cy="37.5" r="1.2" fill="rgba(255,255,255,0.8)" />

          {/* Right eye */}
          <ellipse cx="65" cy="40" rx="7" ry={blink ? 0.8 : 7}
            fill="url(#eyeGrad)" filter="url(#glow)"
            style={{ transition: 'ry 0.08s ease' }}
          />
          <circle cx="65" cy="40" r={blink ? 0 : 3.5}
            fill="#0a1040" style={{ transition: 'r 0.08s ease' }}
          />
          <circle cx="67" cy="37.5" r="1.2" fill="rgba(255,255,255,0.8)" />

          {/* Mouth — closed (driven by RAF) */}
          <path
            ref={mouthClosedRef}
            d="M 36 62 Q 50 68 64 62"
            stroke="rgba(255,255,255,0.6)"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />

          {/* Mouth — open ellipse (driven by RAF) */}
          <ellipse
            ref={mouthOpenRef}
            cx="50" cy="64"
            rx="14" ry="4"
            fill="#0a1040"
            style={{ display: 'none' }}
          />

          {/* Teeth hint (driven by RAF) */}
          <rect
            ref={mouthTeethRef}
            x="38" y="62"
            width="24" height="3"
            rx="1.5"
            fill="rgba(255,255,255,0.85)"
            style={{ display: 'none' }}
          />

          {/* Thinking orbit ── */}
          {state === 'thinking' && (
            <g style={{ animation: 'orbitSpin 1.5s linear infinite', transformOrigin: '50px 50px' }}>
              <circle cx="50" cy="18" r="3" fill="rgba(168,85,247,0.9)" />
            </g>
          )}
        </svg>

        {/* State indicator dot */}
        <div style={{
          ...styles.stateDot,
          background: state === 'speaking' ? '#22c55e'
            : state === 'listening' ? '#4f7dff'
            : state === 'thinking'  ? '#a855f7'
            : '#64748b',
          boxShadow: `0 0 8px ${state === 'speaking' ? '#22c55e'
            : state === 'listening' ? '#4f7dff'
            : state === 'thinking'  ? '#a855f7' : 'transparent'}`,
          animation: state !== 'idle' ? 'dotPulse 1.2s ease-in-out infinite' : 'none',
        }} />
      </div>

      {/* ── Name + state label ── */}
      <div style={styles.nameRow}>
        <span style={styles.nameText}>{name}</span>
        <span style={{
          ...styles.stateLabel,
          color: state === 'speaking' ? '#86efac'
            : state === 'listening' ? '#93c5fd'
            : state === 'thinking'  ? '#c4b5fd'
            : '#64748b',
        }}>
          {state === 'speaking'  ? '● Speaking'
            : state === 'listening' ? '◎ Listening'
            : state === 'thinking'  ? '⟳ Thinking...'
            : '○ Idle'}
        </span>
      </div>

      {/* ── Canvas waveform — drawn entirely by RAF, zero React renders ── */}
      <canvas
        ref={canvasRef}
        width={200}
        height={36}
        style={{
          ...styles.canvas,
          opacity: state === 'speaking' ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      />
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const SIZE = 200

const styles = {
  wrapper: {
    position: 'relative',
    width: SIZE,
    height: SIZE + 90,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    userSelect: 'none',
  },
  ring: {
    position: 'absolute',
    top: SIZE / 2,
    left: SIZE / 2,
    borderRadius: '50%',
    border: '1.5px solid rgba(79,125,255,0.6)',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    // No CSS transition — driven by RAF directly for zero-lag
  },
  ring1: { width: SIZE + 20,  height: SIZE + 20  },
  ring2: { width: SIZE + 48,  height: SIZE + 48  },
  ring3: { width: SIZE + 80,  height: SIZE + 80  },
  face: {
    width: SIZE,
    height: SIZE,
    borderRadius: '50%',
    background: 'radial-gradient(circle at 38% 35%, #5b8fff, #2a3fa0 60%, #0d1640)',
    border: '2px solid rgba(79,125,255,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    flexShrink: 0,
    // No CSS transform transition — driven by RAF
  },
  svg: {
    width: '75%',
    height: '75%',
  },
  stateDot: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    width: 12,
    height: 12,
    borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.2)',
    transition: 'background 0.3s ease, box-shadow 0.3s ease',
  },
  nameRow: {
    marginTop: 16,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
  },
  nameText: {
    color: '#f0f0f8',
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: '-0.2px',
  },
  stateLabel: {
    fontSize: 12,
    letterSpacing: '0.03em',
    transition: 'color 0.3s ease',
  },
  canvas: {
    marginTop: 10,
    borderRadius: 4,
    // background: 'rgba(0,0,0,0)',  // transparent
  },
}
