import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import {
  ReviewInputSchema,
  type CoachReview,
  type ReviewInput,
  type ReviewQueueItem,
} from '@scorecard/domain';
import { z } from 'zod';
import { ReviewsService } from './reviews.service.js';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('queue')
  queue(): Promise<ReviewQueueItem[]> {
    return this.reviews.queue();
  }

  @Get()
  listForCall(
    @Query('callId', { schema: z.string().min(1) }) callId: string,
  ): Promise<CoachReview[]> {
    return this.reviews.listForCall(callId);
  }

  @Put()
  save(@Body({ schema: ReviewInputSchema }) input: ReviewInput): Promise<CoachReview> {
    return this.reviews.save(input);
  }
}
