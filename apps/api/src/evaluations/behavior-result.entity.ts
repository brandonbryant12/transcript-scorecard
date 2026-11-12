import type { BehaviorPolarity, BehaviorStatus } from '@scorecard/domain';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';
import { EvaluationEntity } from './evaluation.entity.js';

// One behaviour's outcome within an evaluation.
@Entity('behavior_results')
export class BehaviorResultEntity {
  @PrimaryColumn('text')
  evaluationId: string;

  @PrimaryColumn('text')
  behaviorId: string;

  @ManyToOne(() => EvaluationEntity, (evaluation) => evaluation.behaviorResults, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'evaluationId' })
  evaluation: Relation<EvaluationEntity>;

  @Column('text')
  skillId: string;

  @Column('text')
  polarity: BehaviorPolarity;

  @Column('text')
  status: BehaviorStatus;

  // The strongest single-turn detection of the behaviour.
  @Column('real')
  probability: number;
}
