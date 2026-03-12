/**
 * useSimliAvatar.js
 * ==================
 * Direct WebRTC implementation for the Simli avatar.
 *
 * ── KEY FINDING (from official simli-client source) ──────────────────────────
 *   Audio PCM is sent via the SAME WebSocket used for SDP/ICE signalling,
 *   NOT via the RTCDataChannel.  The data channel is created only to satisfy
 *   the WebRTC handshake — Simli ignores audio bytes sent on it.
 *
 *   Official simli-client sendAudioData():
 *     this.webSocket.send(audioData)   ← WebSocket binary frame
 *
 *   We replicate this exactly.  After "START" is received the WebSocket
 *   accepts raw Uint8Array binary frames as PCM16 @ 16 kHz.
 *
 * ── Simli compose API (v2) ────────────────────────────────────────────────────
 *   Token:     POST https://api.simli.ai/compose/token
 *              Header: x-simli-api-key: <apiKey>
 *              Body:   { faceId, maxSessionLength, maxIdleTime }
 *
 *   WebSocket: wss://api.simli.ai/compose/webrtc/p2p?session_token=<token>
 *
 *   Signalling messages (text frames, JSON):
 *     → { type:"offer", sdp:"..." }      (SDP offer)
 *     ← { type:"answer", sdp:"..." }     (SDP answer)
 *     → / ← { type:"candidate", ... }   (trickle ICE)
 *
 *   Control messages (text frames, plain strings):
 *     ← "START"                 avatar is live — begin sending audio
 *     ← "STOP"                  session ended
 *     ← "SPEAK" / "SILENT"      avatar speaking state
 *     ← "ACK"                   heartbeat ack
 *     ← "MISSING_SESSION_TOKEN" re-send token
 *
 *   Audio input (binary frames):
 *     → Uint8Array   PCM16 @ 16 kHz   sent AFTER "START" via ws.send()
 *
 *   Audio/video output:
 *     ← WebRTC audio track  (received on <audio> element via srcObject)
 *     ← WebRTC video track  (received on <video> element via srcObject)
 */

import { useRef, useState, useCallback, useEffect } from 'react'

// ── Constants ────────────────────────────────────────────────────────────────
const SIMLI_API   = 'https://api.simli.ai'
const SIMLI_WS    = 'wss://api.simli.ai'
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]
const WS_TIMEOUT  = 15000   // ms to wait for WebSocket to open + START
const ICE_TIMEOUT = 4000    // ms for ICE gathering

const GEMINI_RATE = 24000
const SIMLI_RATE  = 16000
const RATIO       = GEMINI_RATE / SIMLI_RATE   // 1.5

// ── Helpers ──────────────────────────────────────────────────────────────────

function downsample24to16(buf) {
  const src = new Int16Array(buf)
  const len = Math.floor(src.length / RATIO)
  const dst = new Int16Array(len)
  for (let i = 0; i < len; i++) dst[i] = src[Math.floor(i * RATIO)]
  return new Uint8Array(dst.buffer)
}

function waitForIce(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return }
    const check = () => { if (pc.iceGatheringState === 'complete') resolve() }
    pc.addEventListener('icegatheringstatechange', check)
    setTimeout(resolve, ICE_TIMEOUT)
  })
}

