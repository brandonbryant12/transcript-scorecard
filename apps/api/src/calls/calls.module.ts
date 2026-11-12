import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EvaluationsModule } from '../evaluations/evaluations.module.js';
import { CoachReviewEntity } from '../reviews/coach-review.entity.js';
import { RunCallEntity } from '../runs/run-call.entity.js';
import { CallEntity } from './call.entity.js';
import { CallsController } from './calls.controller.js';
import { CallsService } from './calls.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([CallEntity, RunCallEntity, CoachReviewEntity]),
    EvaluationsModule,
  ],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
