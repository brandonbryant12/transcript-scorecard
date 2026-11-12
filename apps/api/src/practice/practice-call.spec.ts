import type { PracticeServerMessage } from '@scorecard/domain';
import type { TurnMedia } from '../scoring/question-plan.js';
import { PracticeCall } from './practice-call.js';
import type { RealtimeSession } from './realtime-model.js';

const MIC_RATE = 16_000;
const MODEL_RATE = 24_000;

// PCM16 mono where every sample has the same value. Values of 1000 and up count as speech.
const tone = (seconds: number, rate: number, value: number): Buffer => {
  const samples = Math.round(seconds * rate);
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index++) buffer.writeInt16LE(value, index * 2);
  return buffer;
};

const decodeWav = (media: TurnMedia | undefined) => {
  const wav = Buffer.from(media!.audio!.data, 'base64');
  return {
    sampleRate: wav.readUInt32LE(24),
    pcm: wav.subarray(44),
    riff: wav.toString('ascii', 0, 4),
  };
};

const setup = (options: { captureMedia: boolean }) => {
  const appended: Array<{ speaker: string; text: string; media: TurnMedia | undefined }> = [];
  const appendTurn = vi.fn(async (speaker: string, text: string, media: TurnMedia | undefined) => {
    appended.push({ speaker, text, media });
  });
  const sent: PracticeServerMessage[] = [];
  const send = vi.fn((message: PracticeServerMessage) => void sent.push(message));
  const session = { sendAudio: vi.fn(), close: vi.fn() } satisfies RealtimeSession;
  const call = new PracticeCall({ appendTurn, send, captureMedia: options.captureMedia });
  call.attach(session);
  call.onReady();
  return { call, appendTurn, appended, send, sent, session };
};

// Lets queued appends (a promise chain) run without moving the clock.
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PracticeCall turn assembly', () => {
  it('flushes the employee turn a grace period after the model starts replying', async () => {
    const { call, appended } = setup({ captureMedia: false });
    call.onInputTranscript('Hello ');
    call.onInputTranscript('there');
    call.onOutputTranscript('Hi');
    await vi.advanceTimersByTimeAsync(599);
    expect(appended).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(appended).toEqual([{ speaker: 'employee', text: 'Hello there', media: undefined }]);
  });

  it('also starts the grace period when the model replies with audio first', async () => {
    const { call, appended } = setup({ captureMedia: false });
    call.onInputTranscript('Question');
    call.onAudio(tone(0.1, MODEL_RATE, 1000));
    await vi.advanceTimersByTimeAsync(600);
    expect(appended.map((turn) => turn.text)).toEqual(['Question']);
  });

  it('keeps late transcription fragments in the employee turn', async () => {
    const { call, appended } = setup({ captureMedia: false });
    call.onInputTranscript('I need');
    call.onOutputTranscript('Sure');
    await vi.advanceTimersByTimeAsync(300);
    call.onInputTranscript(' a refund');
    await vi.advanceTimersByTimeAsync(300);
    expect(appended[0]).toMatchObject({ speaker: 'employee', text: 'I need a refund' });
  });

  it('appends the employee before the customer when the model finishes its turn', async () => {
    const { call, appended } = setup({ captureMedia: false });
    call.onInputTranscript('How can I help?');
    call.onOutputTranscript('I was charged twice.');
    call.onTurnComplete();
    await settle();
    expect(appended.map((turn) => [turn.speaker, turn.text])).toEqual([
      ['employee', 'How can I help?'],
      ['customer', 'I was charged twice.'],
    ]);
    // The pending grace-period flush was cancelled: nothing is appended twice.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(appended).toHaveLength(2);
  });

  it('appends turns one at a time, in order, even when an append is slow', async () => {
    const { call, appendTurn } = setup({ captureMedia: false });
    let release!: () => void;
    appendTurn.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    call.onInputTranscript('First');
    call.onOutputTranscript('Second');
    call.onTurnComplete();
    await settle();
    expect(appendTurn).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(appendTurn).toHaveBeenCalledTimes(2);
    expect(appendTurn.mock.calls.map(([speaker]) => speaker)).toEqual(['employee', 'customer']);
  });

  it('appends nothing for a turn with no words', async () => {
    const { call, appendTurn } = setup({ captureMedia: false });
    call.onInputActivity('start', 0.5);
    call.onInputActivity('end', 1.5);
    call.onInputTranscript('   ');
    call.onOutputTranscript('  ');
    call.onTurnComplete();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(appendTurn).not.toHaveBeenCalled();
  });

  it('reports a failed append and keeps recording later turns', async () => {
    const { call, appendTurn, sent } = setup({ captureMedia: false });
    appendTurn.mockRejectedValueOnce(new Error('database is locked'));
    call.onInputTranscript('First');
    call.onTurnComplete();
    await settle();
    call.onInputTranscript('Second');
    call.onTurnComplete();
    await settle();
    expect(sent).toContainEqual({
      event: 'error',
      data: { message: 'A turn could not be recorded' },
    });
    expect(appendTurn).toHaveBeenCalledTimes(2);
  });

  it('sends running captions for both speakers', () => {
    const { call, sent } = setup({ captureMedia: false });
    call.onInputTranscript(' Hello');
    call.onInputTranscript(' there ');
    call.onOutputTranscript('Hi');
    expect(sent.filter((message) => message.event === 'caption')).toEqual([
      { event: 'caption', data: { speaker: 'employee', text: 'Hello' } },
      { event: 'caption', data: { speaker: 'employee', text: 'Hello there' } },
      { event: 'caption', data: { speaker: 'customer', text: 'Hi' } },
    ]);
  });
});

