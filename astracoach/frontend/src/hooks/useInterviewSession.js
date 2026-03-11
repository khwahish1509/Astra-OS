/**
 * useInterviewSession.js
 * ========================
 * Manages the WebSocket connection and coordinates the full
 * interview session state machine.
 *
 *  States:  idle → connecting → ready → active → ended
 *
 *  Handles:
 *    - WS lifecycle (connect, reconnect, close)
 *    - Routing binary frames to audio pipeline playback
 *    - Routing JSON control messages to state updates
 *    - Sending camera frames at throttled rate
 *    - Transcript accumulation
 */

import { useRef, useState, useCallback, useEffect } from 'react'

const FRAME_SEND_INTERVAL_MS = 1000   // camera frame every 1s
const MAX_TRANSCRIPT_ENTRIES = 60

export function useInterviewSession({
  sessionId,
  wsBaseUrl,
  onPcmReceived,
  onAmplitudeFromServer,
  onInterrupted,
  onResumeAudio,
}) {
  const wsRef = useRef(null)
  const frameTimerRef = useRef(null)
  const videoRef = useRef(null)   // set externally via setVideoRef
  const canvasRef = useRef(document.createElement('canvas'))

  const [wsState, setWsState] = useState('idle')  // idle|connecting|ready|active|ended
  const [avatarState, setAvatarState] = useState('idle')  // idle|listening|thinking|speaking
  const [transcript, setTranscript] = useState([])
  const [activeTool, setActiveTool] = useState(null)
  const [error, setError] = useState('')

  // ── Callbacks ───────────────────────────────────────────────
  const handleSpeechStart = useCallback(() => {
    // If the websocket is open, send an explicit activity_start to interrupt the model
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'activity_start' }))
    }
  }, [])

  const handleSpeechEnd = useCallback(() => {
    // If the websocket is open, send an explicit activity_end to signal the end of speech
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'activity_end' }))
    }
  }, [])

  // ── Connect ───────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (!sessionId) return

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = wsBaseUrl
      ? wsBaseUrl.replace(/^https?:\/\//, '')
      : window.location.host
    const url = `${protocol}://${host}/ws/interview/${sessionId}`

    setWsState('connecting')
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      setWsState('ready')
      // Ping to keep alive
      setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
        }
      }, 20000)
    }

    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        // Binary = PCM16 audio from Gemini → play it
        onPcmReceived?.(evt.data)
      } else {
        // Text = JSON control message
        try {
          const msg = JSON.parse(evt.data)
          _handleControl(msg)
        } catch {/* ignore malformed */ }
      }
    }

    ws.onerror = (e) => {
      console.error('[WS] Error:', e)
      setError('WebSocket error — check backend is running')
    }

    ws.onclose = () => {
      setWsState('ended')
      clearInterval(frameTimerRef.current)
    }

    // Start camera frame loop
    frameTimerRef.current = setInterval(_sendCameraFrame, FRAME_SEND_INTERVAL_MS)

  }, [sessionId, wsBaseUrl])

  // ── Disconnect ────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    clearInterval(frameTimerRef.current)
    wsRef.current?.close()
    setWsState('ended')
    setAvatarState('idle')
  }, [])

  // ── Handle control messages ───────────────────────────────────
  const _handleControl = (msg) => {
    switch (msg.type) {
      case 'ready':
        setWsState('active')
        setAvatarState('listening')
        break

      case 'interrupted':
        onInterrupted?.()
        break

      case 'status':
        setAvatarState(msg.state || 'idle')
        // Re-open the audio worklet gate when agent is in listening state
        if (msg.state === 'listening') {
          onResumeAudio?.()
        }
        break

      case 'transcript':
        setTranscript(prev => {
          const entry = { role: msg.role, text: msg.text, ts: Date.now() }
          return [...prev.slice(-MAX_TRANSCRIPT_ENTRIES + 1), entry]
        })
        break

      case 'tool_call':
        setActiveTool(msg.status === 'running' ? msg.name : null)
        break

      case 'error':
        setError(msg.message || 'Unknown error')
        setAvatarState('idle')
        break

      case 'pong':
        break  // keep-alive ack

      default:
        break
    }
  }

  // ── Send camera frame ─────────────────────────────────────────
  const _sendCameraFrame = useCallback(() => {
    const ws = wsRef.current
    const vid = videoRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !vid) return
    if (vid.readyState < 2) return  // not enough data

    const canvas = canvasRef.current
    canvas.width = 320
    canvas.height = 240
    const ctx = canvas.getContext('2d')
    ctx.drawImage(vid, 0, 0, 320, 240)
    const b64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1]
    ws.send(JSON.stringify({ type: 'frame', data: b64 }))
  }, [])

  // ── Send raw PCM to Gemini ────────────────────────────────────
  const sendPcm = useCallback((pcmBuffer) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(pcmBuffer)
    }
  }, [])

  // ── Inject vision note explicitly ─────────────────────────────
  const injectVision = useCallback((note) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'vision_inject', note }))
    }
  }, [])

  // ── Expose video ref setter ───────────────────────────────────
  const setVideoRef = useCallback((el) => {
    videoRef.current = el
  }, [])

  // ── Cleanup on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearInterval(frameTimerRef.current)
      wsRef.current?.close()
    }
  }, [])

  return {
    connect,
    disconnect,
    sendPcm,
    injectVision,
    setVideoRef,
    wsState,
    avatarState,
    transcript,
    activeTool,
    error,
    onSpeechStart: handleSpeechStart,
    onSpeechEnd: handleSpeechEnd
  }
}
