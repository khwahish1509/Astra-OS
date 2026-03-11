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
 *    → GainNode → speakers
 *    → amplitude reported via onAmplitude callback (for avatar lip sync)
 *
 *  GainNode sits between PlaybackWorklet and the destination, allowing
 *  the volume to be set to 0 when Simli takes over audio output so there
 *  is no double-audio, while the worklet keeps running to report amplitude.
 *
 * Usage:
 *   const audio = useAudioPipeline({ onPcmChunk, onAmplitude })
 *   audio.start()               — request mic, open AudioContexts
 *   audio.stop()                — close everything
 *   audio.playPcm(buf)          — queue a received Int16 ArrayBuffer for playback
 *   audio.setMuted(bool)        — mute/unmute mic
 *   audio.setPlaybackVolume(v)  — 0 = silent (Simli playing), 1 = full (fallback)
 */

import { useRef, useCallback, useState } from 'react'

const CAPTURE_SAMPLE_RATE  = 16000   // Gemini input requires 16 kHz
const PLAYBACK_SAMPLE_RATE = 24000   // Gemini output is 24 kHz

export function useAudioPipeline({ onPcmChunk, onAmplitude, onSpeechStart, onSpeechEnd }) {
  const captureCtx    = useRef(null)
  const playbackCtx   = useRef(null)
  const captureNode   = useRef(null)
  const playbackNode  = useRef(null)
  const gainNodeRef   = useRef(null)   // ← NEW: volume gate for Simli handoff
  const sourceNode    = useRef(null)
  const micStream     = useRef(null)
  const muted         = useRef(false)

  const [isReady,   setIsReady]   = useState(false)
  const [micError,  setMicError]  = useState('')

  // ── VAD state ───────────────────────────────────────────────
  const speechRef        = useRef(false)
  const silenceCounterRef = useRef(0)

  // ── Start ───────────────────────────────────────────────────
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
              // Above threshold — user is speaking
              silenceCounterRef.current = 0
              if (!speechRef.current) {
                speechRef.current = true
                onSpeechStart?.()
              }
            } else {
              // Below threshold — silence
              silenceCounterRef.current += 1
              // After ~1 second of silence (20 × 50ms chunks) → speech ended
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
      captureNode.current.connect(captureCtx.current.destination) // needed on some browsers

      // 4. Playback AudioContext at 24 kHz
      playbackCtx.current = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE })
      await playbackCtx.current.audioWorklet.addModule('/playback-processor.js')

      playbackNode.current = new AudioWorkletNode(playbackCtx.current, 'playback-processor')
      playbackNode.current.port.onmessage = (e) => {
        // Amplitude is reported even when gain = 0, so the GeminiAvatar
        // fallback state stays accurate while Simli is the active display.
        if (e.data.amplitude !== undefined && onAmplitude) {
          onAmplitude(e.data.amplitude)
        }
      }

      // 5. GainNode — sits between worklet and destination
      //    Default gain = 1 (full volume, Simli not yet connected).
      //    When Simli connects, caller sets gain → 0 to avoid double audio.
      const gainNode = playbackCtx.current.createGain()
      gainNode.gain.value = 1.0
      playbackNode.current.connect(gainNode)
      gainNode.connect(playbackCtx.current.destination)
      gainNodeRef.current = gainNode

      setIsReady(true)
      setMicError('')

    } catch (err) {
      console.error('[AudioPipeline] start error:', err)
      setMicError(err.message || 'Microphone access denied')
    }
  }, [onPcmChunk, onAmplitude, onSpeechStart, onSpeechEnd])

  // ── Stop ────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    micStream.current?.getTracks().forEach(t => t.stop())
    sourceNode.current?.disconnect()
    captureNode.current?.disconnect()
    playbackNode.current?.disconnect()
    gainNodeRef.current?.disconnect()
    await captureCtx.current?.close().catch(() => {})
    await playbackCtx.current?.close().catch(() => {})

    captureCtx.current   = null
    playbackCtx.current  = null
    captureNode.current  = null
    playbackNode.current = null
    gainNodeRef.current  = null
    sourceNode.current   = null
    micStream.current    = null
    setIsReady(false)
  }, [])

  // ── Play PCM from Gemini ─────────────────────────────────────
  // Always queued into the worklet — even when gain = 0 — so amplitude
  // data keeps flowing to the GeminiAvatar fallback.
  const playPcm = useCallback((arrayBuffer) => {
    if (!playbackNode.current) return
    try {
      playbackNode.current.port.postMessage(arrayBuffer, [arrayBuffer])
    } catch {
      // Fallback: copy if ArrayBuffer is already detached
      playbackNode.current.port.postMessage(arrayBuffer)
    }
  }, [])

  // ── Flush PCM queue (barge-in: discard buffered Gemini audio) ──
  const flushPcm = useCallback(() => {
    playbackNode.current?.port.postMessage('flush')
  }, [])

  // ── Resume PCM queue after barge-in completes ───────────────
  const resumePcm = useCallback(() => {
    playbackNode.current?.port.postMessage('resume')
  }, [])

  // ── Mute / Unmute microphone ─────────────────────────────────
  const setMuted = useCallback((val) => {
    muted.current = val
  }, [])

  // ── Playback volume gate (0 = silent, 1 = full) ──────────────
  //
  //  Called by InterviewRoom when Simli connects / disconnects:
  //    simli connected   → setPlaybackVolume(0)  — Simli plays audio
  //    simli disconnected → setPlaybackVolume(1)  — worklet plays audio
  //
  //  Uses a 60ms exponential ramp for a click-free transition.
  const setPlaybackVolume = useCallback((vol) => {
    if (!gainNodeRef.current) return
    const ctx  = gainNodeRef.current.context
    const gain = gainNodeRef.current.gain
    gain.setTargetAtTime(vol, ctx.currentTime, 0.06)
  }, [])

  // ── Resume AudioContext (required after first user gesture) ──
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
    setPlaybackVolume,   // ← NEW
    isReady,
    micError,
  }
}
