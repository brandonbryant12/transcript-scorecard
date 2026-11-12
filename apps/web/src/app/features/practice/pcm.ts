/**
 * Conversions for raw audio. The practice call exchanges 16-bit mono PCM as base64:
 * 16 kHz from the microphone, 24 kHz back from the voice model. Web Audio works in
 * 32-bit floats between -1 and 1.
 */

export const MIC_SAMPLE_RATE = 16_000;
export const MODEL_SAMPLE_RATE = 24_000;

export function floatToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
  }
  return pcm;
}

export function pcm16ToFloat(pcm: Int16Array): Float32Array {
  const samples = new Float32Array(pcm.length);
  for (let index = 0; index < pcm.length; index++) {
    samples[index] = pcm[index] / 0x8000;
  }
  return samples;
}

const BASE64_CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Building the string in slices avoids exceeding the argument limit on large buffers.
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Little-endian, as both ends of the wire expect. */
export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < pcm.length; index++) {
    view.setInt16(index * 2, pcm[index], true);
  }
  return bytesToBase64(bytes);
}

export function base64ToPcm16(base64: string): Int16Array {
  const bytes = base64ToBytes(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pcm = new Int16Array(Math.floor(bytes.length / 2));
  for (let index = 0; index < pcm.length; index++) {
    pcm[index] = view.getInt16(index * 2, true);
  }
  return pcm;
}

/**
 * Converts a stream of audio from one sample rate to another by linear interpolation.
 * It is fed chunk by chunk and carries its position across chunks, so the output has no
 * clicks at chunk boundaries. Good enough for speech; not a mastering-grade resampler.
 */
export class LinearResampler {
  private readonly step: number;
  /** Position of the next output sample, in input samples relative to the next chunk. */
  private position = 0;
  private previous = 0;

  constructor(fromRate: number, toRate: number) {
    if (fromRate <= 0 || toRate <= 0) throw new RangeError('Sample rates must be positive');
    this.step = fromRate / toRate;
  }

  process(input: Float32Array): Float32Array {
    if (this.step === 1) return input;
    const output: number[] = [];
    let position = this.position;
    while (position < input.length) {
      const index = Math.floor(position);
      const fraction = position - index;
      // Index -1 is the last sample of the previous chunk.
      const before = index < 0 ? this.previous : input[index];
      const after = index + 1 < input.length ? input[index + 1] : input[input.length - 1];
      output.push(before + (after - before) * fraction);
      position += this.step;
    }
    if (input.length > 0) this.previous = input[input.length - 1];
    this.position = position - input.length;
    return Float32Array.from(output);
  }
}
