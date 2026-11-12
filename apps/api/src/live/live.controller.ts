import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import {
  AppendTurnSchema,
  ControlLiveSchema,
  CreateReplaySchema,
  CreateStreamSchema,
  type AppendTurnInput,
  type ControlLiveInput,
  type CreateReplayInput,
  type CreateStreamInput,
  type LiveSessionDetail,
  type TranscriptTurn,
} from '@scorecard/domain';
import { map, type Observable } from 'rxjs';
import { CredentialsService } from '../decisions/credentials.service.js';
import { LiveCoordinator } from './live-coordinator.service.js';

@Controller('live')
export class LiveController {
  constructor(
    private readonly coordinator: LiveCoordinator,
    private readonly credentials: CredentialsService,
  ) {}

  // Replay a stored call: its turns are revealed on a timer and scored as they appear.
  @Post()
  async createReplay(
    @Body({ schema: CreateReplaySchema }) input: CreateReplayInput,
  ): Promise<LiveSessionDetail> {
    const provider = input.provider ?? this.credentials.defaultProvider;
    this.credentials.keyFor(provider);
    const session = await this.coordinator.createReplay(input.callId, provider, input);
    if (!session) throw new NotFoundException('Call not found');
    return session;
  }

  // Open a stream: a call that does not exist yet. Any real-time source (a speech-to-text
  // service, a voice model, a script) then posts turns to /live/:id/turns as they happen.
  @Post('stream')
  createStream(
    @Body({ schema: CreateStreamSchema }) input: CreateStreamInput,
  ): Promise<LiveSessionDetail> {
    const provider = input.provider ?? this.credentials.defaultProvider;
    this.credentials.keyFor(provider);
    return this.coordinator.createStream(input, provider);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<LiveSessionDetail> {
    const session = await this.coordinator.get(id);
    if (!session) throw new NotFoundException('Live session not found');
    return session;
  }

  // The session now, then again after every change.
  @Sse(':id/events')
  events(@Param('id') id: string): Observable<MessageEvent> {
    return this.coordinator.watch(id).pipe(map((session) => ({ data: session })));
  }

  @Post(':id/turns')
  async appendTurn(
    @Param('id') id: string,
    @Body({ schema: AppendTurnSchema }) input: AppendTurnInput,
  ): Promise<TranscriptTurn> {
    const turn = await this.coordinator.appendTurn(id, input);
    if (!turn) throw new ConflictException('This session is not an open stream');
    return turn;
  }

  @Post(':id/control')
  @HttpCode(200)
  async control(
    @Param('id') id: string,
    @Body({ schema: ControlLiveSchema }) input: ControlLiveInput,
  ): Promise<LiveSessionDetail> {
    const session = await this.coordinator.control(id, input);
    if (!session) throw new NotFoundException('Live session not found');
    return session;
  }
}
