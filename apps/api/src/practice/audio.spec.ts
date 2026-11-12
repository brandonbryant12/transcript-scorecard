import { AudioWindow, isAudible, pcmToWav } from './audio.js';
import { sampleEvenly } from './practice-call.js';

// PCM16 mono where every sample has the same value.
const tone = (samples: number, value: number): Buffer => {
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index++) buffer.writeInt16LE(value, index * 2);
  return buffer;
};

describe('pcmToWav', () => {
  const pcm = tone(8, 1000);
  const wav = pcmToWav(pcm, 16_000);

  it('writes a 44-byte header followed by the samples', () => {
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.subarray(44).equals(pcm)).toBe(true);
  });

  it('writes the RIFF, fmt and data chunk fields for 16-bit mono PCM', () => {
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt32LE(16)).toBe(16);
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt32LE(28)).toBe(32_000);
    expect(wav.readUInt16LE(32)).toBe(2);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
  });

  it('records the sample rate it was given', () => {
    expect(pcmToWav(pcm, 24_000).readUInt32LE(24)).toBe(24_000);
    expect(pcmToWav(pcm, 24_000).readUInt32LE(28)).toBe(48_000);
  });
});

describe('isAudible', () => {
  it('accepts at least a second of speech-level audio', () => {
    expect(isAudible(tone(16_000, 1000), 16_000)).toBe(true);
    expect(isAudible(tone(16_000, -1000), 16_000)).toBe(true);
  });

  it('rejects a clip shorter than a second', () => {
    expect(isAudible(tone(15_999, 1000), 16_000)).toBe(false);
  });

  it('rejects near-silence', () => {
    expect(isAudible(tone(32_000, 100), 16_000)).toBe(false);
    expect(isAudible(Buffer.alloc(0), 16_000)).toBe(false);
  });
});

describe('AudioWindow', () => {
  // 10 samples a second keeps the arithmetic readable: 20 bytes per second.
  const RATE = 10;
  const second = (value: number) => tone(RATE, value);

  it('tracks the stream length in seconds', () => {
    const window = new AudioWindow(RATE, 10);
    window.push(second(1));
    window.push(tone(5, 2));
    expect(window.seconds).toBe(1.5);
  });

  it('slices by time offsets', () => {
    const window = new AudioWindow(RATE, 10);
    window.push(second(1));
    window.push(second(2));
    const slice = window.slice(0.5, 1.5);
    expect(slice.length).toBe(20);
    expect(slice.readInt16LE(0)).toBe(1);
    expect(slice.readInt16LE(slice.length - 2)).toBe(2);
  });

  it('clips a slice to what the window holds', () => {
    const window = new AudioWindow(RATE, 10);
    window.push(second(1));
    expect(window.slice(0.5, 99).length).toBe(10);
    expect(window.slice(-5, 0.5).length).toBe(10);
  });

  it('drops the oldest audio beyond maxSeconds but keeps stream offsets', () => {
    const window = new AudioWindow(RATE, 2);
    window.push(second(1));
    window.push(second(2));
    window.push(second(3));
    expect(window.seconds).toBe(3);
    expect(window.slice(0, 1).length).toBe(0);
    const kept = window.slice(1, 3);
    expect(kept.length).toBe(40);
    expect(kept.readInt16LE(0)).toBe(2);
    expect(kept.readInt16LE(kept.length - 2)).toBe(3);
  });

  it('keeps a single chunk even when it alone exceeds the window', () => {
    const window = new AudioWindow(RATE, 1);
    window.push(tone(50, 7));
    expect(window.slice(0, 5).length).toBe(100);
  });
});

describe('sampleEvenly', () => {
  it('returns a copy when there are no more items than requested', () => {
    const items = [1, 2];
    const sampled = sampleEvenly(items, 3);
    expect(sampled).toEqual([1, 2]);
    expect(sampled).not.toBe(items);
  });

  it('keeps the first and last items and spaces the rest evenly', () => {
    expect(sampleEvenly([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([1, 4, 7]);
    expect(sampleEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)).toEqual([1, 6, 10]);
    expect(sampleEvenly([1, 2, 3, 4, 5], 2)).toEqual([1, 5]);
  });

  it('returns the first item when one is asked for', () => {
    expect(sampleEvenly(['a', 'b'], 1)).toEqual(['a']);
  });
});
