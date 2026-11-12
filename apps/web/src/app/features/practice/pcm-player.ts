import { Injectable } from '@angular/core';
import { MODEL_SAMPLE_RATE, pcm16ToFloat } from './pcm';

/** A small lead so the first buffer is not scheduled in the past. */
const LEAD_SECONDS = 0.05;

/**
 * Plays 24 kHz PCM16 chunks back to back with no gaps, by scheduling each one on the
 * audio clock at the moment the previous one ends.
 */
@Injectable()
export class PcmPlayer {
  private context: AudioContext | null = null;
  private nextStartTime = 0;
  private readonly playing = new Set<AudioBufferSourceNode>();

  /** Queues a chunk. The audio context is created on first use, inside a user gesture. */
  enqueue(pcm: Int16Array): void {
    if (pcm.length === 0) return;
    const context = (this.context ??= new AudioContext({ sampleRate: MODEL_SAMPLE_RATE }));
    const buffer = context.createBuffer(1, pcm.length, MODEL_SAMPLE_RATE);
    buffer.getChannelData(0).set(pcm16ToFloat(pcm));

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + LEAD_SECONDS, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.playing.add(source);
    source.onended = () => this.playing.delete(source);
  }

  /** Makes sure audio can start; browsers suspend a context created without a gesture. */
  async resume(): Promise<void> {
    this.context ??= new AudioContext({ sampleRate: MODEL_SAMPLE_RATE });
    if (this.context.state === 'suspended') await this.context.resume();
  }

  /** Drops everything queued or playing. Used when the model is interrupted. */
  flush(): void {
    for (const source of this.playing) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.playing.clear();
    this.nextStartTime = 0;
  }

  close(): void {
    this.flush();
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
