import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';
import { CoachReviewEntity } from './coach-review.entity.js';

// The rubric level a coach gave one skill, or their judgement that it did not apply.
@Entity('coach_skill_ratings')
export class CoachSkillRatingEntity {
  @PrimaryColumn('text')
  reviewId: string;

  @PrimaryColumn('text')
  skillId: string;

  @ManyToOne(() => CoachReviewEntity, (review) => review.ratings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reviewId' })
  review: Relation<CoachReviewEntity>;

  // null: the coach judged the skill not applicable to this call.
  @Column('integer', { nullable: true })
  level: number | null;

  @Column('text')
  note: string;
}
