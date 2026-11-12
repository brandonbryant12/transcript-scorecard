import type { Evaluation, ScoringProvider, Stage } from '@scorecard/domain';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { CallEntity } from '../calls/call.entity.js';
import { ScoringRunEntity } from '../runs/scoring-run.entity.js';
import { ScorecardVersionEntity } from '../scorecards/scorecard-version.entity.js';
import { BehaviorResultEntity } from './behavior-result.entity.js';
import { SkillResultEntity } from './skill-result.entity.js';

// Everything the model produced is an evaluation, whether it came from a batch run or
// one pass of a live session. `document` is the full result as the web app renders it;
// the scalar columns and the two child tables repeat the numbers that lists, trends and
// agreement queries need, so those never have to open the document.
@Entity('evaluations')
@Index(['callId', 'stage', 'createdAt'])
@Index(['runId', 'createdAt'])
export class EvaluationEntity {
  @PrimaryColumn('text')
  id: string;

  @Column('text')
  callId: string;

  @ManyToOne(() => CallEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'callId' })
  call: Relation<CallEntity>;

  @Column('text')
  runId: string;

  @ManyToOne(() => ScoringRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'runId' })
  run: Relation<ScoringRunEntity>;

  @Column('text')
  provider: ScoringProvider;

  @Column('text')
  model: string;

  @Column('text')
  scorecardVersionId: string;

  @ManyToOne(() => ScorecardVersionEntity)
  @JoinColumn({ name: 'scorecardVersionId' })
  scorecardVersion: Relation<ScorecardVersionEntity>;

  @Column('text')
  methodVersion: string;

  // provisional while the call is live; final once the whole call has been seen.
  @Column('text')
  stage: Stage;

  @Column('integer')
  turnCount: number;

  @Column('real', { nullable: true })
  overallScore: number | null;

  @Column('real')
  coverage: number;

  @Column('real')
  confidence: number;

  @Column('boolean')
  needsReview: boolean;

  // Critical behaviours detected, so lists can flag a call without opening its document.
  @Column('integer')
  criticalFlagCount: number;

  @Column('integer')
  requestCount: number;

  @Column('integer')
  questionCount: number;

  @Column('integer')
  inputTokens: number;

  @Column('integer')
  outputTokens: number;

  @Column('integer')
  latencyMs: number;

  @Column('real')
  estimatedCostUsd: number;

  @Column('simple-json')
  document: Evaluation;

  @Column('text')
  createdAt: string;

  @OneToMany(() => SkillResultEntity, (result) => result.evaluation, { cascade: ['insert'] })
  skillResults: SkillResultEntity[];

  @OneToMany(() => BehaviorResultEntity, (result) => result.evaluation, { cascade: ['insert'] })
  behaviorResults: BehaviorResultEntity[];
}
