/**
 * GeminiAvatar.jsx — Hybrid GenMedia + FFT Portrait Avatar
 * =========================================================
 *
 * TWO RENDERING MODES, one component:
 *
 *   PORTRAIT MODE  (when `base64Image` prop is provided)
 *   ─────────────────────────────────────────────────────
 *   - Draws the Imagen-3-generated portrait on a 240×240 circular canvas.
 *   - Uses a 3-slice Canvas 2D `drawImage` technique to animate the mouth
 *     in real time at 60 FPS, driven by the Web Audio AnalyserNode FFT data.
 *   - Zero React setState calls inside the RAF loop (canvas API only).
 *   - FFT-driven glow rings pulse around the portrait circle.
 *
 *   SVG ORB MODE  (fallback when no `base64Image`)
 *   ───────────────────────────────────────────────
 *   - Keeps the original animated blue-orb + SVG face (eyes, blink, mouth).
 *   - Identical FFT ring + waveform behaviour.
 *
 * ── The 3-Slice Lip-Sync Technique ─────────────────────────────────────
 *
 *   The portrait image is divided into three horizontal slices:
 *
 *     ┌────────────────────────┐  0%
 *     │  Upper  (0→58%)        │  forehead + eyes + nose — NEVER MOVES
 *     ├────────────────────────┤  58%
 *     │  Mouth  (58→78%)       │  lips + jaw — STRETCHED DOWN by audio amp
 *     ├────────────────────────┤  78% + stretch delta
 *     │  Chin   (78→100%)      │  chin + neck — SHIFTED DOWN by stretch delta
 *     └────────────────────────┘  100%
 *
 *   Each slice is drawn with a separate `ctx.drawImage(src, sx,sy,sw,sh, dx,dy,dw,dh)`.
 *   At 1 FPS of audio and 60fps of animation:
 *     - drawImage blit:      ~0.3 ms (GPU-accelerated)
 *     - getByteFrequencyData: ~0.1 ms
 *     - Total per frame:     < 0.5 ms — imperceptible
 *
 * Props:
 *   state        'idle' | 'listening' | 'thinking' | 'speaking'
 *   analyserNode Web Audio AnalyserNode (null until audio pipeline starts)
 *   name         string (agent display name)
 *   base64Image  string (bare base64, no data-URI prefix) | undefined
 */

import { useEffect, useRef, useState } from 'react'

// ── FFT band helpers (24kHz, fftSize=256 → 128 bins, 93.75 Hz/bin) ──────────
const BASS_START   = 0,  BASS_END   = 4
const MID_START    = 5,  MID_END    = 20
const TREBLE_START = 21, TREBLE_END = 50

function bandAvg(data, start, end) {
  let sum = 0
  for (let i = start; i <= Math.min(end, data.length - 1); i++) sum += data[i]
  return sum / ((end - start + 1) * 255)
}

// ── Portrait lip-sync constants ───────────────────────────────────────────────
// These fractions divide the portrait image into three vertical bands.
// Tuned for a standard front-facing headshot (forehead at top, neck at bottom).
const UPPER_FRAC = 0.58   // 0→58%  : forehead, eyes, nose — static
const MOUTH_FRAC = 0.20   // 58→78% : lips, jaw — stretched by audio amplitude
const CHIN_FRAC  = 0.22   // 78→100%: chin, neck — shifted down by stretch delta
const MAX_STRETCH = 0.40  // max 40% additional height at full volume