// ── Token fetching (tries v2 compose API first, falls back to legacy) ────────
async function fetchSessionToken(apiKey, faceId) {
  // ── Try v2 compose API ────────────────────────────────────────────────────
  try {
    const r = await fetch(`${SIMLI_API}/compose/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-simli-api-key': apiKey,
      },
      body: JSON.stringify({ faceId, maxSessionLength: 3600, maxIdleTime: 120 }),
    })
    const body = await r.json().catch(() => null)
    if (body?.session_token) {
      console.log('[Simli] Token via /compose/token ✓')
      return body.session_token
    }
    console.warn('[Simli] /compose/token response:', r.status, body)
  } catch (e) {
    console.warn('[Simli] /compose/token failed:', e.message)
  }

  // ── Fall back to legacy /startAudioToVideoSession ─────────────────────────
  console.log('[Simli] Falling back to /startAudioToVideoSession...')
  const r = await fetch(`${SIMLI_API}/startAudioToVideoSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      faceId, isJPG: false, apiKey,
      syncAudio: true, handleSilence: true,
      maxSessionLength: 3600, maxIdleTime: 120,
    }),
  })
  const body = await r.json().catch(() => null)
  if (!body?.session_token) {
    throw new Error(
      `Token fetch failed (${r.status}): ` +
      (body ? JSON.stringify(body) : 'empty response')
    )
  }
  if (!r.ok) console.warn('[Simli] Legacy token warning:', body.detail)
  console.log('[Simli] Token via /startAudioToVideoSession ✓')
  return body.session_token
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useSimliAvatar({ apiKey, faceId, onConnected, onDisconnected }) {
  const videoRef        = useRef(null)
  const audioRef        = useRef(null)
  const pcRef           = useRef(null)
  const dcRef           = useRef(null)   // data channel — for WebRTC handshake only
  const wsRef           = useRef(null)   // WebSocket — used for signalling AND audio
  const sessionReadyRef = useRef(false)  // true after "START" received; gates audio sending

  const [isConnected, setIsConnected] = useState(false)
  const [isLoading,   setIsLoading]   = useState(false)
  const [error,       setError]       = useState('')

  // ── cleanup ───────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    sessionReadyRef.current = false
    try { wsRef.current?.close() } catch { /* ignore */ }
    try { dcRef.current?.close() } catch { /* ignore */ }
    try { pcRef.current?.close() } catch { /* ignore */ }
    wsRef.current = null
    dcRef.current = null
    pcRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    if (audioRef.current) audioRef.current.srcObject = null
  }, [])

  // ── initialize ────────────────────────────────────────────────────────────
  const initialize = useCallback(async () => {
    if (!apiKey)  { console.warn('[Simli] No API key.');  return }
    if (!faceId)  { console.warn('[Simli] No face ID.'); return }
    if (!videoRef.current || !audioRef.current) {
      console.warn('[Simli] video/audio elements not mounted.'); return
    }
    if (isLoading || isConnected) return

    setIsLoading(true)
    setError('')

    try {
      // ── 1. Session token ────────────────────────────────────────────────
      const session_token = await fetchSessionToken(apiKey, faceId)

      // ── 2. RTCPeerConnection ─────────────────────────────────────────────
      cleanup()
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pcRef.current = pc

      // Data channel — required by Simli for WebRTC connection establishment.
      // Audio is NOT sent here; it goes via the WebSocket (see sendPcm24kHz).
      const dc = pc.createDataChannel('chat', { ordered: true })
      dcRef.current = dc

      // Receive avatar video + audio tracks from Simli
      pc.addEventListener('track', (evt) => {
        console.log('[Simli] Track received:', evt.track.kind)
        const stream = evt.streams?.[0] ?? new MediaStream([evt.track])

        if (evt.track.kind === 'video' && videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(e => console.warn('[Simli] video play() failed:', e))
        } else if (evt.track.kind === 'audio' && audioRef.current) {
          audioRef.current.srcObject = stream
          // Explicit .play() required — browsers block autoPlay on WebRTC srcObject
          audioRef.current.play().catch(e => console.warn('[Simli] audio play() failed:', e))
          console.log('[Simli] Audio srcObject set ✓, play() called')
        }
      })

      // ICE candidates: forward to Simli via WebSocket (trickle ICE)
      const pendingCandidates = []
      let wsReady = false
      pc.addEventListener('icecandidate', (evt) => {
        if (!evt.candidate) return
        const msg = JSON.stringify({
          type: 'candidate',
          candidate: evt.candidate.candidate,
          sdpMLineIndex: evt.candidate.sdpMLineIndex,
          sdpMid: evt.candidate.sdpMid,
        })
        if (wsReady && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(msg)
        } else {
          pendingCandidates.push(msg)
        }
      })

      // Simli sends A/V to us; we only receive
      pc.addTransceiver('audio', { direction: 'recvonly' })
      pc.addTransceiver('video', { direction: 'recvonly' })

      // Build SDP offer
      await pc.setLocalDescription(await pc.createOffer())
      await waitForIce(pc)

      // ── 3. WebSocket — compose/webrtc/p2p endpoint ───────────────────────
      const wsUrl = `${SIMLI_WS}/compose/webrtc/p2p?session_token=${encodeURIComponent(session_token)}`
      console.log('[Simli] Connecting WebSocket (compose API)...')
      const ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'   // receive binary as ArrayBuffer
      wsRef.current = ws

      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Simli WebSocket timeout')),
          WS_TIMEOUT
        )

        ws.addEventListener('open', () => {
          console.log('[Simli] WebSocket open ✓')
          wsReady = true
          // Send SDP offer as JSON text frame
          ws.send(JSON.stringify(pc.localDescription))
          // Flush ICE candidates that arrived before WS opened
          pendingCandidates.forEach(c => ws.send(c))
          pendingCandidates.length = 0
        })

        ws.addEventListener('message', async (evt) => {
          // Audio frames from Simli come as binary — ignore them here
          if (evt.data instanceof ArrayBuffer) return

          const raw = typeof evt.data === 'string' ? evt.data : null
          if (!raw) return

          // ── Control messages (plain strings) ──────────────────────────
          if (raw === 'START') {
            clearTimeout(timer)
            // Flag: WebSocket now accepts binary audio frames
            sessionReadyRef.current = true
            // Warm-up: send 6000 bytes of silence (= 187.5ms @ 16kHz mono PCM16)
            // This matches the official simli-client START handler exactly.
            ws.send(new Uint8Array(6000))
            console.log('[Simli] ✅ Avatar live — audio path: WebSocket binary')
            setIsLoading(false)
            setIsConnected(true)
            onConnected?.()
            resolve()
            return
          }
          if (raw === 'STOP') {
            clearTimeout(timer)
            sessionReadyRef.current = false
            reject(new Error('Simli ended session (STOP)'))
            return
          }
          if (raw === 'MISSING_SESSION_TOKEN') {
            ws.send(session_token)
            return
          }
          // Silently ignore known non-JSON control strings
          if (raw === 'SILENT' || raw === 'SPEAK' || raw === 'ACK') return

          // ── Signalling messages (JSON) ─────────────────────────────────
          try {
            const msg = JSON.parse(raw)
            if (msg.type === 'answer') {
              await pc.setRemoteDescription(new RTCSessionDescription(msg))
              console.log('[Simli] SDP answer set ✓')
            } else if (msg.type === 'candidate' && msg.candidate) {
              await pc.addIceCandidate(new RTCIceCandidate({
                candidate: msg.candidate,
                sdpMLineIndex: msg.sdpMLineIndex,
                sdpMid: msg.sdpMid,
              }))
            }
          } catch (e) {
            console.warn('[Simli] WS message parse error:', e.message)
          }
        })

        ws.addEventListener('error', (e) => {
          clearTimeout(timer)
          reject(new Error(`Simli WebSocket error: ${e.message || 'connection refused'}`))
        })

        ws.addEventListener('close', (evt) => {
          sessionReadyRef.current = false
          if (!isConnected) {
            reject(new Error(`WS closed before START (code ${evt.code})`))
          } else {
            setIsConnected(false)
            onDisconnected?.()
          }
        })
      })

    } catch (err) {
      console.error('[Simli] ❌ Connection failed:', err.message)
      setError(err.message)
      setIsLoading(false)
      setIsConnected(false)
      cleanup()
      onDisconnected?.()
    }
  }, [apiKey, faceId, isLoading, isConnected, onConnected, onDisconnected, cleanup])

  // ── sendPcm24kHz ──────────────────────────────────────────────────────────
  //
  // *** THE CRITICAL FIX ***
  // Audio must be sent via ws.send(binary) — NOT dc.send().
  // This matches the official simli-client sendAudioData() exactly:
  //   this.webSocket.send(audioData)
  //
  // Empty deps array: reads wsRef / sessionReadyRef at call-time (always fresh).
  // No stale-closure issues — same function instance captured by ws.onmessage.
  //
  const sendPcm24kHz = useCallback((arrayBuffer) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (!sessionReadyRef.current) return   // don't send before START
    try {
      ws.send(downsample24to16(arrayBuffer))   // binary frame → WebSocket
    } catch (e) {
      console.warn('[Simli] send error:', e.message)
    }
  }, [])  // empty deps — refs are read at call-time

  // ── close ─────────────────────────────────────────────────────────────────
  const close = useCallback(() => {
    cleanup()
    setIsConnected(false)
    setIsLoading(false)
    onDisconnected?.()
    console.log('[Simli] Closed')
  }, [cleanup, onDisconnected])

  useEffect(() => () => cleanup(), [cleanup])

  return { videoRef, audioRef, isConnected, isLoading, error, initialize, sendPcm24kHz, close }
}
