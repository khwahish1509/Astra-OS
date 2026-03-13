/**
 * capture-processor.js  — AudioWorklet
 * =====================================
 * Runs in the audio rendering thread (off-main-thread).
 * Captures raw microphone PCM, converts Float32 → Int16,
 * and posts 50ms chunks to the main thread.
 *
 * Gemini Live expects: PCM16, 16 kHz, mono
 * Web Audio default sample rate: usually 44100 or 48000 Hz
 * → We output Int16 at whatever AudioContext rate is set;
 *   the server (or AudioContext) handles resampling to 16 kHz.
 *   To avoid resampling entirely, create AudioContext({sampleRate:16000}).
 */

const CHUNK_FRAMES = 800; // 50 ms @ 16 kHz

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch || ch.length === 0) return true;

    for (let i = 0; i < ch.length; i++) {
      // Clamp and convert Float32 [-1, 1] → Int16 [-32768, 32767]
      const s = Math.max(-1, Math.min(1, ch[i]));
      this._buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
    }

    // Emit in fixed-size chunks
    while (this._buf.length >= CHUNK_FRAMES) {
      const chunk = this._buf.splice(0, CHUNK_FRAMES);
      const int16 = new Int16Array(chunk);
      // Transfer the buffer to avoid copy
      this.port.postMessage({ pcm: int16.buffer }, [int16.buffer]);
    }

    return true; // keep alive
  }
}

registerProcessor('capture-processor', CaptureProcessor);
