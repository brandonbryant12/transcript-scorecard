import {
  LinearResampler,
  base64ToBytes,
  base64ToPcm16,
  bytesToBase64,
  floatToPcm16,
  pcm16ToBase64,
  pcm16ToFloat,
} from './pcm';
import { deviceErrorMessage } from './practice-call';
import { parseServerMessage } from './practice-socket';

describe('floatToPcm16 and pcm16ToFloat', () => {
  it('maps the float range onto the 16-bit range', () => {
    expect([...floatToPcm16(Float32Array.from([0, 1, -1, 0.5, -0.5]))]).toEqual([
      0, 32767, -32768, 16384, -16384,
    ]);
  });

  it('clamps samples outside -1..1 instead of wrapping', () => {
    expect([...floatToPcm16(Float32Array.from([1.7, -3]))]).toEqual([32767, -32768]);
  });

  it('round-trips within one quantisation step', () => {
    const original = Float32Array.from([0, 0.25, -0.25, 0.9, -0.9]);
    const restored = pcm16ToFloat(floatToPcm16(original));
    original.forEach((sample, index) => expect(restored[index]).toBeCloseTo(sample, 3));
  });
});

describe('base64', () => {
  it('round-trips bytes, including buffers larger than one chunk', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(bytesToBase64(Uint8Array.from([72, 105]))).toBe('SGk=');
  });

  it('encodes PCM16 little-endian', () => {
    // 0x0102 little-endian is the bytes 02 01.
    expect(base64ToBytes(pcm16ToBase64(Int16Array.from([0x0102, -2])))).toEqual(
      Uint8Array.from([0x02, 0x01, 0xfe, 0xff]),
    );
  });

  it('round-trips PCM16 and drops a trailing odd byte', () => {
    const pcm = Int16Array.from([0, 1, -1, 32767, -32768, 12345]);
    expect(base64ToPcm16(pcm16ToBase64(pcm))).toEqual(pcm);
    expect(base64ToPcm16(bytesToBase64(Uint8Array.from([1, 0, 9]))).length).toBe(1);
  });
});

describe('LinearResampler', () => {
  it('returns the input untouched when the rates match', () => {
    const input = Float32Array.from([0.1, 0.2]);
    expect(new LinearResampler(16_000, 16_000).process(input)).toBe(input);
  });

  it('produces a third of the samples when going from 48 kHz to 16 kHz', () => {
    const output = new LinearResampler(48_000, 16_000).process(new Float32Array(4800));
    expect(output.length).toBe(1600);
  });

  it('keeps the same total length however the stream is chunked', () => {
    const whole = new LinearResampler(44_100, 16_000).process(new Float32Array(44_100)).length;
    const chunked = new LinearResampler(44_100, 16_000);
    let total = 0;
    for (let offset = 0; offset < 44_100; offset += 441) {
      total += chunked.process(new Float32Array(441)).length;
    }
    expect(Math.abs(total - whole)).toBeLessThanOrEqual(1);
    expect(Math.abs(whole - 16_000)).toBeLessThanOrEqual(1);
  });

  it('interpolates between samples and across chunk boundaries', () => {
    // A ramp sampled at double rate: halving the rate should keep every other point.
    const down = new LinearResampler(2, 1);
    expect([...down.process(Float32Array.from([0, 1, 2, 3]))]).toEqual([0, 2]);
    expect([...down.process(Float32Array.from([4, 5, 6, 7]))]).toEqual([4, 6]);

    // Doubling the rate fills in the midpoints.
    const up = new LinearResampler(1, 2);
    expect([...up.process(Float32Array.from([0, 2, 4]))]).toEqual([0, 1, 2, 3, 4, 4]);
  });

  it('rejects impossible rates', () => {
    expect(() => new LinearResampler(0, 16_000)).toThrow(RangeError);
  });
});

describe('parseServerMessage', () => {
  it('accepts the events the gateway sends', () => {
    expect(parseServerMessage('{"event":"ready","data":{"sessionId":"live-9"}}')).toEqual({
      event: 'ready',
      data: { sessionId: 'live-9' },
    });
    expect(parseServerMessage('{"event":"interrupted","data":null}')?.event).toBe('interrupted');
  });

  it('ignores unknown events, malformed JSON and binary frames', () => {
    expect(parseServerMessage('{"event":"mystery","data":1}')).toBeNull();
    expect(parseServerMessage('{"type":"ready"}')).toBeNull();
    expect(parseServerMessage('nope')).toBeNull();
    expect(parseServerMessage(new ArrayBuffer(4))).toBeNull();
  });
});

describe('deviceErrorMessage', () => {
  it('explains a refused or missing device in terms the user can act on', () => {
    expect(deviceErrorMessage(new DOMException('', 'NotAllowedError'), 'microphone')).toMatch(
      /microphone was blocked/,
    );
    expect(deviceErrorMessage(new DOMException('', 'NotFoundError'), 'camera')).toBe(
      'No camera was found on this device.',
    );
    expect(deviceErrorMessage(new DOMException('', 'NotReadableError'), 'camera')).toMatch(
      /in use/,
    );
    expect(deviceErrorMessage(new Error('boom'), 'microphone')).toBe(
      'Could not start the microphone: boom',
    );
  });
});
