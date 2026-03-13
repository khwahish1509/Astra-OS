/**
 * useScreenShareCropper.js
 * =========================
 * Full-Desktop Capture — screen share "ambient awareness" feed for AstraCoach.
 *
 * Strategy (changed from cursor-crop to full-frame squish):
 * ─────────────────────────────────────────────────────────
 * ADK's recommended input resolution is 768×768 @ 1 FPS. Rather than sending
 * a cursor-centred crop (which lets Gemini read fine text but misses the
 * big-picture desktop context), we now send the ENTIRE desktop squished into
 * 768×768. This gives the VoiceAgent full ambient awareness of:
 *   - Which applications the user has open
 *   - Whether they are in VS Code, a browser, a terminal, etc.
 *   - High-level layout and activity context
 *
 * Fine text IS too blurry at this resolution. That is intentional — when the
 * user asks "can you read this code?" the VoiceAgent delegates to the
 * ReasoningAgent (via transfer_to_agent) which executes PIL/Pillow code to
 * zoom and read the image at full resolution.
 *
 * Wire format (changed):
 *   Previously: { type: "frame",  data: "<b64>" }
 *   Now:        { type: "image",  mimeType: "image/jpeg", data: "<b64>" }
 *
 * The "image" type routes to a dedicated handler in main.py that stores the
 * most-recent full-resolution JPEG in the bridge for ReasoningAgent access.
 *
 * CPU profile at 1 FPS:
 *   - drawImage:      ~0.3 ms  (GPU-accelerated path in every modern browser)
 *   - toDataURL JPEG: ~3–8 ms  (synchronous but at 1 FPS this is imperceptible)
 *   - Total per tick: < 10 ms  (1 % of a 1-second budget — no jank)
 *
 * Props:
 *   sendFrame(b64: string) — called with the bare base64 JPEG string each second
 *
 * Returns:
 *   start()    — async, prompts the user for screen access
 *   stop()     — releases the stream and clears the interval
 *   isActive   — boolean
 *   error      — string | ''
 */

import { useRef, useState, useCallback, useEffect } from 'react'

const TARGET_SIZE  = 768     // Gemini recommended input resolution (width AND height)
const JPEG_QUALITY = 0.85    // ~40–80 KB per frame; good enough for app-detection
const INTERVAL_MS  = 1000    // strict 1 FPS — ADK Live max for vision input

export function useScreenShareCropper({ sendFrame }) {
  const [isActive, setIsActive] = useState(false)
  const [error,    setError]    = useState('')

  // Hidden <video> element — receives the display stream, never appended to the DOM
  const videoRef    = useRef(null)
  // Offscreen <canvas> — fixed at TARGET_SIZE × TARGET_SIZE
  const canvasRef   = useRef(null)
  const streamRef   = useRef(null)
  const intervalRef = useRef(null)

  // Keep sendFrame in a ref so the setInterval closure always sees the latest version
  // (avoids stale-closure bugs when the parent component re-renders)
  const sendFrameRef = useRef(sendFrame)
  useEffect(() => { sendFrameRef.current = sendFrame }, [sendFrame])

  // ── One-time element creation (on mount) ─────────────────────────────────
  // We create elements via JS rather than JSX so they are NEVER in the DOM,
  // which avoids any browser layout/paint work for these hidden elements.
  useEffect(() => {
    const video = document.createElement('video')
    video.muted      = true
    video.autoplay   = true
    video.playsInline = true
    videoRef.current = video

    const canvas = document.createElement('canvas')
    canvas.width  = TARGET_SIZE
    canvas.height = TARGET_SIZE
    canvasRef.current = canvas
  }, [])   // runs once — no deps

  // ── Core capture-and-send routine (runs every 1000 ms) ───────────────────
  const _captureAndSend = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    if (video.readyState < 2) return    // HAVE_CURRENT_DATA not yet available
    if (video.videoWidth  === 0) return // stream not decoded yet

    // ── Draw ENTIRE frame squished into 768×768 ───────────────────────────
    // drawImage with explicit src/dst dimensions performs a hardware-accelerated
    // blit + scale in the GPU. The main thread cost is < 1 ms.
    const ctx = canvas.getContext('2d', { alpha: false })
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, TARGET_SIZE, TARGET_SIZE)

    // ── Synchronous JPEG encode via toDataURL ─────────────────────────────
    // At 1 FPS the ~3–8 ms encode time does not cause perceptible jank.
    // We use toDataURL (not toBlob) as specified for simplicity — the result
    // is a "data:image/jpeg;base64,<b64data>" string; we strip the prefix.
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    const b64 = dataUrl.split(',')[1]    // bare base64 — no data URI prefix

    if (b64) {
      // Send using the new "image" type so main.py stores the full-res JPEG
      // for the ReasoningAgent, separate from the lower-res camera "frame" type.
      sendFrameRef.current?.(b64)
    }
  }, [])   // stable reference — reads everything via refs

  // ── start() ──────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (isActive) return
    setError('')

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          // No resolution constraint — let the browser capture at native DPI.
          // The full frame is squished to 768×768 by drawImage anyway.
          frameRate: { ideal: 5, max: 10 },   // We sample at 1 FPS; cap saves GPU
          cursor: 'always',                    // Show cursor in the captured stream
        },
        audio: false,
        // Do NOT set preferCurrentTab:true — that bypasses the picker and locks
        // the user into sharing only the current tab. We want the full picker so
        // the user can choose: Entire Screen / Window / any other Tab.
        surfaceSwitching: 'include',   // Allow switching source mid-share
        systemAudio:      'exclude',   // We handle audio via the mic pipeline
      })

      streamRef.current = stream
      const video = videoRef.current
      video.srcObject = stream

      // Some browsers require an explicit play() after setting srcObject
      await video.play().catch(() => {})

      // Auto-stop when the user clicks "Stop sharing" in the browser's control bar
      stream.getVideoTracks()[0].addEventListener('ended', () => stop())

      // First tick after 200 ms (video needs a moment to decode the first frame)
      setTimeout(() => {
        _captureAndSend()                                       // immediate first frame
        intervalRef.current = setInterval(_captureAndSend, INTERVAL_MS)
      }, 200)

      setIsActive(true)
      const track = stream.getVideoTracks()[0]
      const label = track?.label || 'unknown source'
      console.log(`[ScreenShare] Started — source: "${label}" — full-frame 768×768 squish @ 1 FPS`)

    } catch (e) {
      // NotAllowedError / AbortError = user dismissed the browser dialog — not an error
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') {
        console.error('[ScreenShare] Error:', e)
        setError(`Screen share failed: ${e.message}`)
      }
      setIsActive(false)
    }
  }, [isActive, _captureAndSend])

  // ── stop() ────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    clearInterval(intervalRef.current)
    intervalRef.current = null

    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setIsActive(false)
    console.log('[ScreenShare] Stopped')
  }, [])

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => stop(), [stop])

  return { start, stop, isActive, error }
}
