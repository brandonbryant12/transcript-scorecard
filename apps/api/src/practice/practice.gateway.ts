import { Inject, Logger, StandardSchemaValidationPipe, UsePipes } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WsException,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import {
  PracticeStartSchema,
  PROVIDERS,
  type PracticeServerMessage,
  type PracticeStart,
} from '@scorecard/domain';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { CredentialsService } from '../decisions/credentials.service.js';
import { LiveCoordinator } from '../live/live-coordinator.service.js';
import { PracticeCall } from './practice-call.js';
import { REALTIME, type RealtimeModel } from './realtime-model.js';
import { customerInstruction, findScenario } from './scenarios.js';

// Base64 for at most a second of 16 kHz PCM, and for a small JPEG frame.
const AudioChunk = z.string().max(64_000);
const Frame = z.string().max(400_000);

// The practice call. The browser opens one WebSocket, streams microphone audio (and
// optionally camera frames) up, and gets the customer's voice back. Behind it a
// real-time voice model plays the customer, and every finished turn is appended to a
// live stream session, where it is scored like any other call.
//
// The model's API key stays on the server; the browser never talks to the model itself.
@UsePipes(
  new StandardSchemaValidationPipe({
    exceptionFactory: (issues) => new WsException(issues.map((issue) => issue.message)),
  }),
)
@WebSocketGateway({ path: '/api/practice' })
export class PracticeGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(PracticeGateway.name);
  private readonly calls = new Map<
    WebSocket,
    { readonly call: PracticeCall; readonly sessionId: string }
  >();

  constructor(
    @Inject(REALTIME) private readonly realtime: RealtimeModel,
    private readonly credentials: CredentialsService,
    private readonly coordinator: LiveCoordinator,
  ) {}

  @SubscribeMessage('start')
  async start(
    @ConnectedSocket() client: WebSocket,
    @MessageBody({ schema: PracticeStartSchema }) input: PracticeStart,
  ): Promise<void> {
    const send = (message: PracticeServerMessage): void => {
      if (client.readyState === client.OPEN) client.send(JSON.stringify(message));
    };
    const fail = (message: string): void => send({ event: 'error', data: { message } });

    if (this.calls.has(client))
      return fail('A practice call is already running on this connection');
    const scenario = findScenario(input.scenarioId);
    if (!scenario) return fail('Unknown scenario');
    if (!this.realtime.isAvailable()) {
      return fail(`${this.realtime.envVar} is not configured on the API server`);
    }
    const provider = input.provider ?? this.credentials.defaultProvider;
    if (!this.credentials.isConfigured(provider)) {
      return fail(`${PROVIDERS[provider].envVar} is not configured on the API server`);
    }

    // The practice call is a stream session like any other; scoring every turn keeps
    // the coaching close behind the conversation.
    const session = await this.coordinator.createStream(
      {
        subject: scenario.subject,
        customerName: scenario.customerName,
        agentName: input.agentName,
        scoreEveryTurns: 1,
      },
      provider,
    );
    const call = new PracticeCall({
      appendTurn: (speaker, text, media) =>
        this.coordinator.appendTurn(session.id, { speaker, text }, media),
      send,
      // Clips are only worth keeping when the scoring provider can listen to them.
      captureMedia: PROVIDERS[provider].media,
    });
    call.attach(
      this.realtime.connect(
        { systemInstruction: customerInstruction(scenario, input.agentName) },
        {
          onReady: () => {
            call.onReady();
            send({ event: 'ready', data: { sessionId: session.id } });
          },
          onAudio: (pcm) => call.onAudio(pcm),
          onInputTranscript: (text) => call.onInputTranscript(text),
          onOutputTranscript: (text) => call.onOutputTranscript(text),
          onInputActivity: (kind, offset) => call.onInputActivity(kind, offset),
          onTurnComplete: () => call.onTurnComplete(),
          onInterrupted: () => call.onInterrupted(),
          onError: (message) => call.onError(message),
          // The model hanging up ends the call the same way the employee would.
          onClose: () => void this.finish(client),
        },
      ),
    );
    this.calls.set(client, { call, sessionId: session.id });
  }

  @SubscribeMessage('audio')
  audio(
    @ConnectedSocket() client: WebSocket,
    @MessageBody({ schema: AudioChunk }) data: string,
  ): void {
    this.calls.get(client)?.call.receiveAudio(Buffer.from(data, 'base64'));
  }

  @SubscribeMessage('frame')
  frame(@ConnectedSocket() client: WebSocket, @MessageBody({ schema: Frame }) data: string): void {
    this.calls.get(client)?.call.receiveFrame(data);
  }

  @SubscribeMessage('end')
  async end(@ConnectedSocket() client: WebSocket): Promise<void> {
    await this.finish(client);
  }

  // A closed tab ends the call too, so the session still gets its final evaluation.
  async handleDisconnect(client: WebSocket): Promise<void> {
    await this.finish(client);
  }

  private async finish(client: WebSocket): Promise<void> {
    const active = this.calls.get(client);
    if (!active) return;
    this.calls.delete(client);
    try {
      await active.call.end();
      await this.coordinator.control(active.sessionId, { action: 'end' });
    } catch (cause) {
      this.logger.error(`Ending practice session ${active.sessionId} failed`, cause);
    }
    if (client.readyState === client.OPEN)
      client.send(JSON.stringify({ event: 'ended', data: null }));
  }
}
