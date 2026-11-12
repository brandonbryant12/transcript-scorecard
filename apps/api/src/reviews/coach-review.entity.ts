import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  Unique,
  type Relation,
} from 'typeorm';
import { CallEntity } from '../calls/call.entity.js';
import { ScorecardVersionEntity } from '../scorecards/scorecard-version.entity.js';
import { CoachBehaviorLabelEntity } from './coach-behavior-label.entity.js';
import { CoachSkillRatingEntity } from './coach-skill-rating.entity.js';

// A coach's independent rating of one call: the ground truth the AI is measured
// against. One review per coach per call, pinned to the scorecard version it used.
@Entity('coach_reviews')
@Unique(['callId', 'coachName'])
export class CoachReviewEntity {
  @PrimaryColumn('text')
  id: string;

  @Column('text')
  callId: string;

  @ManyToOne(() => CallEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'callId' })
  call: Relation<CallEntity>;

  @Column('text')
  scorecardVersionId: string;

  @ManyToOne(() => ScorecardVersionEntity)
  @JoinColumn({ name: 'scorecardVersionId' })
  scorecardVersion: Relation<ScorecardVersionEntity>;

  @Column('text')
  coachName: string;

  // Only submitted reviews count as ground truth; a draft is work in progress.
  @Column('text')
  status: 'draft' | 'submitted';

  @Column('text')
  notes: string;

  @Column('text')
  createdAt: string;

  @Column('text')
  updatedAt: string;

  @Column('text', { nullable: true })
  submittedAt: string | null;

  @OneToMany(() => CoachSkillRatingEntity, (rating) => rating.review, { cascade: ['insert'] })
  ratings: CoachSkillRatingEntity[];

  @OneToMany(() => CoachBehaviorLabelEntity, (label) => label.review, { cascade: ['insert'] })
  behaviors: CoachBehaviorLabelEntity[];
}
