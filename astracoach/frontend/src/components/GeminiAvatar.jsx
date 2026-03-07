/**
 * GeminiAvatar.jsx
 * ==================
 * A beautiful, Gemini-branded animated avatar that represents
 * the AI interviewer. Built with pure React + CSS + SVG.
 * No external avatar libraries needed.
 *
 * Visual states:
 *   idle      — subtle breathing, slow eye movements
 *   listening — pulsing ring, ears-up animation
 *   thinking  — spinning orbit rings
 *   speaking  — mouth animates with audioLevel, bright glow
 *
 * Props:
 *   state       'idle' | 'listening' | 'thinking' | 'speaking'
 *   audioLevel  0.0 – 1.0  (Gemini output amplitude → mouth shape)
 *   name        string (interviewer name)
 */

import { useEffect, useRef, useState } from 'react'

const BLINK_INTERVAL_MIN = 2500
const BLINK_INTERVAL_MAX = 5000

export default function GeminiAvatar({ state = 'idle', audioLevel = 0, name = 'Alex Chen' }) {
  const [blink, setBlink] = useState(false)
  const blinkTimer = useRef(null)

  // Autonomous blinking
  useEffect(() => {
    const scheduleBlink = () => {
      const delay = BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN)
      blinkTimer.current = setTimeout(() => {
        setBlink(true)
        setTimeout(() => {
          setBlink(false)
          scheduleBlink()
        }, 120)
      }, delay)
    }
    scheduleBlink()
    return () => clearTimeout(blinkTimer.current)
  }, [])

  // Mouth openness driven by audioLevel when speaking
  const mouthOpen = state === 'speaking' ? Math.min(1, audioLevel * 4) : 0
  const mouthHeight = 4 + mouthOpen * 14   // 4px closed → 18px fully open
  const mouthY = 62 - mouthOpen * 4        // slight shift when open

  // Glow intensity
  const glowIntensity = state === 'speaking'
    ? 0.6 + audioLevel * 0.4
    : state === 'listening' ? 0.4
    : state === 'thinking' ? 0.35
    : 0.2

  const glowColor = state === 'thinking'
    ? `rgba(168,85,247,${glowIntensity})`
    : `rgba(79,125,255,${glowIntensity})`

  return (
    <div style={styles.wrapper}>
      {/* ── Outer glow rings ── */}
      <div style={{ ...styles.ring, ...styles.ring3,
        opacity: state === 'listening' || state === 'speaking' ? 0.15 : 0,
        animation: state === 'listening' ? 'ringPulse 2s ease-in-out infinite' : 'none',
      }} />
      <div style={{ ...styles.ring, ...styles.ring2,
        opacity: state === 'speaking' ? 0.25 : state === 'listening' ? 0.2 : 0.08,
        animation: state === 'speaking' ? `ringPulse 1.2s ease-in-out infinite` : 'none',
      }} />
      <div style={{ ...styles.ring, ...styles.ring1,
        opacity: state !== 'idle' ? 0.4 : 0.12,
      }} />

      {/* ── Face circle ── */}
      <div style={{
        ...styles.face,
        boxShadow: `0 0 40px ${glowColor}, 0 0 80px ${glowColor.replace(glowIntensity, glowIntensity * 0.4)}`,
        transform: `scale(${state === 'speaking' ? 1 + audioLevel * 0.015 : 1})`,
        transition: 'transform 0.08s ease, box-shadow 0.3s ease',
      }}>

        {/* ── SVG face features ── */}
        <svg width="100" height="100" viewBox="0 0 100 100" style={styles.svg}>
          <defs>
            <radialGradient id="faceGrad" cx="40%" cy="35%">
              <stop offset="0%" stopColor="#5b8fff" />
              <stop offset="60%" stopColor="#3d5fc9" />
              <stop offset="100%" stopColor="#1e2d7a" />
            </radialGradient>
            <radialGradient id="eyeGrad" cx="40%" cy="35%">
              <stop offset="0%" stopColor="#a8c8ff" />
              <stop offset="100%" stopColor="#4f7dff" />
            </radialGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Face base — handled by wrapper div, SVG is transparent */}

          {/* ── Eyes ── */}
          {/* Left eye */}
          <ellipse
            cx="35" cy="40"
            rx="7" ry={blink ? 0.8 : 7}
            fill="url(#eyeGrad)"
            filter="url(#glow)"
            style={{ transition: 'ry 0.08s ease' }}
          />
          {/* Left pupil */}
          <circle
            cx="35" cy="40" r={blink ? 0 : 3.5}
            fill="#0a1040"
            style={{ transition: 'r 0.08s ease' }}
          />
          {/* Left eye shine */}
          <circle cx="37" cy="37.5" r="1.2" fill="rgba(255,255,255,0.8)" />

          {/* Right eye */}
          <ellipse
            cx="65" cy="40"
            rx="7" ry={blink ? 0.8 : 7}
            fill="url(#eyeGrad)"
            filter="url(#glow)"
            style={{ transition: 'ry 0.08s ease' }}
          />
          {/* Right pupil */}
          <circle
            cx="65" cy="40" r={blink ? 0 : 3.5}
            fill="#0a1040"
            style={{ transition: 'r 0.08s ease' }}
          />
          {/* Right eye shine */}
          <circle cx="67" cy="37.5" r="1.2" fill="rgba(255,255,255,0.8)" />

          {/* ── Mouth ── */}
          {mouthOpen < 0.1 ? (
            // Closed mouth — a gentle smile curve
            <path
              d={`M 36 ${mouthY} Q 50 ${mouthY + 6} 64 ${mouthY}`}
              stroke="rgba(255,255,255,0.6)"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
          ) : (
            // Open mouth when speaking
            <g>
              <ellipse
                cx="50" cy={mouthY + mouthHeight / 2}
                rx="14"
                ry={mouthHeight / 2}
                fill="#0a1040"
              />
              {/* Teeth hint */}
              <rect
                x="38" y={mouthY}
                width="24" height="3"
                rx="1.5"
                fill="rgba(255,255,255,0.85)"
              />
            </g>
          )}

          {/* ── Thinking dots (orbiting) ── */}
          {state === 'thinking' && (
            <g style={{ animation: 'orbitSpin 1.5s linear infinite', transformOrigin: '50px 50px' }}>
              <circle cx="50" cy="18" r="3" fill="rgba(168,85,247,0.9)" />
            </g>
          )}
        </svg>

        {/* ── State indicator dot ── */}
        <div style={{
          ...styles.stateDot,
          background: state === 'speaking' ? '#22c55e'
            : state === 'listening' ? '#4f7dff'
            : state === 'thinking' ? '#a855f7'
            : '#64748b',
          boxShadow: `0 0 8px ${
            state === 'speaking' ? '#22c55e'
            : state === 'listening' ? '#4f7dff'
            : state === 'thinking' ? '#a855f7'
            : 'transparent'
          }`,
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
            : state === 'thinking' ? '#c4b5fd'
            : '#64748b',
        }}>
          {state === 'speaking' ? '● Speaking'
            : state === 'listening' ? '◎ Listening'
            : state === 'thinking' ? '⟳ Thinking...'
            : '○ Idle'}
        </span>
      </div>

      {/* ── Waveform when speaking ── */}
      {state === 'speaking' && (
        <div style={styles.waveform}>
          {Array.from({ length: 20 }).map((_, i) => {
            const height = 4 + Math.abs(Math.sin((i / 20) * Math.PI + audioLevel * 8)) * audioLevel * 28
            return (
              <div
                key={i}
                style={{
                  ...styles.waveBar,
                  height: `${height}px`,
                  opacity: 0.4 + (height / 32) * 0.6,
                  background: `hsl(${220 + i * 3}, 80%, 65%)`,
                }}
              />
            )
          })}
        </div>
      )}

      {/* ── Listening pulse ring ── */}
      {state === 'listening' && (
        <div style={styles.listeningRing} />
      )}
    </div>
  )
}

const SIZE = 200

const styles = {
  wrapper: {
    position: 'relative',
    width: SIZE,
    height: SIZE + 80,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    userSelect: 'none',
  },
  ring: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    borderRadius: '50%',
    border: '1.5px solid rgba(79,125,255,0.6)',
    transform: 'translate(-50%, -50%)',
    transition: 'opacity 0.5s ease',
    pointerEvents: 'none',
  },
  ring1: { width: SIZE + 20,  height: SIZE + 20,  top: SIZE / 2, left: SIZE / 2 },
  ring2: { width: SIZE + 48,  height: SIZE + 48,  top: SIZE / 2, left: SIZE / 2 },
  ring3: { width: SIZE + 80,  height: SIZE + 80,  top: SIZE / 2, left: SIZE / 2 },
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
  waveform: {
    marginTop: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    height: 36,
  },
  waveBar: {
    width: 3,
    borderRadius: 99,
    transition: 'height 0.08s ease',
    minHeight: 3,
  },
  listeningRing: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: SIZE + 16,
    height: SIZE + 16,
    borderRadius: '50%',
    border: '2px solid rgba(79,125,255,0.5)',
    animation: 'listeningPulse 1.8s ease-out infinite',
    pointerEvents: 'none',
  },
}
