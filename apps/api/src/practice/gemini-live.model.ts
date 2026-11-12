import { Injectable, Logger } from '@nestjs/common';
import { PROVIDERS } from '@scorecard/domain';
import WebSocket, { type RawData } from 'ws';
import { CredentialsService } from '../decisions/credentials.service.js';
import {
  type RealtimeConnectOptions,
  type RealtimeEvents,
  type RealtimeModel,
  type RealtimeSession,
} from './realtime-model.js';

const ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// A frame arrives as one buffer, a list of fragments, or an ArrayBuffer.
const decode = (raw: RawData): string =>
  Array.isArray(raw)
    ? Buffer.concat(raw).toString('utf8')
    : Buffer.from(raw as Uint8Array).toString('utf8');

// The parts of a Live API server message this adapter reads.
interface ServerMessage {
  readonly setupComplete?: unknown;
  readonly serverContent?: {
    readonly modelTurn?: {
      readonly parts?: ReadonlyArray<{ readonly inlineData?: { readonly data?: string } }>;
    };
    readonly inputTranscription?: { readonly text?: string };
    readonly outputTranscription?: { readonly text?: string };
    readonly generationComplete?: boolean;
    readonly turnComplete?: boolean;
    readonly interrupted?: boolean;
  };
  readonly voiceActivity?: { readonly type?: string; readonly audioOffset?: string };
  readonly goAway?: unknown;
}

// Gemini Live over its raw WebSocket API. The model hears 16 kHz PCM, answers in 24 kHz
// PCM, and transcribes both directions, which is what makes it usable as a scored
// conversation partner: the transcripts arrive alongside the audio at no extra step.
// https://aistudio.google.com/api-reference/live
@Injectable()
export class GeminiLiveModel implements RealtimeModel {
  readonly model = 'gemini-3.8-live';
  readonly envVar = PROVIDERS.gemini.envVar;
  private readonly logger = new Logger(GeminiLiveModel.name);

  constructor(private readonly credentials: CredentialsService) {}

  isAvailable(): boolean {
    return this.credentials.isConfigured('gemini');
  }

  connect(options: RealtimeConnectOptions, events: RealtimeEvents): RealtimeSession {
    const apiKey = this.credentials.keyFor('gemini');
    const socket = new WebSocket(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`);
    let ready = false;
    let closed = false;
    // A model turn reports that its words are complete (`generationComplete`) and later
    // that playback time has elapsed (`turnComplete`). Either ends the turn; only the
    // first one is passed on.
    let turnOpen = false;
    const completeTurn = (): void => {
      if (!turnOpen) return;
      turnOpen = false;
      events.onTurnComplete();
    };

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          setup: {
            model: `models/${this.model}`,
            generationConfig: { responseModalities: ['AUDIO'] },
            systemInstruction: { parts: [{ text: options.systemInstruction }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }),
      );
    });

    socket.on('message', (raw) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(decode(raw)) as ServerMessage;
      } catch {
        return;
      }
      if (message.setupComplete !== undefined) {
        ready = true;
        events.onReady();
        return;
      }
      if (message.voiceActivity) {
        const offset = Number.parseFloat(message.voiceActivity.audioOffset ?? '');
        if (Number.isFinite(offset)) {
          if (message.voiceActivity.type === 'ACTIVITY_START')
            events.onInputActivity('start', offset);
          if (message.voiceActivity.type === 'ACTIVITY_END') events.onInputActivity('end', offset);
        }
      }
      const content = message.serverContent;
      if (!content) return;
      if (content.inputTranscription?.text)
        events.onInputTranscript(content.inputTranscription.text);
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          turnOpen = true;
          events.onAudio(Buffer.from(part.inlineData.data, 'base64'));
        }
      }
      if (content.outputTranscription?.text) {
        turnOpen = true;
        events.onOutputTranscript(content.outputTranscription.text);
      }
      if (content.interrupted) {
        events.onInterrupted();
        completeTurn();
      }
      if (content.generationComplete || content.turnComplete) completeTurn();
    });

    socket.on('error', (cause) => {
      // The URL carries the API key, so the raw error is logged without it and the
      // client gets a fixed message.
      this.logger.warn(
        `Live connection error: ${cause.message.replace(/key=[^&\s]+/g, 'key=<redacted>')}`,
      );
      events.onError('The real-time voice model connection failed');
    });

    socket.on('close', (code, reason) => {
      if (closed) return;
      closed = true;
      if (!ready) {
        this.logger.warn(
          `Live session closed during setup (${code}): ${reason.toString().slice(0, 200)}`,
        );
        events.onError('The real-time voice model rejected the session');
      }
      events.onClose();
    });

    return {
      sendAudio: (pcm) => {
        if (!ready || socket.readyState !== WebSocket.OPEN) return;
        socket.send(
          JSON.stringify({
            realtimeInput: {
              audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
            },
          }),
        );
      },
      close: () => {
        closed = true;
        socket.close();
      },
    };
  }
}
