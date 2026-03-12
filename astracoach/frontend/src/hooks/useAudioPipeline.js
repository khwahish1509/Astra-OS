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
 *    → GainNode → AnalyserNode → speakers
 *
 *  AnalyserNode (FFT tap for avatar animation):
 *    Inserted between GainNode and destination.
 *    fftSize=256 → 128 frequency bins at 24kHz (93.75 Hz/bin).
 *    Exposed as `analyserNode` state — GeminiAvatar reads it in a
 *    requestAnimationFrame loop at 60fps without any React re-renders.
 *
 * Usage:
 *   const audio = useAudioPipeline({ onPcmChunk, onSpeechStart, onSpeechEnd })
 *   audio.start()       — request mic, open AudioContexts
 *   audio.stop()        — close everything
 *   audio.playPcm(buf)  — queue a received Int16 ArrayBuffer for playback
 *   audio.setMuted(bool)— mute/unmute mic
 *   audio.analyserNode  — Web Audio AnalyserNode for FFT avatar (null until start())
 */

import { useRef, useCallback, useState } from 'react'

const CAPTURE_SAMPLE_RATE  = 16000   // Gemini input requires 16 kHz
const PLAYBACK_SAMPLE_RATE = 24000   // Gemini output is 24 kHz

export function useAudioPipeline({ onPcmChunk, onSpeechStart, onSpeechEnd }) {
  const captureCtx    = useRef(null)
  const playbackCtx   = useRef(null)
  const captureNode   = useRef(null)
  const playbackNode  = useRef(null)
  const gainNodeRef   = useRef(null)
  const analyserRef   = useRef(null)
  const sourceNode    = useRef(null)
  const micStream     = useRef(null)
  const muted         = useRef(false)

  const [isReady,      setIsReady]      = useState(false)
  const [micError,     setMicError]     = useState('')
  const [analyserNode, setAnalyserNode] = useState(null)  // exposed for GeminiAvatar FFT

  // ── VAD state ───────────────────────────────────────────────────
  const speechRef         = useRef(false)
  const silenceCounterRef = useRef(0)

  // ── Start ───────────────────────────────────────────────────────
  const start = useCallback(async () => {
    try {
      // 1. Request microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate:       CAPTURE_SAMPLE_RATE,
          channelCount:     1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl:  true,
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
          const pcmBuffer = e.data.pcm
          onPcmChunk(pcmBuffer)   // ArrayBuffer of Int16 samples

          // ── Simple VAD for barge-in ──────────────────────────
          if (onSpeechStart || onSpeechEnd) {
            const int16 = new Int16Array(pcmBuffer)
            let sum = 0
            for (let i = 0; i < int16.length; i++) sum += int16[i] * int16[i]
            const rms = Math.sqrt(sum / int16.length)
            if (rms > 1000) {
              silenceCounterRef.current = 0
              if (!speechRef.current) {
                speechRef.current = true
                onSpeechStart?.()
              }
            } else {
              silenceCounterRef.current += 1
              if (silenceCounterRef.current > 20 && speechRef.current) {
                speechRef.current = false
                onSpeechEnd?.()
              }
            }
          }
        }
      }

      // 3. Connect mic stream → worklet
      sourceNode.current = captureCtx.current.createMediaStreamSource(stream)
      sourceNode.current.connect(captureNode.current)
      captureNode.current.connect(captureCtx.current.destination)

      // 4. Playback AudioContext at 24 kHz
      playbackCtx.current = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE })
      await playbackCtx.current.audioWorklet.addModule('/playback-processor.js')
      playbackNode.current = new AudioWorkletNode(playbackCtx.current, 'playback-processor')

      // 5. GainNode — volume control
      const gainNode = playbackCtx.current.createGain()
      gainNode.gain.value = 1.0
      playbackNode.current.connect(gainNode)

      // 6. AnalyserNode — FFT tap for avatar animation
      //    Chain: PlaybackWorklet → GainNode → AnalyserNode → destination
      //    fftSize=256 → 128 bins @ 24kHz = 93.75 Hz/bin resolution
      //    smoothingTimeConstant=0.75 → gentle temporal smoothing
      const analyser = playbackCtx.current.createAnalyser()
      analyser.fftSize               = 256
      analyser.smoothingTimeConstant = 0.75
      gainNode.connect(analyser)
      analyser.connect(playbackCtx.current.destination)
      gainNodeRef.current = gainNode
      analyserRef.current = analyser
      setAnalyserNode(analyser)   // GeminiAvatar reads this to start its RAF loop

      setIsReady(true)
      setMicError('')

    } catch (err) {
      console.error('[AudioPipeline] start error:', err)
      setMicError(err.message || 'Microphone access denied')
    }
  }, [onPcmChunk, onSpeechStart, onSpeechEnd])

  // ── Stop ────────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    micStream.current?.getTracks().forEach(t => t.stop())
    sourceNode.current?.disconnect()
    captureNode.current?.disconnect()
    playbackNode.current?.disconnect()
    gainNodeRef.current?.disconnect()
    analyserRef.current?.disconnect()
    await captureCtx.current?.close().catch(() => {})
    await playbackCtx.current?.close().catch(() => {})
    captureCtx.current   = null
    playbackCtx.current  = null
    captureNode.current  = null
    playbackNode.current = null
    gainNodeRef.current  = null
    analyserRef.current  = null
    sourceNode.current   = null
    micStream.current    = null
    setIsReady(false)
    setAnalyserNode(null)
  }, [])

  // ── Play PCM from Gemini ─────────────────────────────────────────
  const playPcm = useCallback((arrayBuffer) => {
    if (!playbackNode.current) return
    try {
      playbackNode.current.port.postMessage(arrayBuffer, [arrayBuffer])
    } catch {
      // Fallback: copy if ArrayBuffer is already detached
      playbackNode.current.port.postMessage(arrayBuffer)
    }
  }, [])

  // ── Flush PCM queue (barge-in: discard buffered Gemini audio) ───
  const flushPcm = useCallback(() => {
    playbackNode.current?.port.postMessage('flush')
  }, [])

  // ── Resume PCM queue after barge-in completes ────────────────────
  const resumePcm = useCallback(() => {
    playbackNode.current?.port.postMessage('resume')
  }, [])

  // ── Mute / Unmute microphone ─────────────────────────────────────
  const setMuted = useCallback((val) => {
    muted.current = val
  }, [])

  // ── Resume AudioContext (required after first user gesture) ──────
  const resume = useCallback(async () => {
    await captureCtx.current?.resume()
    await playbackCtx.current?.resume()
  }, [])

  return {
    start,
    stop,
    playPcm,
    flushPcm,
    resumePcm,
    setMuted,
    resume,
    isReady,
    micError,
    analyserNode,   // ← Web Audio AnalyserNode for FFT-driven avatar
  }
}
