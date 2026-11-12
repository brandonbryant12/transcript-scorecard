import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsModule } from '../calls/calls.module.js';
import { EvaluationsModule } from '../evaluations/evaluations.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';
import { ScorecardsModule } from '../scorecards/scorecards.module.js';
import { ScoringModule } from '../scoring/scoring.module.js';
import { ProviderRequestEntity } from './provider-request.entity.js';
import { RunCallEntity } from './run-call.entity.js';
import { RunProcessor } from './run-processor.service.js';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';
import { ScoringRunEntity } from './scoring-run.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScoringRunEntity, RunCallEntity, ProviderRequestEntity]),
    ScorecardsModule,
    CallsModule,
    EvaluationsModule,
    ReviewsModule,
    ScoringModule,
  ],
  controllers: [RunsController],
  providers: [RunsService, RunProcessor],
  exports: [RunsService],
})
export class RunsModule {}
