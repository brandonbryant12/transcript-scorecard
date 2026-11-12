import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsModule } from '../calls/calls.module.js';
import { ScorecardsModule } from '../scorecards/scorecards.module.js';
import { CoachBehaviorLabelEntity } from './coach-behavior-label.entity.js';
import { CoachReviewEntity } from './coach-review.entity.js';
import { CoachSkillRatingEntity } from './coach-skill-rating.entity.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([CoachReviewEntity, CoachSkillRatingEntity, CoachBehaviorLabelEntity]),
    ScorecardsModule,
    CallsModule,
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
