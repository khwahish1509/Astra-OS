/**
 * useSimliAvatar.js
 * ==================
 * Manages the Simli real-time photorealistic avatar.
 *
 * What Simli does:
 *   - Accepts PCM16 audio @ 16 kHz via sendAudioData(Uint8Array)
 *   - Returns a lip-synced WebRTC video + audio stream in real time
 *   - Sub-300ms latency from audio in → visible mouth movement
 *
 * Audio handoff strategy:
 *   When Simli connects, InterviewRoom mutes the AudioWorklet playback
 *   (setPlaybackVolume(0)) so audio comes exclusively from Simli's WebRTC
 *   <audio> element — perfectly synced with the avatar's lip movements.
 *   If Simli disconnects, volume is restored to 1 and the GeminiAvatar
 *   SVG fallback takes over automatically.
 *
 * Gemini outputs PCM16 @ 24 kHz. Simli expects PCM16 @ 16 kHz.
 * We downsample 24 → 16 kHz here using simple decimation (good enough
 * for speech; keeps latency near zero compared to a resampler).
 *
 * Usage:
 *   const simli = useSimliAvatar({ apiKey, faceId, onConnected, onDisconnected })
 *   simli.initialize()           — start WebRTC session (call after user gesture)
 *   simli.sendPcm24kHz(buf)      — forward PCM from Gemini to avatar
 *   simli.close()                — cleanly end the session
 *
 *   // Mount these in JSX — always rendered, display toggled by CSS:
 *   <video ref={simli.videoRef} autoPlay playsInline />
 *   <audio ref={simli.audioRef} autoPlay />
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import { SimliClient } from 'simli-client'

// ── Constants ────────────────────────────────────────────────────────────────

const GEMINI_RATE = 24000    // Gemini Live output sample rate
const SIMLI_RATE  = 16000    // Simli required input sample rate
const RATIO       = GEMINI_RATE / SIMLI_RATE   // = 1.5

// ── Downsampler ──────────────────────────────────────────────────────────────
/**
 * Downsample PCM16 from 24 kHz → 16 kHz.
 *
 * Uses simple decimation: pick every N-th sample (ratio = 1.5).
 * For speech this is transparent — no audible aliasing in the 0-8 kHz
 * range that Simli's neural renderer uses for lip sync.
 *
 * @param  {ArrayBuffer} buf  — raw PCM16 @ 24 kHz from Gemini
 * @returns {Uint8Array}       — raw PCM16 bytes @ 16 kHz for Simli
 */
function downsample24to16(buf) {
  const src = new Int16Array(buf)
  const len = Math.floor(src.length / RATIO)
  const dst = new Int16Array(len)
  for (let i = 0; i < len; i++) {
    dst[i] = src[Math.floor(i * RATIO)]
  }
  return new Uint8Array(dst.buffer)
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string}    opts.apiKey        — Simli API key (VITE_SIMLI_API_KEY)
 * @param {string}    opts.faceId        — Simli face ID for this persona
 * @param {Function?} opts.onConnected   — called when WebRTC stream is live
 * @param {Function?} opts.onDisconnected— called when stream ends/fails
 */
