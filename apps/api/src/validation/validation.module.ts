import { Module } from '@nestjs/common';
import { CallsModule } from '../calls/calls.module.js';
import { EvaluationsModule } from '../evaluations/evaluations.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';
import { ValidationController } from './validation.controller.js';

@Module({
  imports: [ReviewsModule, EvaluationsModule, CallsModule],
  controllers: [ValidationController],
})
export class ValidationModule {}
