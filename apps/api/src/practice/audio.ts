// Small PCM helpers for practice calls. All audio is 16-bit little-endian mono.

const BYTES_PER_SAMPLE = 2;

// Wrap raw PCM in a WAV header so the clip describes its own format wherever it is sent.
export const pcmToWav = (pcm: Buffer, sampleRate: number): Buffer => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // size of the fmt chunk
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * BYTES_PER_SAMPLE, 28); // byte rate
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

// Whether a clip is worth asking a model about. A decision model never answers "there
// is nothing here": given a second of silence it returns an ordinary-looking rating,
// which would then be averaged into the speaker's score. So clips that are too short or
// too quiet to contain speech are dropped before anything is asked.
const MIN_CLIP_SECONDS = 1;
// Mean absolute sample value, out of 32,768. Room tone sits well below this; speech
// sits well above it.
const MIN_MEAN_AMPLITUDE = 150;

export const isAudible = (pcm: Buffer, sampleRate: number): boolean => {
  const samples = Math.floor(pcm.length / BYTES_PER_SAMPLE);
  if (samples < MIN_CLIP_SECONDS * sampleRate) return false;
  let total = 0;
  for (let index = 0; index < samples; index++) total += Math.abs(pcm.readInt16LE(index * 2));
  return total / samples >= MIN_MEAN_AMPLITUDE;
};

// A rolling window over a continuous audio stream, addressed by time since the stream
// began. It keeps the most recent `maxSeconds` so one turn can be cut out by its start
// and end offsets after the fact, without holding the whole call in memory.
export class AudioWindow {
  private chunks: Buffer[] = [];
  private bufferedBytes = 0;
  // Bytes of the stream that have already been dropped from the front of the window.
  private droppedBytes = 0;
  private readonly maxBytes: number;

  constructor(
    private readonly sampleRate: number,
    maxSeconds: number,
  ) {
    this.maxBytes = Math.floor(maxSeconds * sampleRate) * BYTES_PER_SAMPLE;
  }

  get seconds(): number {
    return (this.droppedBytes + this.bufferedBytes) / BYTES_PER_SAMPLE / this.sampleRate;
  }

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.bufferedBytes += chunk.length;
    while (this.bufferedBytes > this.maxBytes && this.chunks.length > 1) {
      const removed = this.chunks.shift()!;
      this.bufferedBytes -= removed.length;
      this.droppedBytes += removed.length;
    }
  }

  // The audio between two stream offsets, clipped to what the window still holds.
  slice(fromSeconds: number, toSeconds: number): Buffer {
    const all = Buffer.concat(this.chunks);
    const toByte = (seconds: number): number => {
      const absolute = Math.floor(seconds * this.sampleRate) * BYTES_PER_SAMPLE;
      return Math.max(0, Math.min(all.length, absolute - this.droppedBytes));
    };
    return all.subarray(toByte(fromSeconds), toByte(toSeconds));
  }
}