export function useSimliAvatar({ apiKey, faceId, onConnected, onDisconnected }) {
  // Refs
  const clientRef = useRef(null)
  const videoRef  = useRef(null)   // <video> DOM element — attach to JSX
  const audioRef  = useRef(null)   // <audio> DOM element — attach to JSX

  // State — drives what InterviewRoom renders
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading,   setIsLoading]   = useState(false)
  const [error,       setError]       = useState('')

  // ── initialize ─────────────────────────────────────────────────────────────
  /**
   * Starts the Simli WebRTC session. Call this once after the user gesture
   * (i.e., after they click "Allow Mic & Begin") because WebRTC requires
   * the page to be active and audio context to be running.
   */
  const initialize = useCallback(async () => {
    if (!apiKey) {
      console.warn('[Simli] No API key — avatar disabled. Set VITE_SIMLI_API_KEY.')
      return
    }
    if (!faceId) {
      console.warn('[Simli] No face ID — avatar disabled. Set simli_face_id on your persona.')
      return
    }
    if (!videoRef.current || !audioRef.current) {
      console.warn('[Simli] video/audio elements not yet mounted.')
      return
    }

    if (isLoading || isConnected) return  // prevent double-init from React StrictMode

    setIsLoading(true)
    setError('')

    try {
      // ── Step 1: Pre-fetch the Simli session token ourselves ─────────────────
      // SimliClient.start() runs getIceServers() + createSessionToken() in
      // parallel. getIceServers() returns 404 (endpoint doesn't exist) and
      // retries 100× with 2s delay = 200 seconds before falling back to Google
      // STUN. We bypass this entirely by:
      //   a) fetching the session token here (fast, ~200ms)
      //   b) pre-setting it on the client via Initialize()
      //   c) calling start(googleStunServers) — skips getIceServers() entirely
      console.log('[Simli] Fetching session token...')
      const tokenResp = await fetch('https://api.simli.ai/startAudioToVideoSession', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          faceId:           faceId,
          isJPG:            false,
          apiKey:           apiKey,
          syncAudio:        true,
          handleSilence:    true,
          maxSessionLength: 3600,
          maxIdleTime:      120,
        }),
      })

      // Always parse the JSON body — Simli returns a session_token even on 400
      // when the face ID is invalid (INVALID_FACE_ID), using their default face.
      // Only hard-fail if there is no session_token at all.
      let tokenBody = null
      try { tokenBody = await tokenResp.json() } catch { /* non-JSON error body */ }

      if (!tokenBody?.session_token) {
        // No token at all — hard fail (e.g. invalid API key, malformed request)
        throw new Error(
          `Simli session init failed (${tokenResp.status}): ` +
          (tokenBody ? JSON.stringify(tokenBody) : 'empty response')
        )
      }

      if (!tokenResp.ok) {
        // Soft error — face ID not found, Simli falls back to a default face
        console.warn(
          `[Simli] ⚠ Face ID "${faceId}" not found in your account ` +
          `(${tokenBody.detail}). Using Simli default face. ` +
          `Go to https://app.simli.com → Faces to get a valid ID, ` +
          `then set VITE_SIMLI_FACE_ID in your .env`
        )
      }

      const { session_token } = tokenBody
      console.log('[Simli] Session token received ✓', tokenResp.ok ? '' : '(default face)')

      // ── Step 2: Initialize client with token pre-loaded ─────────────────────
      const client = new SimliClient()
      clientRef.current = client

      client.Initialize({
        apiKey,
        faceID:            faceId,
        session_token,               // pre-set → WS handler sends it directly, no extra fetch
        handleSilence:     true,
        maxSessionLength:  3600,
        maxIdleTime:       120,
        videoRef:          videoRef.current,   // must be actual DOM element, not React ref
        audioRef:          audioRef.current,
        maxRetryAttempts:  3,        // cap retries — default 100 is way too aggressive
        retryDelay_ms:     1000,
        enableConsoleLogs: false,
      })

      // ── Step 3: start() with ICE servers provided → skips getIceServers() ───
      // Passing a non-empty iceServers array causes SimliClient to skip its
      // getIceServers() call entirely and go straight to WebSocket + WebRTC.
      await client.start([{ urls: ['stun:stun.l.google.com:19302'] }])

      setIsLoading(false)
      setIsConnected(true)
      onConnected?.()

      console.log('[Simli] ✅ Connected — avatar is live')
    } catch (err) {
      console.error('[Simli] ❌ Connection failed:', err)
      setError(err?.message || 'Simli connection failed')
      setIsLoading(false)
      setIsConnected(false)
      onDisconnected?.()
      clientRef.current = null
    }
  }, [apiKey, faceId, isLoading, isConnected, onConnected, onDisconnected])

  // ── sendPcm24kHz ──────────────────────────────────────────────────────────
  /**
   * Forward PCM audio from Gemini (24 kHz ArrayBuffer) to Simli (16 kHz).
   * Call this every time a PCM chunk arrives from the WebSocket, alongside
   * audio.playPcm() which feeds the AudioWorklet for amplitude tracking.
   *
   * @param {ArrayBuffer} arrayBuffer  — PCM16 @ 24 kHz from Gemini
   */
  const sendPcm24kHz = useCallback((arrayBuffer) => {
    if (!clientRef.current || !isConnected) return
    try {
      const pcm16kHz = downsample24to16(arrayBuffer)
      clientRef.current.sendAudioData(pcm16kHz)
    } catch (err) {
      // Log but don't throw — a dropped frame is better than crashing
      console.warn('[Simli] sendAudioData error:', err)
    }
  }, [isConnected])

  // ── close ─────────────────────────────────────────────────────────────────
  /**
   * Cleanly end the Simli session. Called when the user ends the session
   * or when the component unmounts. Safe to call multiple times.
   */
  const close = useCallback(() => {
    if (!clientRef.current) return
    try {
      clientRef.current.close()
    } catch { /* ignore */ }
    clientRef.current = null
    setIsConnected(false)
    setIsLoading(false)
    onDisconnected?.()
    console.log('[Simli] Session closed')
  }, [onDisconnected])

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      try { clientRef.current?.close() } catch { /* ignore */ }
    }
  }, [])

  return {
    // Refs — attach these to <video> and <audio> elements in JSX
    videoRef,
    audioRef,

    // State
    isConnected,
    isLoading,
    error,

    // Actions
    initialize,
    sendPcm24kHz,
    close,
  }
}
