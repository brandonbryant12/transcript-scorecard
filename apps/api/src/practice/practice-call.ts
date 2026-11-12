import type { PracticeServerMessage, TranscriptTurn } from '@scorecard/domain';
import type { TurnMedia } from '../scoring/question-plan.js';
import { AudioWindow, isAudible, pcmToWav } from './audio.js';
import type { RealtimeEvents, RealtimeSession } from './realtime-model.js';

const MIC_RATE = 16_000;
const MODEL_RATE = 24_000;
// The longest clip kept for one turn. Longer turns keep their most recent audio.
const MAX_CLIP_SECONDS = 30;
// Audio kept either side of detected speech so the clip does not start mid-word.
const CLIP_PADDING_SECONDS = 0.3;
// The employee's transcription can trail the model's first reply by a moment.
const TRANSCRIPT_GRACE_MS = 600;
const FRAMES_PER_TURN = 3;

export interface PracticeCallDeps {
  // Adds a finished turn to the live session, which triggers scoring.
  readonly appendTurn: (
    speaker: TranscriptTurn['speaker'],
    text: string,
    media: TurnMedia | undefined,
  ) => Promise<unknown>;
  readonly send: (message: PracticeServerMessage) => void;
  // Whether to keep per-turn audio and frames for the scoring provider.
  readonly captureMedia: boolean;
}

// Turns a continuous two-way voice conversation into discrete, attributed turns.
//
// The human (the employee) speaks into a microphone; the real-time model (the customer)
// speaks back. The model reports what each side said as text fragments. This class
// gathers those fragments into turns, cuts each turn's audio out of its stream, and
// hands the finished turn to the live session. From there on a practice call is scored
// exactly like any other stream.
export class PracticeCall implements RealtimeEvents {
  private session: RealtimeSession | null = null;
  private ready = false;
  private finished = false;

  private readonly microphone = new AudioWindow(MIC_RATE, MAX_CLIP_SECONDS + 15);
  private speechStart: number | null = null;
  private speechEnd: number | null = null;
  private employeeText = '';
  private employeeFlush: NodeJS.Timeout | null = null;
  private frames: string[] = [];

  private customerText = '';
  private customerAudio: Buffer[] = [];

  // Turns are appended one at a time, in the order they finished.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PracticeCallDeps) {}

  attach(session: RealtimeSession): void {
    this.session = session;
  }

  // --- From the browser -----------------------------------------------------

  receiveAudio(pcm: Buffer): void {
    if (!this.ready || this.finished) return;
    // Only audio that actually reaches the model is counted, so the model's speech
    // offsets line up with this window.
    this.microphone.push(pcm);
    this.session?.sendAudio(pcm);
  }

  receiveFrame(jpegBase64: string): void {
    if (!this.deps.captureMedia || this.finished) return;
    this.frames.push(jpegBase64);
    // A long silence must not grow the list without bound.
    if (this.frames.length > 60) this.frames.shift();
  }

  async end(): Promise<void> {
    if (this.finished) return;
    this.flushEmployee();
    this.flushCustomer();
    this.finished = true;
    this.session?.close();
    await this.queue;
  }

  // --- From the real-time model ---------------------------------------------

  onReady(): void {
    this.ready = true;
  }

  onInputActivity(kind: 'start' | 'end', offsetSeconds: number): void {
    if (kind === 'start') this.speechStart ??= offsetSeconds;
    else this.speechEnd = offsetSeconds;
  }

  onInputTranscript(text: string): void {
    this.employeeText += text;
    this.deps.send({
      event: 'caption',
      data: { speaker: 'employee', text: this.employeeText.trim() },
    });
  }

  onAudio(pcm: Buffer): void {
    this.modelIsReplying();
    if (this.deps.captureMedia) this.customerAudio.push(pcm);
    this.deps.send({ event: 'audio', data: pcm.toString('base64') });
  }

