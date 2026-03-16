/**
 * useSimliAvatar.js
 * ==================
 * React hook for Simli real-time talking avatar using simli-client@3.0.1
 *
 * ── simli-client v3 API ───────────────────────────────────────────────────
 *
 *  Constructor:
 *    new SimliClient(session_token, videoEl, audioEl, iceServers, logLevel, transport_mode)
 *    transport_mode = 'livekit'  → uses wss://api.simli.ai/compose/webrtc/livekit
 *    transport_mode = 'p2p'      → uses wss://api.simli.ai/compose/webrtc/p2p (needs iceServers)
 *
 *  Token endpoint:
 *    POST https://api.simli.ai/compose/token
 *    Body: { faceId, handleSilence, maxSessionLength, maxIdleTime }  ← ALL required
 *    Header: x-simli-api-key
 *
 *  Events: 'start', 'stop', 'startup_error', 'error'
 *
 * ── Audio flow ───────────────────────────────────────────────────────────
 *  Gemini → PCM16 @ 24 kHz → downsample to 16 kHz → client.sendAudioData()
 *  The <audio> element is MUTED — we play Gemini audio via our own
 *  AudioWorklet pipeline so AnalyserNode + interruption logic work correctly.
 *
 * ── Critical DOM-ref rule ────────────────────────────────────────────────
 *  The <video> and <audio> elements in InterviewRoom.jsx that hold these
 *  refs must NEVER be duplicated.  If two JSX elements share the same ref
 *  object, React will set the ref to whichever element is committed LAST —
 *  which may be a hidden/detached element.  Simli stores a direct pointer
 *  to the DOM element at construction time; if that element is invisible or
 *  later removed from the DOM, the video track plays there silently.
 */

import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { SimliClient } from 'simli-client'

// ── Simli session-token fetch ─────────────────────────────────────────────────
// Inline implementation matching the SDK's generateSimliSessionToken exactly.
// The SDK is CJS-only; inlining avoids Vite named-export interop issues.
//
// REQUIRED fields in body (all four must be present):
//   faceId          — avatar face identifier
//   handleSilence   — boolean, controls silence padding; MUST be present
//   maxSessionLength — seconds before server forces session end
//   maxIdleTime      — seconds of audio silence before auto-stop
async function fetchSimliSessionToken(apiKey, faceId, maxSessionLength = 3600, maxIdleTime = 120) {
  console.log('[Simli] Fetching session token for faceId:', faceId)
  const res = await fetch('https://api.simli.ai/compose/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-simli-api-key': apiKey,
    },
    body: JSON.stringify({
      faceId,
      // handleSilence: true restores Simli's server-side smoothing to cover 
      // network jitter and packet loss, while our client-side buffering 
      // ensures the input stream itself is smooth.
      handleSilence: true,
      maxSessionLength,
      maxIdleTime,
      // Optimized for low-latency talking avatar
      model: "fasttalk",
      is_trinity_avatar: true,
      remove_background: true,
    }),
  })

  // Read body text first so we can log it on both success and failure
  const bodyText = await res.text()
  console.log('[Simli] Token API response:', res.status, bodyText.substring(0, 300))

  // Simli sometimes returns 402 but STILL includes a valid session_token
  // (e.g. after upgrading mid-session). Try to parse before throwing.
  if (!res.ok) {
    try {
      const parsed = JSON.parse(bodyText)
      if (parsed?.session_token) {
        console.warn(`[Simli] Token API returned ${res.status} but included session_token — using it`)
        return parsed.session_token
      }
    } catch { /* not JSON, fall through to throw */ }
    throw new Error(`Simli /compose/token failed (HTTP ${res.status}): ${bodyText}`)
  }

  let data
  try {
    data = JSON.parse(bodyText)
  } catch {
    throw new Error(`Simli /compose/token returned invalid JSON: ${bodyText.substring(0, 100)}`)
  }

  if (!data?.session_token) {
    throw new Error(
      `Simli /compose/token response has no session_token field. ` +
      `Full response: ${JSON.stringify(data)}`
    )
  }

  console.log('[Simli] Session token obtained ✓ (first 20 chars):', String(data.session_token).substring(0, 20) + '…')
  return data.session_token
}