describe('PracticeCall media capture', () => {
  it('cuts the employee clip out of the microphone stream by the speech offsets', async () => {
    const { call, appended } = setup({ captureMedia: true });
    // Three seconds of microphone audio; each second has its own sample value.
    call.receiveAudio(tone(1, MIC_RATE, 1000));
    call.receiveAudio(tone(1, MIC_RATE, 2000));
    call.receiveAudio(tone(1, MIC_RATE, 3000));
    call.onInputActivity('start', 1);
    call.onInputActivity('end', 2);
    call.onInputTranscript('Let me check that for you.');
    call.onTurnComplete();
    await settle();

    const { riff, sampleRate, pcm } = decodeWav(appended[0]!.media);
    expect(appended[0]!.media!.audio!.mimeType).toBe('audio/wav');
    expect(riff).toBe('RIFF');
    expect(sampleRate).toBe(MIC_RATE);
    // 0.7 s to 2.3 s: the speech plus 0.3 s of padding on each side.
    expect(Math.abs(pcm.length - 1.6 * MIC_RATE * 2)).toBeLessThanOrEqual(2);
    expect(pcm.readInt16LE(0)).toBe(1000);
    expect(pcm.readInt16LE(pcm.length - 2)).toBe(3000);
  });

  it('forwards microphone audio to the model only once it is ready', () => {
    const appendTurn = vi.fn(async () => undefined);
    const session = { sendAudio: vi.fn(), close: vi.fn() };
    const call = new PracticeCall({ appendTurn, send: vi.fn(), captureMedia: true });
    call.attach(session);
    call.receiveAudio(tone(0.1, MIC_RATE, 1000));
    expect(session.sendAudio).not.toHaveBeenCalled();
    call.onReady();
    call.receiveAudio(tone(0.1, MIC_RATE, 1000));
    expect(session.sendAudio).toHaveBeenCalledTimes(1);
  });

  it('drops a silent employee clip but keeps the words', async () => {
    const { call, appended } = setup({ captureMedia: true });
    call.receiveAudio(tone(2, MIC_RATE, 0));
    call.onInputActivity('start', 0.5);
    call.onInputActivity('end', 1.8);
    call.onInputTranscript('Hello?');
    call.onTurnComplete();
    await settle();
    expect(appended[0]).toEqual({ speaker: 'employee', text: 'Hello?', media: {} });
  });

  it('samples the frames of a turn down to three', async () => {
    const { call, appended } = setup({ captureMedia: true });
    for (const frame of ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7']) call.receiveFrame(frame);
    call.onInputTranscript('Looking at it now.');
    call.onTurnComplete();
    await settle();
    expect(appended[0]!.media).toEqual({
      frames: ['f1', 'f4', 'f7'].map((data) => ({ mimeType: 'image/jpeg', data })),
    });
  });

  it('starts each turn with fresh frames', async () => {
    const { call, appended } = setup({ captureMedia: true });
    call.receiveFrame('old');
    call.onInputTranscript('One');
    call.onTurnComplete();
    call.receiveFrame('new');
    call.onInputTranscript('Two');
    call.onTurnComplete();
    await settle();
    expect(appended.map((turn) => turn.media?.frames?.map((frame) => frame.data))).toEqual([
      ['old'],
      ['new'],
    ]);
  });

  it('keeps the customer audio as a WAV clip at the model rate', async () => {
    const { call, appended, sent } = setup({ captureMedia: true });
    const speech = tone(1.5, MODEL_RATE, 2000);
    call.onAudio(speech);
    call.onOutputTranscript('I was charged twice.');
    call.onTurnComplete();
    await settle();
    expect(appended[0]!.speaker).toBe('customer');
    const { sampleRate, pcm } = decodeWav(appended[0]!.media);
    expect(sampleRate).toBe(MODEL_RATE);
    expect(pcm.equals(speech)).toBe(true);
    expect(sent).toContainEqual({ event: 'audio', data: speech.toString('base64') });
  });

  it('omits a customer clip too short to hold speech', async () => {
    const { call, appended } = setup({ captureMedia: true });
    call.onAudio(tone(0.5, MODEL_RATE, 2000));
    call.onOutputTranscript('Yes.');
    call.onTurnComplete();
    await settle();
    expect(appended[0]).toEqual({ speaker: 'customer', text: 'Yes.', media: undefined });
  });

  it('captures no media at all when captureMedia is false', async () => {
    const { call, appended } = setup({ captureMedia: false });
    call.receiveAudio(tone(2, MIC_RATE, 1000));
    call.receiveFrame('f1');
    call.onInputActivity('start', 0);
    call.onInputActivity('end', 2);
    call.onInputTranscript('Hello');
    call.onAudio(tone(2, MODEL_RATE, 1000));
    call.onOutputTranscript('Hi');
    call.onTurnComplete();
    await settle();
    expect(appended).toEqual([
      { speaker: 'employee', text: 'Hello', media: undefined },
      { speaker: 'customer', text: 'Hi', media: undefined },
    ]);
  });
});

describe('PracticeCall.end', () => {
  it('flushes both speakers, closes the model session and waits for the appends', async () => {
    const { call, appendTurn, session } = setup({ captureMedia: false });
    let release!: () => void;
    appendTurn.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    call.onInputTranscript('Goodbye');
    call.onOutputTranscript('Bye');

    let ended = false;
    const ending = call.end().then(() => (ended = true));
    await settle();
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(ended).toBe(false);
    release();
    await ending;
    expect(appendTurn.mock.calls.map(([speaker, text]) => [speaker, text])).toEqual([
      ['employee', 'Goodbye'],
      ['customer', 'Bye'],
    ]);
  });

  it('ignores audio and frames after the call has ended', async () => {
    const { call, session, appendTurn } = setup({ captureMedia: true });
    await call.end();
    call.receiveAudio(tone(0.1, MIC_RATE, 1000));
    call.receiveFrame('late');
    expect(session.sendAudio).not.toHaveBeenCalled();
    await call.end();
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(appendTurn).not.toHaveBeenCalled();
  });
});