  onOutputTranscript(text: string): void {
    this.modelIsReplying();
    this.customerText += text;
    this.deps.send({
      event: 'caption',
      data: { speaker: 'customer', text: this.customerText.trim() },
    });
  }

  onTurnComplete(): void {
    // The employee's turn always goes in first: it is what the customer was answering.
    this.flushEmployee();
    this.flushCustomer();
  }

  onInterrupted(): void {
    this.deps.send({ event: 'interrupted', data: null });
  }

  onError(message: string): void {
    this.deps.send({ event: 'error', data: { message } });
  }

  onClose(): void {
    this.ready = false;
  }

  // --- Turn assembly --------------------------------------------------------

  // The model starting to answer means the employee has finished speaking. Their turn
  // is flushed after a short grace period so late transcription fragments still land
  // in it rather than in the next one.
  private modelIsReplying(): void {
    if (
      this.employeeFlush !== null ||
      (this.employeeText.trim() === '' && this.speechStart === null)
    )
      return;
    this.employeeFlush = setTimeout(() => this.flushEmployee(), TRANSCRIPT_GRACE_MS);
  }

  private flushEmployee(): void {
    if (this.employeeFlush !== null) clearTimeout(this.employeeFlush);
    this.employeeFlush = null;
    const text = this.employeeText.trim();
    const now = this.microphone.seconds;
    const from = (this.speechStart ?? now - MAX_CLIP_SECONDS) - CLIP_PADDING_SECONDS;
    const to = (this.speechEnd ?? now) + CLIP_PADDING_SECONDS;
    const frames = this.frames;
    this.employeeText = '';
    this.speechStart = null;
    this.speechEnd = null;
    this.frames = [];
    if (text === '') return;

    let media: TurnMedia | undefined;
    if (this.deps.captureMedia) {
      const clip = this.microphone.slice(Math.max(from, to - MAX_CLIP_SECONDS), to);
      media = {
        ...(isAudible(clip, MIC_RATE) ? { audio: wavBlock(clip, MIC_RATE) } : {}),
        ...(frames.length > 0
          ? {
              frames: sampleEvenly(frames, FRAMES_PER_TURN).map((data) => ({
                mimeType: 'image/jpeg',
                data,
              })),
            }
          : {}),
      };
    }
    this.enqueue('employee', text, media);
  }

  private flushCustomer(): void {
    const text = this.customerText.trim();
    const audio = Buffer.concat(this.customerAudio);
    this.customerText = '';
    this.customerAudio = [];
    if (text === '') return;
    const maxBytes = MAX_CLIP_SECONDS * MODEL_RATE * 2;
    const clip = audio.length > maxBytes ? audio.subarray(audio.length - maxBytes) : audio;
    this.enqueue(
      'customer',
      text,
      this.deps.captureMedia && isAudible(clip, MODEL_RATE)
        ? { audio: wavBlock(clip, MODEL_RATE) }
        : undefined,
    );
  }

  private enqueue(
    speaker: TranscriptTurn['speaker'],
    text: string,
    media: TurnMedia | undefined,
  ): void {
    this.queue = this.queue
      .then(() => this.deps.appendTurn(speaker, text, media))
      .catch(() =>
        this.deps.send({ event: 'error', data: { message: 'A turn could not be recorded' } }),
      );
  }
}

const wavBlock = (pcm: Buffer, sampleRate: number): NonNullable<TurnMedia['audio']> => ({
  mimeType: 'audio/wav',
  data: pcmToWav(pcm, sampleRate).toString('base64'),
});

// Up to `count` items spread across the list: first, last and evenly between.
export const sampleEvenly = <T>(items: ReadonlyArray<T>, count: number): T[] => {
  if (items.length <= count) return [...items];
  if (count <= 1) return items.slice(0, count);
  return Array.from(
    { length: count },
    (_, index) => items[Math.round((index * (items.length - 1)) / (count - 1))]!,
  );
};
