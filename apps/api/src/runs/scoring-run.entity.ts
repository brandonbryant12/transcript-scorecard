import type { RunKind, RunStatus, ScoringProvider } from '@scorecard/domain';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { ScorecardVersionEntity } from '../scorecards/scorecard-version.entity.js';
import { RunCallEntity } from './run-call.entity.js';

// One scoring run: a batch over finished calls, or one live session from first turn to
// last. It fixes the provider, scorecard version and method version for everything
// produced under it, so two runs can be compared knowing exactly what differed.
@Entity('scoring_runs')
export class ScoringRunEntity {
  @PrimaryColumn('text')
  id: string;

  @Column('text')
  kind: RunKind;

  @Column('text')
  provider: ScoringProvider;

  @Column('text')
  scorecardVersionId: string;

  @ManyToOne(() => ScorecardVersionEntity)
  @JoinColumn({ name: 'scorecardVersionId' })
  scorecardVersion: Relation<ScorecardVersionEntity>;

  @Column('text')
  methodVersion: string;

  @Column('text')
  status: RunStatus;

  @Column('integer')
  total: number;

  @Column('integer', { default: 0 })
  completed: number;

  @Column('integer', { default: 0 })
  failed: number;

  @Column('text')
  createdAt: string;

  @Column('text', { nullable: true })
  startedAt: string | null;

  @Column('text', { nullable: true })
  completedAt: string | null;

  @OneToMany(() => RunCallEntity, (runCall) => runCall.run)
  calls: RunCallEntity[];
}
