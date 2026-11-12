import type { Channel } from '@scorecard/domain';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';
import { EvaluationEntity } from './evaluation.entity.js';

// One skill's result within an evaluation, flat, so agreement with coach ratings and
// score history are plain queries.
@Entity('skill_results')
export class SkillResultEntity {
  @PrimaryColumn('text')
  evaluationId: string;

  @PrimaryColumn('text')
  skillId: string;

  @ManyToOne(() => EvaluationEntity, (evaluation) => evaluation.skillResults, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'evaluationId' })
  evaluation: Relation<EvaluationEntity>;

  @Column('text')
  channel: Channel;

  // false when the skill needs audio or video the call did not have.
  @Column('boolean')
  assessed: boolean;

  @Column('real')
  weight: number;

  @Column('integer')
  levelCount: number;

  // The model's probability-weighted level; can fall between rubric levels.
  @Column('real')
  expectedLevel: number;

  // The single most likely level: what is compared with a coach's rating.
  @Column('integer')
  level: number;

  @Column('real')
  normalizedScore: number;

  @Column('real')
  confidence: number;

  @Column('real')
  observability: number;
}