// ── WebSocket readyState name helper ─────────────────────────────────────────
function wsStateName(n) {
  return ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][n] ?? `UNKNOWN(${n})`
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useSimliAvatar({ apiKey, faceId, onConnected, onDisconnected }) {
  // These refs are attached to EXACTLY ONE <video> and ONE <audio> element in
  // InterviewRoom.jsx.  Do NOT share these refs between multiple JSX elements.
  const videoRef = useRef(null)
  const audioRef = useRef(null)

  const clientRef = useRef(null)   // active SimliClient instance
  const hasAttemptedRef = useRef(false)  // one-shot guard (SDK not reusable)
  const chunkCountRef = useRef(0)      // diagnostic counter for audio chunks sent
  const isConnectedRef = useRef(false)  // mirror of isConnected state (for sendPcm24kHz)

  // ── Audio Buffering ───────────────────────────────────────────────────────
  // Simli works best with stable blocks of ~3000 samples (6000 bytes at 16bit).
  // Accumulating tiny frequent bursts (10-20ms) from Gemini into stable blocks.
  const pcmBufferRef = useRef(new Uint8Array(0))
  const flushTimeoutRef = useRef(null)
  const lastChunkTimeRef = useRef(0)
  const BUFFER_THRESHOLD = 4000 // approx 125ms - allows for stable server-side jitter buffering

  // ── Waveform Continuity State ──────────────────────────────────────────────
  // maintains the last sample and fractional phase from the previous chunk
  // to ensure perfectly smooth linear interpolation across chunk boundaries.
  const resampleStateRef = useRef({ lastSample: 0, phase: 0 })

  /**
   * Downsample 24kHz to 16kHz using linear interpolation with waveform continuity.
   */
  const downsample24to16 = useCallback((arrayBuffer) => {
    const input = new Int16Array(arrayBuffer)
    const ratio = 16 / 24
    const outLength = Math.floor(input.length * ratio)
    if (outLength === 0) return new Uint8Array(0)

    // RESET state if there has been a significant gap (>500ms) to prevent phase drift
    const now = Date.now()
    if (now - lastChunkTimeRef.current > 500) {
      resampleStateRef.current = { lastSample: 0, phase: 0 }
    }
    lastChunkTimeRef.current = now

    const output = new Int16Array(outLength)
    const state = resampleStateRef.current
    const step = 24 / 16 // 1.5

    for (let i = 0; i < outLength; i++) {
      const inputPos = i * step + state.phase
      const index = Math.floor(inputPos)
      const fract = Math.max(0, Math.min(1, inputPos - index)) // Guard against NaN

      let s1, s2
      if (index < 0) {
        s1 = state.lastSample
        s2 = input[0]
      } else if (index < input.length - 1) {
        s1 = input[index]
        s2 = input[index + 1]
      } else if (index === input.length - 1) {
        s1 = input[index]
        s2 = s1
      } else {
        s1 = input[input.length - 1]
        s2 = s1
      }

      output[i] = s1 + fract * (s2 - s1)
    }

    state.lastSample = input[input.length - 1]
    state.phase = (outLength * step + state.phase) - input.length

    // EXPLICIT SYNC: Ensure we are sending 16kHz PCM16 Mono exactly.
    // If the input was suspiciously large (stereo or 48kHz), this will
    // still produce a valid 1x speed mono stream.
    return new Uint8Array(output.buffer)
  }, [])

  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // ── cleanup ───────────────────────────────────────────────────────────────
  const cleanup = useCallback(async () => {
    const client = clientRef.current
    clientRef.current = null
    if (client) {
      try { await client.stop() } catch { /* ignore errors on teardown */ }
    }
  }, [])

  // ── initialize ────────────────────────────────────────────────────────────
  const initialize = useCallback(async () => {
    if (!apiKey) { console.warn('[Simli] No API key — set VITE_SIMLI_API_KEY'); return }
    if (!faceId) { console.warn('[Simli] No face ID — set VITE_SIMLI_FACE_ID'); return }

    if (!videoRef.current) {
      console.warn('[Simli] videoRef.current is null — <video> element not mounted yet')
      return
    }
    if (!audioRef.current) {
      console.warn('[Simli] audioRef.current is null — <audio> element not mounted yet')
      return
    }

    if (isLoading || isConnected) return

    // One-shot guard: SimliClient v3 explicitly cannot be reused across sessions.
    if (hasAttemptedRef.current) {
      console.warn('[Simli] Already attempted — skipping duplicate initialize()')
      return
    }
    hasAttemptedRef.current = true

    console.log('[Simli] Initializing…  videoRef:', videoRef.current?.tagName, '  audioRef:', audioRef.current?.tagName)

    setIsLoading(true)
    setError('')

    try {
      // ── Step 1: Fetch session token ────────────────────────────────────────
      // Must include handleSilence (required by Simli API).
      const session_token = await fetchSimliSessionToken(apiKey, faceId)

      // ── Step 2: Create SimliClient v3 ─────────────────────────────────────
      // Constructor: (session_token, videoEl, audioEl, iceServers, logLevel, transport_mode)
      //   iceServers = null   → not required for livekit transport
      //   logLevel   = 2      → LogLevel.WARN (suppress debug spam)
      //   transport  = 'livekit' → uses /compose/webrtc/livekit endpoint
      //
      // IMPORTANT: The SimliClient stores a direct reference to videoEl and
      // audioEl at construction time. These elements must be the REAL visible
      // elements — not hidden placeholders — so the video track appears when
      // the session starts.
      const client = new SimliClient(
        session_token,
        videoRef.current,    // real <video> DOM element
        audioRef.current,    // real <audio> DOM element (will be muted by InterviewRoom)
        null,                // iceServers (null = livekit mode)
        2,                   // LogLevel.WARN
        'livekit',           // transport mode
      )
      clientRef.current = client

      // ── WebSocket lifecycle diagnostics ───────────────────────────────────
      // Monitor the signaling WebSocket so we know immediately if the server
      // closes it — a closed WS means sendAudioData calls will throw silently.
      try {
        const ws = client.connection?.signalingConnection?.wsConnection
        if (ws) {
          ws.addEventListener('close', (evt) => {
            console.warn(
              `[Simli] ⚠️  Signaling WebSocket CLOSED — code:${evt.code} reason:"${evt.reason}" ` +
              `clean:${evt.wasClean}. Audio will no longer reach Simli server.`
            )
          })
          ws.addEventListener('error', () => {
            console.warn('[Simli] ⚠️  Signaling WebSocket ERROR')
          })
        }
      } catch (e) {
        console.warn('[Simli] Could not attach WS lifecycle listeners:', e)
      }

      // ── CRITICAL TIMEOUT FIX ──────────────────────────────────────────────
      // SimliClient's constructor schedules a 15-second timeout that rejects
      // the connectionPromise if the first video frame hasn't rendered by then.
      // Livekit video typically takes 10–25 seconds to start on first connect
      // (WebSocket → room join → track publish → first frame).  If the timeout
      // fires first, start() retries with the SAME session token.  But since
      // the first attempt already sent "DONE" to the server, the server marks
      // that token invalid → second session gets an immediate STOP → avatar
      // flashes briefly then disappears.
      //
      // Fix: clear the 15s timer and replace with 60s.
      // TypeScript marks connectionTimeout / connectionReject as private, but
      // they are plain class fields in the compiled JS and fully accessible.
      try {
        clearTimeout(client.connectionTimeout)
        client.connectionTimeout = setTimeout(
          () => client.connectionReject('CONNECTION TIMED OUT'),
          60000   // 60 seconds — plenty for livekit first-frame latency
        )
        console.log('[Simli] Extended connection timeout: 15s → 60s')
      } catch (e) {
        console.warn('[Simli] Could not extend connection timeout (using default 15s):', e)
      }

      console.log('[Simli] SimliClient created, starting livekit connection…')

      // ── Step 3: Register event handlers ───────────────────────────────────
      // Must register BEFORE calling start() so no events are missed.

      client.on('start', () => {
        console.log('[Simli] ✅ Talking avatar is live!')
        isConnectedRef.current = true
        setIsLoading(false)
        setIsConnected(true)
        onConnected?.()
      })

      client.on('stop', () => {
        console.log('[Simli] Avatar stopped')
        isConnectedRef.current = false
        setIsConnected(false)
        setIsLoading(false)
        onDisconnected?.()
      })

      // startup_error: WebSocket or LiveKit connection failed before 'start'.
      // We call client.stop() to set shouldStop=true, which causes the SDK's
      // internal retry loop to abort on the next iteration instead of retrying
      // up to 10 more times (150+ seconds).
      client.on('startup_error', (reason) => {
        const msg = typeof reason === 'string' ? reason : 'Startup failed'
        console.warn('[Simli] Startup error — aborting retries:', msg)
        // Stop retries immediately (shouldStop = true halts recursive start() calls)
        client.stop().catch(() => { })
        setError(msg)
        setIsLoading(false)
        setIsConnected(false)
        clientRef.current = null
        onDisconnected?.()
      })

      client.on('error', (reason) => {
        const msg = typeof reason === 'string' ? reason : 'Runtime error'
        console.warn('[Simli] Runtime error:', msg)
        setError(msg)
        setIsConnected(false)
        setIsLoading(false)
      })

      // ── Speaking diagnostics ───────────────────────────────────────────────
      // 'speaking' fires when the server detects it IS rendering lip-sync frames.
      // If we never see this log, the server is NOT receiving our PCM audio.
      client.on('speaking', () => console.log('[Simli] 🗣  Server: speaking (audio received ✓)'))
      client.on('silent', () => console.log('[Simli] 🤫  Server: silent'))

      // ── Step 4: Start — connect WebSocket, join LiveKit room, receive video ─
      await client.start()
      // When start() resolves, the 'start' event has already fired (livekit mode).
      console.log('[Simli] client.start() resolved — avatar session active')

    } catch (err) {
      const msg = err?.message || String(err) || 'Failed to start avatar'
      console.warn('[Simli] initialize() failed — using GeminiAvatar fallback:', msg)
      setError(msg)
      setIsLoading(false)
      setIsConnected(false)
      // Reset one-shot guard so user can retry after fixing credits/config
      hasAttemptedRef.current = false
      const client = clientRef.current
      clientRef.current = null
      if (client) { try { await client.stop() } catch { /* ignore */ } }
      onDisconnected?.()
    }
  }, [apiKey, faceId, isLoading, isConnected, onConnected, onDisconnected])

  // ── sendPcm24kHz ──────────────────────────────────────────────────────────
  // Called on every Gemini audio chunk. Downsamples 24→16 kHz and sends to
  // Simli for real-time lip sync.
  //
  // sendAudioDataImmediate = prepends "PLAY_IMMEDIATE" — Simli renders lips
  //   in real-time as each chunk arrives.
  // sendAudioData = buffered — Simli waits for a phrase before rendering,
  //   causing ~1-2s lag.  Used as fallback if PLAY_IMMEDIATE mode fails.
  const sendPcm24kHz = useCallback((arrayBuffer) => {
    const client = clientRef.current
    if (!client) return

    // Only send audio after the 'start' event fires — before that the LiveKit
    // room isn't fully set up and the server may not accept audio data.
    if (!isConnectedRef.current) return

    // ── Diagnose WebSocket state: first 3 chunks + every 50th ────────────
    const n = ++chunkCountRef.current
    if (n <= 3 || n % 50 === 0) {
      try {
        const ws = client.connection?.signalingConnection?.wsConnection
        const state = wsStateName(ws?.readyState ?? -1)
        console.log(`[Simli] 🎵 sendPcm chunk #${n} — WS:${state}`)
      } catch { /* non-fatal */ }
    }

    try {
      const pcm16 = downsample24to16(arrayBuffer)

      // Clear any pending flush timer
      if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current)

      // Accumulate in buffer
      const newBuf = new Uint8Array(pcmBufferRef.current.length + pcm16.length)
      newBuf.set(pcmBufferRef.current, 0)
      newBuf.set(pcm16, pcmBufferRef.current.length)
      pcmBufferRef.current = newBuf

      const doSend = (buf) => {
        // Standard sendAudioData allows Simli server to smooth jitter.
        // Immediate mode clears the buffer every time, which can cause choppiness.
        client.sendAudioData(buf)
      }

      // If we hit threshold, send immediately
      if (pcmBufferRef.current.length >= BUFFER_THRESHOLD) {
        const toSend = pcmBufferRef.current
        pcmBufferRef.current = new Uint8Array(0)
        doSend(toSend)
      } else {
        // Otherwise, schedule a flush in 150ms to catch the end of speech
        flushTimeoutRef.current = setTimeout(() => {
          if (pcmBufferRef.current.length > 0) {
            const toSend = pcmBufferRef.current
            pcmBufferRef.current = new Uint8Array(0)
            doSend(toSend)
          }
        }, 150)
      }
    } catch (e) {
      // Log the error — this tells us WHY audio isn't reaching Simli
      console.warn('[Simli] ⚠️  sendAudioData FAILED:', String(e))
    }
  }, [])

  // ── close ─────────────────────────────────────────────────────────────────
  const close = useCallback(async () => {
    await cleanup()
    setIsConnected(false)
    setIsLoading(false)
    console.log('[Simli] Session closed')
  }, [cleanup])

  // Cleanup on unmount
  useEffect(() => () => { cleanup() }, [cleanup])

  // ── clearBuffer ───────────────────────────────────────────────────────────
  const clearBuffer = useCallback(() => {
    if (clientRef.current) {
      console.log('[Simli] Clearing audio buffer (interruption)')
      pcmBufferRef.current = new Uint8Array(0) // Clear JS-side buffer too
      clientRef.current.ClearBuffer()
    }
  }, [])

  // ── Stable Return Object ──────────────────────────────────────────────────
  return useMemo(() => ({
    videoRef,
    audioRef,
    isConnected,
    isLoading,
    error,
    initialize,
    close,
    sendPcm24kHz,
    clearBuffer,
  }), [videoRef, audioRef, isConnected, isLoading, error, initialize, close, sendPcm24kHz, clearBuffer])
}
