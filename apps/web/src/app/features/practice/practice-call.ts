import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { errorMessage } from '../../core/api/api-error';
import { PracticeApi } from '../../core/api/practice-api';
import type { PracticeServerMessage, PracticeStart } from '../../core/models';
import type { TranscriptCaption } from '../../shared/transcript/transcript';
import { CameraCapture } from './camera-capture';
import { MicCapture } from './mic-capture';
import { base64ToPcm16, pcm16ToBase64 } from './pcm';
import { PcmPlayer } from './pcm-player';
import { PracticeSocket } from './practice-socket';

/**
 * idle        nothing running
 * connecting  microphone granted, waiting for the service to say the call is ready
 * live        audio is flowing both ways
 * ending      the user ended the call; waiting for the service to confirm
 * ended       the call is over (the final evaluation may still be on its way)
 */
export type PracticePhase = 'idle' | 'connecting' | 'live' | 'ending' | 'ended';

/** Describes a refused or missing device in terms the user can act on. */
export function deviceErrorMessage(cause: unknown, device: 'microphone' | 'camera'): string {
  const name = cause instanceof DOMException ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `Access to the ${device} was blocked. Allow it for this site and try again.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return `No ${device} was found on this device.`;
  }
  if (name === 'NotReadableError') {
    return `The ${device} is in use by another application.`;
  }
  return `Could not start the ${device}: ${errorMessage(cause)}`;
}

/**
 * Runs one voice practice call: the microphone and optional camera go up the WebSocket,
 * the model's speech comes back and is played, and the service reports which live
 * session is scoring the conversation. Devices are always released when the call ends,
 * fails, or the page is left.
 */
@Injectable()
export class PracticeCall {
  private readonly api = inject(PracticeApi);
  private readonly socket = inject(PracticeSocket);
  private readonly mic = inject(MicCapture);
  private readonly player = inject(PcmPlayer);
  private readonly camera = inject(CameraCapture);

  private readonly phaseState = signal<PracticePhase>('idle');
  private readonly sessionState = signal<string | null>(null);
  private readonly captionState = signal<TranscriptCaption | null>(null);
  private readonly errorState = signal<string | null>(null);
  private readonly noticeState = signal<string | null>(null);

  readonly phase = this.phaseState.asReadonly();
  /** The live session scoring this call, once the service has created it. */
  readonly sessionId = this.sessionState.asReadonly();
  /** Speech heard so far that has not become a transcript turn yet. */
  readonly caption = this.captionState.asReadonly();
  readonly error = this.errorState.asReadonly();
  /** A problem that did not stop the call, such as the camera being refused. */
  readonly notice = this.noticeState.asReadonly();
  readonly cameraStream = this.camera.stream;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.shutDown());
  }

  async start(options: PracticeStart): Promise<void> {
    if (this.phaseState() === 'connecting' || this.phaseState() === 'live') return;
    this.shutDown();
    this.errorState.set(null);
    this.noticeState.set(null);
    this.captionState.set(null);
    this.sessionState.set(null);
    this.phaseState.set('connecting');

    // Devices first: the browser only prompts inside the click that started the call,
    // and there is no point opening a call the user cannot speak on.
    try {
      await this.player.resume();
      await this.mic.start((pcm) => {
        if (this.phaseState() === 'live') {
          this.socket.send({ event: 'audio', data: pcm16ToBase64(pcm) });
        }
      });
    } catch (cause) {
      return this.fail(deviceErrorMessage(cause, 'microphone'));
    }
    let request = options;
    if (request.video) {
      try {
        await this.camera.start((frame) => {
          if (this.phaseState() === 'live') this.socket.send({ event: 'frame', data: frame });
        });
      } catch (cause) {
        // The call is still worth having without video.
        this.noticeState.set(`${deviceErrorMessage(cause, 'camera')} Continuing with audio only.`);
        request = { ...request, video: false };
      }
    }

    try {
      await this.socket.open(this.api.socketUrl(), {
        onMessage: (message) => this.handle(message),
        onClose: () => this.handleClose(),
      });
    } catch (cause) {
      return this.fail(errorMessage(cause));
    }
    this.socket.send({ event: 'start', data: request });
  }

  /** Ends the call. The board stays up so the final evaluation can arrive. */
  end(): void {
    if (this.phaseState() !== 'live' && this.phaseState() !== 'connecting') return;
    this.phaseState.set('ending');
    this.socket.send({ event: 'end', data: null });
    this.releaseDevices();
  }

  /** Clears the in-progress caption, once its words have arrived as a turn. */
  clearCaption(): void {
    this.captionState.set(null);
  }

  private handle(message: PracticeServerMessage): void {
    switch (message.event) {
      case 'ready':
        this.sessionState.set(message.data.sessionId);
        if (this.phaseState() === 'connecting') this.phaseState.set('live');
        break;
      case 'audio':
        if (this.phaseState() === 'live') this.player.enqueue(base64ToPcm16(message.data));
        break;
      case 'interrupted':
        this.player.flush();
        break;
      case 'caption':
        this.captionState.set(message.data);
        break;
      case 'ended':
        this.finish();
        break;
      case 'error':
        this.fail(message.data.message);
        break;
    }
  }

  private handleClose(): void {
    const phase = this.phaseState();
    if (phase === 'live' || phase === 'connecting') {
      this.fail('The practice call was disconnected.');
    } else if (phase === 'ending') {
      this.finish();
    }
  }

  private finish(): void {
    this.shutDown();
    this.phaseState.set('ended');
  }

  private fail(message: string): void {
    this.shutDown();
    this.errorState.set(message);
    // With a session, what was said so far is still on screen; without one, start over.
    this.phaseState.set(this.sessionState() === null ? 'idle' : 'ended');
  }

  private releaseDevices(): void {
    this.mic.stop();
    this.camera.stop();
  }

  private shutDown(): void {
    this.releaseDevices();
    this.player.close();
    this.socket.close();
    this.captionState.set(null);
  }
}
