/**
 * useAudioPipeline.js
 * ====================
 * Manages the full browser audio pipeline:
 *
 *  CAPTURE path (mic → Gemini):
 *    getUserMedia → AudioContext(16kHz) → AudioWorklet(CaptureProcessor)
 *    → Int16Array chunks → passed to onPcmChunk callback
 *
 *  PLAYBACK path (Gemini → speaker):
 *    WebSocket binary frames → AudioContext(24kHz) → AudioWorklet(PlaybackProcessor)
 *    → speakers
 *    → amplitude reported via onAmplitude callback (for avatar lip sync)
 *
 * Usage:
 *   const audio = useAudioPipeline({ onPcmChunk, onAmplitude })
 *   audio.start()       — request mic, open AudioContexts
 *   audio.stop()        — close everything
 *   audio.playPcm(buf)  — queue a received Int16 ArrayBuffer for playback
 *   audio.setMuted(bool)— mute/unmute mic
 */

import { useRef, useCallback, useState } from 'react'

const CAPTURE_SAMPLE_RATE  = 16000   // Gemini input requires 16 kHz
const PLAYBACK_SAMPLE_RATE = 24000   // Gemini output is 24 kHz

export function useAudioPipeline({ onPcmChunk, onAmplitude }) {
  const captureCtx    = useRef(null)
  const playbackCtx   = useRef(null)
  const captureNode   = useRef(null)
  const playbackNode  = useRef(null)
  const sourceNode    = useRef(null)
  const micStream     = useRef(null)
  const muted         = useRef(false)
  const [isReady, setIsReady] = useState(false)
  const [micError, setMicError] = useState('')

  // ── Start ───────────────────────────────────────────────────
  const start = useCallback(async () => {
    try {
      // 1. Request microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: CAPTURE_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      micStream.current = stream

      // 2. Capture AudioContext at 16 kHz
      captureCtx.current = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE })
      await captureCtx.current.audioWorklet.addModule('/capture-processor.js')

      captureNode.current = new AudioWorkletNode(captureCtx.current, 'capture-processor')
      captureNode.current.port.onmessage = (e) => {
        if (!muted.current && onPcmChunk) {
          onPcmChunk(e.data.pcm)   // ArrayBuffer of Int16 samples
        }
      }

      // 3. Connect mic stream → worklet
      sourceNode.current = captureCtx.current.createMediaStreamSource(stream)
      sourceNode.current.connect(captureNode.current)
      captureNode.current.connect(captureCtx.current.destination) // needed on some browsers

      // 4. Playback AudioContext at 24 kHz
      playbackCtx.current = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE })
      await playbackCtx.current.audioWorklet.addModule('/playback-processor.js')

      playbackNode.current = new AudioWorkletNode(playbackCtx.current, 'playback-processor')
      playbackNode.current.port.onmessage = (e) => {
        if (e.data.amplitude !== undefined && onAmplitude) {
          onAmplitude(e.data.amplitude)
        }
      }
      playbackNode.current.connect(playbackCtx.current.destination)

      setIsReady(true)
      setMicError('')

    } catch (err) {
      console.error('[AudioPipeline] start error:', err)
      setMicError(err.message || 'Microphone access denied')
    }
  }, [onPcmChunk, onAmplitude])

  // ── Stop ────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    micStream.current?.getTracks().forEach(t => t.stop())
    sourceNode.current?.disconnect()
    captureNode.current?.disconnect()
    playbackNode.current?.disconnect()
    await captureCtx.current?.close().catch(() => {})
    await playbackCtx.current?.close().catch(() => {})

    captureCtx.current   = null
    playbackCtx.current  = null
    captureNode.current  = null
    playbackNode.current = null
    sourceNode.current   = null
    micStream.current    = null
    setIsReady(false)
  }, [])

  // ── Play PCM from Gemini ────────────────────────────────────
  const playPcm = useCallback((arrayBuffer) => {
    if (!playbackNode.current) return
    // Transfer ownership to worklet (zero-copy)
    try {
      playbackNode.current.port.postMessage(arrayBuffer, [arrayBuffer])
    } catch {
      // Fallback: copy (ArrayBuffer may already be detached)
      playbackNode.current.port.postMessage(arrayBuffer)
    }
  }, [])

  // ── Mute / Unmute ───────────────────────────────────────────
  const setMuted = useCallback((val) => {
    muted.current = val
  }, [])

  // ── Resume AudioContext (required after user gesture) ───────
  const resume = useCallback(async () => {
    await captureCtx.current?.resume()
    await playbackCtx.current?.resume()
  }, [])

  return { start, stop, playPcm, setMuted, resume, isReady, micError }
}
