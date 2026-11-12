import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { CoachReview, ReviewInput, ReviewQueueItem } from '@scorecard/domain';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { CallsService } from '../calls/calls.service.js';
import { ScorecardsService } from '../scorecards/scorecards.service.js';
import { CoachBehaviorLabelEntity } from './coach-behavior-label.entity.js';
import { CoachReviewEntity } from './coach-review.entity.js';
import { CoachSkillRatingEntity } from './coach-skill-rating.entity.js';

const toReview = (entity: CoachReviewEntity): CoachReview => ({
  id: entity.id,
  callId: entity.callId,
  scorecardVersionId: entity.scorecardVersionId,
  coachName: entity.coachName,
  status: entity.status,
  notes: entity.notes,
  ratings: entity.ratings.map(({ skillId, level, note }) => ({ skillId, level, note })),
  behaviors: entity.behaviors.map(({ behaviorId, label }) => ({ behaviorId, label })),
  createdAt: entity.createdAt,
  updatedAt: entity.updatedAt,
  submittedAt: entity.submittedAt,
});

// Coach reviews are the ground truth the AI is measured against. A coach rates a call on
// the same scorecard the AI uses, without seeing the AI's result.
@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(CoachReviewEntity) private readonly reviews: Repository<CoachReviewEntity>,
    private readonly dataSource: DataSource,
    private readonly scorecards: ScorecardsService,
    private readonly calls: CallsService,
  ) {}

  async listForCall(callId: string): Promise<CoachReview[]> {
    const reviews = await this.reviews.find({
      where: { callId },
      relations: { ratings: true, behaviors: true },
      order: { createdAt: 'ASC' },
    });
    return reviews.map(toReview);
  }

  // Only reviews a coach has explicitly submitted count as ground truth.
  async listSubmitted(): Promise<CoachReview[]> {
    const reviews = await this.reviews.find({
      where: { status: 'submitted' },
      relations: { ratings: true, behaviors: true },
      order: { createdAt: 'ASC' },
    });
    return reviews.map(toReview);
  }

  // One review per coach per call. Saving replaces that coach's earlier ratings for the
  // call and pins the review to the scorecard version active at the time.
  async save(input: ReviewInput): Promise<CoachReview> {
    if (!(await this.calls.findEntity(input.callId))) throw new NotFoundException('Call not found');
    const scorecard = await this.scorecards.getActive();
    this.assertMatchesScorecard(input, scorecard.definition);

    const now = new Date().toISOString();
    const existing = await this.reviews.findOneBy({
      callId: input.callId,
      coachName: input.coachName,
    });
    const id = existing?.id ?? `review-${randomUUID()}`;

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(CoachSkillRatingEntity, { reviewId: id });
      await manager.delete(CoachBehaviorLabelEntity, { reviewId: id });
      await manager.save(
        CoachReviewEntity,
        manager.create(CoachReviewEntity, {
          id,
          callId: input.callId,
          scorecardVersionId: scorecard.id,
          coachName: input.coachName,
          status: input.submit ? 'submitted' : 'draft',
          notes: input.notes,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          // The first submission time is kept when a submitted review is corrected.
          submittedAt: input.submit ? (existing?.submittedAt ?? now) : null,
          ratings: input.ratings.map((rating) => ({ reviewId: id, ...rating })),
          behaviors: input.behaviors.map((label) => ({ reviewId: id, ...label })),
        }),
      );
    });

    const saved = await this.reviews.findOneOrFail({
      where: { id },
      relations: { ratings: true, behaviors: true },
    });
    return toReview(saved);
  }

  // What to review next. Unreviewed calls come first, and among those the calls where
  // the AI is least sure of itself: a coach's time buys the most information there.
  // The queue says the AI is unsure; it never says what the AI scored.
  async queue(): Promise<ReviewQueueItem[]> {
    const [calls, submitted] = await Promise.all([this.calls.list(), this.listSubmitted()]);
    const coachesByCall = new Map<string, string[]>();
    for (const review of submitted) {
      coachesByCall.set(review.callId, [
        ...(coachesByCall.get(review.callId) ?? []),
        review.coachName,
      ]);
    }
    const items = calls
      .filter((call) => call.turnCount > 0)
      .map((call): ReviewQueueItem => {
        const coaches = coachesByCall.get(call.id) ?? [];
        return {
          callId: call.id,
          subject: call.subject,
          customerName: call.customerName,
          agentName: call.agentName,
          turnCount: call.turnCount,
          submittedReviews: coaches.length,
          coaches,
          aiNeedsReview: call.latest?.needsReview ?? false,
          aiConfidence: call.latest?.confidence ?? null,
        };
      });
    const priority = (item: ReviewQueueItem): number =>
      (item.submittedReviews === 0 ? 0 : 10) +
      (item.aiNeedsReview ? 0 : 1) +
      (item.aiConfidence ?? 1);
    return items.sort((a, b) => priority(a) - priority(b));
  }

  private assertMatchesScorecard(
    input: ReviewInput,
    definition: Awaited<ReturnType<ScorecardsService['getActive']>>['definition'],
  ): void {
    const skills = new Map(definition.skills.map((skill) => [skill.id, skill]));
    const behaviorIds = new Set(
      definition.skills.flatMap((skill) => skill.behaviors.map(({ id }) => id)),
    );
    for (const rating of input.ratings) {
      const skill = skills.get(rating.skillId);
      if (!skill) throw new BadRequestException(`Unknown skill: ${rating.skillId}`);
      if (rating.level !== null && rating.level >= skill.levels.length) {
        throw new BadRequestException(`${skill.name} has no level ${rating.level}`);
      }
    }
    for (const label of input.behaviors) {
      if (!behaviorIds.has(label.behaviorId)) {
        throw new BadRequestException(`Unknown behaviour: ${label.behaviorId}`);
      }
    }
    if (input.submit && !input.ratings.some((rating) => rating.level !== null)) {
      throw new BadRequestException('Rate at least one skill before submitting');
    }
  }
}
