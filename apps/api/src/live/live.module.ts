import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsModule } from '../calls/calls.module.js';
import { EvaluationsModule } from '../evaluations/evaluations.module.js';
import { RunsModule } from '../runs/runs.module.js';
import { ScorecardsModule } from '../scorecards/scorecards.module.js';
import { ScoringModule } from '../scoring/scoring.module.js';
import { LiveCoordinator } from './live-coordinator.service.js';
import { LiveSessionEntity } from './live-session.entity.js';
import { LiveSessionsService } from './live-sessions.service.js';
import { LiveController } from './live.controller.js';
import { TurnMediaStore } from './turn-media.store.js';

// Scoring while a call is in progress: replays of stored calls and streams fed by a
// real-time source.
@Module({
  imports: [
    TypeOrmModule.forFeature([LiveSessionEntity]),
    ScorecardsModule,
    CallsModule,
    RunsModule,
    EvaluationsModule,
    ScoringModule,
  ],
  controllers: [LiveController],
  providers: [LiveSessionsService, LiveCoordinator, TurnMediaStore],
  exports: [LiveCoordinator, TurnMediaStore],
})
export class LiveModule {}
