import type { CoachBehaviorLabel } from '@scorecard/domain';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';
import { CoachReviewEntity } from './coach-review.entity.js';

// Whether a coach saw one behaviour happen: yes, no, or not applicable.
@Entity('coach_behavior_labels')
export class CoachBehaviorLabelEntity {
  @PrimaryColumn('text')
  reviewId: string;

  @PrimaryColumn('text')
  behaviorId: string;

  @ManyToOne(() => CoachReviewEntity, (review) => review.behaviors, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reviewId' })
  review: Relation<CoachReviewEntity>;

  @Column('text')
  label: CoachBehaviorLabel;
}
