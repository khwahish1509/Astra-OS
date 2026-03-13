/**
 * playback-processor.js — AudioWorklet
 * ======================================
 * Receives PCM16 Int16 chunks from the main thread (Gemini audio output)
 * and plays them back smoothly via a jitter buffer queue.
 *
 * Gemini outputs: PCM16, 24 kHz, mono
 * → Create AudioContext({ sampleRate: 24000 }) for the playback context.
 *
 * Also sends back RMS amplitude to the main thread every 32 frames
 * so the avatar can visualise audio levels.
 */

const AMPLITUDE_REPORT_INTERVAL = 32; // frames between RMS reports

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];     // Float32Array chunks waiting to play
    this._frameCount = 0;
    this._flushed = false; // When true, discard incoming audio (interrupted)

    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        // Immediately clear buffer AND block new chunks until 'resume'
        this._queue = [];
        this._flushed = true;
        return;
      }
      if (e.data === 'resume') {
        // Agent is allowed to speak again
        this._flushed = false;
        return;
      }

      // Discard incoming chunks while in flushed/interrupted state
      if (this._flushed) return;

      const int16 = new Int16Array(e.data);
      const float = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float[i] = int16[i] / 32768;
      }
      this._queue.push(float);
    };
  }

  process(_, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return true;

    let offset = 0;
    let rmsSum = 0;

    while (offset < out.length) {
      if (this._queue.length === 0) {
        // Silence padding when buffer is empty
        out.fill(0, offset);
        break;
      }

      const chunk = this._queue[0];
      const available = Math.min(chunk.length, out.length - offset);

      for (let i = 0; i < available; i++) {
        out[offset + i] = chunk[i];
        rmsSum += chunk[i] * chunk[i];
      }

      offset += available;

      if (available < chunk.length) {
        this._queue[0] = chunk.subarray(available);
      } else {
        this._queue.shift();
      }
    }

    // Report amplitude periodically
    this._frameCount++;
    if (this._frameCount % AMPLITUDE_REPORT_INTERVAL === 0) {
      const rms = Math.sqrt(rmsSum / out.length);
      this.port.postMessage({ amplitude: rms });
    }

    return true;
  }
}

registerProcessor('playback-processor', PlaybackProcessor);