// ── Component ─────────────────────────────────────────────────────────────────
export default function GeminiAvatar({
  state       = 'idle',
  analyserNode = null,
  name         = 'Agent',
  base64Image  = null,
}) {
  // ── Portrait image loader ──────────────────────────────────────────────
  // Load the base64 portrait into a JS Image object that drawImage can use.
  const portraitRef = useRef(null)   // JS Image object, null until loaded
  const [portraitReady, setPortraitReady] = useState(false)

  useEffect(() => {
    if (!base64Image) {
      portraitRef.current = null
      setPortraitReady(false)
      return
    }
    const img = new Image()
    img.onload  = () => { portraitRef.current = img; setPortraitReady(true) }
    img.onerror = () => { portraitRef.current = null; setPortraitReady(false) }
    // Normalise: accept both bare base64 and full data-URI strings
    img.src = base64Image.startsWith('data:')
      ? base64Image
      : `data:image/png;base64,${base64Image}`
  }, [base64Image])

  // ── DOM refs — all updated by RAF (zero setState at 60fps) ────────────
  const portraitCanvasRef = useRef(null)   // the portrait + lip-sync canvas
  const waveCanvasRef     = useRef(null)   // waveform strip (svg orb mode)
  // SVG orb mode refs
  const ring1Ref        = useRef(null)
  const ring2Ref        = useRef(null)
  const ring3Ref        = useRef(null)
  const faceRef         = useRef(null)
  const mouthClosedRef  = useRef(null)
  const mouthOpenRef    = useRef(null)
  const mouthTeethRef   = useRef(null)

  // ── RAF handle + state ref (avoids stale closure) ─────────────────────
  const rafRef       = useRef(null)
  const stateRef     = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  // ── Smoothed amplitude (exponential moving average, lives in a ref) ───
  const smoothedAmpRef = useRef(0)

  // ── Blink — React state (fires ~every 3s, never inside RAF) ───────────
  const [blink, setBlink] = useState(false)
  const blinkTimer = useRef(null)
  useEffect(() => {
    const schedule = () => {
      blinkTimer.current = setTimeout(() => {
        setBlink(true)
        setTimeout(() => { setBlink(false); schedule() }, 120)
      }, 2500 + Math.random() * 2500)
    }
    schedule()
    return () => clearTimeout(blinkTimer.current)
  }, [])

  // ── Main FFT animation loop ────────────────────────────────────────────
  useEffect(() => {
    if (!analyserNode) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      smoothedAmpRef.current = 0
      // Reset SVG orb visuals
      if (ring1Ref.current) ring1Ref.current.style.transform = 'translate(-50%,-50%) scale(1)'
      if (ring2Ref.current) ring2Ref.current.style.transform = 'translate(-50%,-50%) scale(1)'
      if (ring3Ref.current) ring3Ref.current.style.transform = 'translate(-50%,-50%) scale(1)'
      if (faceRef.current)  faceRef.current.style.transform  = 'scale(1)'
      // Clear portrait canvas
      const pc = portraitCanvasRef.current
      if (pc) pc.getContext('2d').clearRect(0, 0, pc.width, pc.height)
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

      // Smooth amplitude — EMA with 0.75 decay (fast attack, gentle release)
      smoothedAmpRef.current = smoothedAmpRef.current * 0.75 + energy * 0.25
      const amp = curState === 'speaking' ? Math.min(1, smoothedAmpRef.current) : 0

      // ─────────────────────────────────────────────────────────────────
      // PORTRAIT MODE — all rendering inside one canvas
      // ─────────────────────────────────────────────────────────────────
      const portrait = portraitRef.current
      const pCanvas  = portraitCanvasRef.current
      if (portrait && pCanvas) {
        _drawPortrait(pCanvas, portrait, amp, energy, curState)
      }

      // ─────────────────────────────────────────────────────────────────
      // RINGS — work for BOTH modes (positioned around the circular avatar)
      // ─────────────────────────────────────────────────────────────────
      if (ring1Ref.current) {
        const s = 1 + bass * 0.10
        ring1Ref.current.style.transform = `translate(-50%,-50%) scale(${s.toFixed(3)})`
        ring1Ref.current.style.opacity   =
          String((curState !== 'idle' ? 0.12 + bass * 0.3 : 0.06).toFixed(3))
      }
      if (ring2Ref.current) {
        const s = 1 + mid * 0.14
        ring2Ref.current.style.transform = `translate(-50%,-50%) scale(${s.toFixed(3)})`
        ring2Ref.current.style.opacity   = String((
          curState === 'speaking'  ? 0.08 + mid * 0.25 :
          curState === 'listening' ? 0.06 + mid * 0.15 : 0.04
        ).toFixed(3))
      }
      if (ring3Ref.current) {
        const s = 1 + treble * 0.18
        ring3Ref.current.style.transform = `translate(-50%,-50%) scale(${s.toFixed(3)})`
        ring3Ref.current.style.opacity   = String((
          (curState === 'speaking' || curState === 'listening') ? treble * 0.18 : 0
        ).toFixed(3))
      }

      // ─────────────────────────────────────────────────────────────────
      // SVG ORB MODE — only runs when no portrait
      // ─────────────────────────────────────────────────────────────────
      if (!portrait) {
        if (faceRef.current) {
          const fs = curState === 'speaking' ? 1 + energy * 0.025 : 1
          faceRef.current.style.transform = `scale(${fs.toFixed(4)})`
        }
        const mouthOpen = curState === 'speaking' ? Math.min(1, energy * 4) : 0
        const mouthH    = 4 + mouthOpen * 14
        const mouthY    = 62 - mouthOpen * 4
        const isOpen    = mouthOpen >= 0.12
        if (mouthClosedRef.current) {
          mouthClosedRef.current.style.display = isOpen ? 'none' : ''
          if (!isOpen)
            mouthClosedRef.current.setAttribute(
              'd', `M 36 ${mouthY.toFixed(1)} Q 50 ${(mouthY + 6).toFixed(1)} 64 ${mouthY.toFixed(1)}`
            )
        }
        if (mouthOpenRef.current) {
          mouthOpenRef.current.style.display = isOpen ? '' : 'none'
          if (isOpen) {
            mouthOpenRef.current.setAttribute('cy', String((mouthY + mouthH / 2).toFixed(1)))
            mouthOpenRef.current.setAttribute('ry', String((mouthH / 2).toFixed(1)))
          }
        }
        if (mouthTeethRef.current) {
          mouthTeethRef.current.style.display = isOpen ? '' : 'none'
          if (isOpen) mouthTeethRef.current.setAttribute('y', String(mouthY.toFixed(1)))
        }

        // Waveform strip (only in SVG orb mode)
        const wc = waveCanvasRef.current
        if (wc) {
          const ctx2d = wc.getContext('2d')
          const W = wc.width, H = wc.height
          ctx2d.clearRect(0, 0, W, H)
          if (curState === 'speaking' && energy > 0.01) {
            ctx2d.beginPath()
            const sliceW = W / bufLen
            for (let i = 0; i < bufLen; i++) {
              const v = timeData[i] / 128 - 1
              const y = (v * H * 0.42) + H / 2
              i === 0 ? ctx2d.moveTo(i * sliceW, y) : ctx2d.lineTo(i * sliceW, y)
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
    }

    animate()
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [analyserNode])   // only re-create the loop when the analyser changes

  // ── Glow color (React state — slow update is fine here) ───────────────
  const glowColor = state === 'thinking'  ? 'rgba(168,85,247,0.35)'
    : state === 'listening' ? 'rgba(79,125,255,0.4)'
    : state === 'speaking'  ? 'rgba(79,125,255,0.6)'
    :                          'rgba(79,125,255,0.2)'

  const isPortraitMode = !!(base64Image && portraitReady)
  const SIZE = isPortraitMode ? PORTRAIT_SIZE : ORB_SIZE

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ ...styles.wrapper, width: SIZE, height: SIZE + 90 }}>

      {/* ── FFT-driven rings (both modes) ── */}
      <div ref={ring3Ref} style={{ ...styles.ring, width: SIZE + 80, height: SIZE + 80, opacity: 0 }} />
      <div ref={ring2Ref} style={{ ...styles.ring, width: SIZE + 48, height: SIZE + 48, opacity: 0.04 }} />
      <div ref={ring1Ref} style={{
        ...styles.ring,
        width: SIZE + 20, height: SIZE + 20,
        opacity: state !== 'idle' ? 0.12 : 0.06,
      }} />

      {/* ─────────────────────────────────────────────────────────────────
          PORTRAIT MODE — circular canvas with Imagen 3 portrait
          ───────────────────────────────────────────────────────────────── */}
      {isPortraitMode && (
        <div
          style={{
            ...styles.avatarContainer,
            width: SIZE, height: SIZE,
            boxShadow: `0 0 40px ${glowColor}, 0 0 80px ${glowColor.replace(/[\d.]+\)$/, v => (parseFloat(v)*0.4).toFixed(2)+')')}`,
            transition: 'box-shadow 0.3s ease',
          }}
        >
          <canvas
            ref={portraitCanvasRef}
            width={SIZE}
            height={SIZE}
            style={styles.portraitCanvas}
          />

          {/* State indicator dot */}
          <div style={{
            ...styles.stateDot,
            background: state === 'speaking' ? '#22c55e'
              : state === 'listening' ? '#4f7dff'
              : state === 'thinking'  ? '#a855f7' : '#64748b',
            boxShadow: `0 0 8px ${state === 'speaking' ? '#22c55e'
              : state === 'listening' ? '#4f7dff'
              : state === 'thinking'  ? '#a855f7' : 'transparent'}`,
            animation: state !== 'idle' ? 'dotPulse 1.2s ease-in-out infinite' : 'none',
          }} />

          {/* Thinking orbit overlaid on portrait */}
          {state === 'thinking' && (
            <div style={styles.thinkingOrbitWrap}>
              <div style={styles.thinkingOrbit} className="orbitSpin" />
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────
          SVG ORB MODE — original animated blue orb (fallback)
          ───────────────────────────────────────────────────────────────── */}
      {!isPortraitMode && (
        <div
          ref={faceRef}
          style={{
            ...styles.face,
            width: SIZE, height: SIZE,
            boxShadow: `0 0 40px ${glowColor}, 0 0 80px ${glowColor.replace(/[\d.]+\)$/, v => (parseFloat(v)*0.4).toFixed(2)+')')}`,
            transition: 'box-shadow 0.3s ease',
          }}
        >
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
              style={{ transition: 'ry 0.08s ease' }} />
            <circle cx="35" cy="40" r={blink ? 0 : 3.5}
              fill="#0a1040" style={{ transition: 'r 0.08s ease' }} />
            <circle cx="37" cy="37.5" r="1.2" fill="rgba(255,255,255,0.8)" />
            {/* Right eye */}
            <ellipse cx="65" cy="40" rx="7" ry={blink ? 0.8 : 7}
              fill="url(#eyeGrad)" filter="url(#glow)"
              style={{ transition: 'ry 0.08s ease' }} />
            <circle cx="65" cy="40" r={blink ? 0 : 3.5}
              fill="#0a1040" style={{ transition: 'r 0.08s ease' }} />
            <circle cx="67" cy="37.5" r="1.2" fill="rgba(255,255,255,0.8)" />
            {/* Mouth */}
            <path ref={mouthClosedRef}
              d="M 36 62 Q 50 68 64 62"
              stroke="rgba(255,255,255,0.6)" strokeWidth="2.5"
              fill="none" strokeLinecap="round" />
            <ellipse ref={mouthOpenRef}
              cx="50" cy="64" rx="14" ry="4"
              fill="#0a1040" style={{ display: 'none' }} />
            <rect ref={mouthTeethRef}
              x="38" y="62" width="24" height="3" rx="1.5"
              fill="rgba(255,255,255,0.85)" style={{ display: 'none' }} />
            {state === 'thinking' && (
              <g style={{ animation: 'orbitSpin 1.5s linear infinite', transformOrigin: '50px 50px' }}>
                <circle cx="50" cy="18" r="3" fill="rgba(168,85,247,0.9)" />
              </g>
            )}
          </svg>

          <div style={{
            ...styles.stateDot,
            background: state === 'speaking' ? '#22c55e'
              : state === 'listening' ? '#4f7dff'
              : state === 'thinking'  ? '#a855f7' : '#64748b',
            boxShadow: `0 0 8px ${state === 'speaking' ? '#22c55e'
              : state === 'listening' ? '#4f7dff'
              : state === 'thinking'  ? '#a855f7' : 'transparent'}`,
            animation: state !== 'idle' ? 'dotPulse 1.2s ease-in-out infinite' : 'none',
          }} />
        </div>
      )}

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

      {/* ── Waveform strip — SVG orb mode only ── */}
      {!isPortraitMode && (
        <canvas
          ref={waveCanvasRef}
          width={200} height={36}
          style={{
            ...styles.canvas,
            opacity: state === 'speaking' ? 1 : 0,
            transition: 'opacity 0.3s ease',
          }}
        />
      )}
    </div>
  )
}

// ── Portrait drawing (kept outside the component to avoid closure allocations) ──
// Called from inside the RAF loop — must be as fast as possible.
function _drawPortrait(canvas, img, amp, energy, curState) {
  const ctx = canvas.getContext('2d', { alpha: false })
  const CW  = canvas.width
  const CH  = canvas.height
  const IW  = img.naturalWidth
  const IH  = img.naturalHeight

  // ── 1. Clip everything to a circle (the "avatar orb" shape) ───────────
  ctx.save()
  ctx.beginPath()
  ctx.arc(CW / 2, CH / 2, CW / 2, 0, Math.PI * 2)
  ctx.clip()

  // Fill background so clipped corners are dark, not transparent
  ctx.fillStyle = '#0d1535'
  ctx.fillRect(0, 0, CW, CH)

  // ── 2. Draw portrait in three slices (the lip-sync magic) ─────────────
  // Stretch factor: 1.0 (mouth closed) → 1 + MAX_STRETCH (mouth fully open)
  const stretch  = 1 + amp * MAX_STRETCH
  const dUpperH  = CH * UPPER_FRAC
  const dMouthH  = CH * MOUTH_FRAC * stretch
  const dChinY   = dUpperH + dMouthH

  // Upper slice — forehead + eyes + nose (perfectly static)
  ctx.drawImage(
    img,
    0,          0,               IW, IH * UPPER_FRAC,
    0,          0,               CW, dUpperH,
  )
  // Mouth slice — stretched vertically by audio amplitude
  ctx.drawImage(
    img,
    0,          IH * UPPER_FRAC,                  IW, IH * MOUTH_FRAC,
    0,          dUpperH,                           CW, dMouthH,
  )
  // Chin slice — shifted down by the stretch delta
  ctx.drawImage(
    img,
    0,          IH * (UPPER_FRAC + MOUTH_FRAC),   IW, IH * CHIN_FRAC,
    0,          dChinY,                            CW, CH - dChinY + 4,  // +4 avoids a hairline gap
  )

  // ── 3. Teeth flash — a bright rect that fades in as mouth opens ────────
  // Only visible when speaking loudly (amp > 0.22). Creates the illusion
  // of seeing teeth through the mouth gap.
  if (amp > 0.22) {
    const teethAlpha = Math.min(0.85, (amp - 0.22) / 0.4)
    ctx.globalAlpha = teethAlpha
    ctx.fillStyle   = '#fffdf8'
    const ty = dUpperH + dMouthH * 0.24
    const th = dMouthH * 0.30
    const tx = CW * 0.31
    const tw = CW * 0.38
    ctx.beginPath()
    // roundRect is available in modern browsers; fallback to rect
    if (ctx.roundRect) {
      ctx.roundRect(tx, ty, tw, th, 3)
    } else {
      ctx.rect(tx, ty, tw, th)
    }
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // ── 4. Speaking glow — blue-ish radial wash over the lower face ────────
  // Uses 'screen' blend mode so it tints rather than obscures the portrait.
  if (energy > 0.025 && curState === 'speaking') {
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = energy * 0.22
    const gx = CW / 2, gy = CH * 0.68
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, CW * 0.42)
    glow.addColorStop(0,   '#4f7dff')
    glow.addColorStop(0.6, 'rgba(79,125,255,0.3)')
    glow.addColorStop(1,   'rgba(79,125,255,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, CW, CH)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  ctx.restore()

  // ── 5. Circle border — brightness pulses with audio energy ─────────────
  // Drawn OUTSIDE the clip so it frames the circle cleanly.
  const borderAlpha = 0.28 + energy * 0.55
  ctx.strokeStyle = `rgba(79,125,255,${borderAlpha.toFixed(3)})`
  ctx.lineWidth   = 2.5
  ctx.beginPath()
  ctx.arc(CW / 2, CH / 2, CW / 2 - 1.5, 0, Math.PI * 2)
  ctx.stroke()
}

// ── Size constants ────────────────────────────────────────────────────────────
const PORTRAIT_SIZE = 240   // portrait canvas — larger for photorealistic impact
const ORB_SIZE      = 200   // SVG orb fallback — original size

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  wrapper: {
    position: 'relative',
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
    pointerEvents: 'none',
    // No CSS transition — driven by RAF for zero-lag
    marginTop: -45,   // offset for the name row below the avatar
  },
  // Portrait mode container — wraps canvas, provides border-radius + glow
  avatarContainer: {
    borderRadius: '50%',
    position: 'relative',
    flexShrink: 0,
    overflow: 'hidden',
    border: '2px solid rgba(79,125,255,0.3)',
  },
  portraitCanvas: {
    display: 'block',
    borderRadius: '50%',
    // The canvas itself is not clipped by CSS — clipping is done in _drawPortrait
  },
  // SVG orb face
  face: {
    borderRadius: '50%',
    background: 'radial-gradient(circle at 38% 35%, #5b8fff, #2a3fa0 60%, #0d1640)',
    border: '2px solid rgba(79,125,255,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    flexShrink: 0,
  },
  svg: { width: '75%', height: '75%' },
  stateDot: {
    position: 'absolute',
    bottom: 14, right: 14,
    width: 12, height: 12,
    borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.2)',
    transition: 'background 0.3s ease, box-shadow 0.3s ease',
  },
  // Thinking orbit overlay for portrait mode
  thinkingOrbitWrap: {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'none',
  },
  thinkingOrbit: {
    width: 8, height: 8,
    borderRadius: '50%',
    background: 'rgba(168,85,247,0.9)',
    boxShadow: '0 0 10px rgba(168,85,247,0.7)',
    animation: 'orbitSpin 1.5s linear infinite',
    transformOrigin: '0px -75px',
    marginTop: -75,
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
  },
}
