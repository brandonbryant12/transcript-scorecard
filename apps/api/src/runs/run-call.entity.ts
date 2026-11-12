import type { CallStatus } from '@scorecard/domain';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';
import { CallEntity } from '../calls/call.entity.js';
import { ScoringRunEntity } from './scoring-run.entity.js';

// The progress of one call inside one batch run.
@Entity('run_calls')
export class RunCallEntity {
  @PrimaryColumn('text')
  runId: string;

  @PrimaryColumn('text')
  callId: string;

  @ManyToOne(() => ScoringRunEntity, (run) => run.calls, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'runId' })
  run: Relation<ScoringRunEntity>;

  @ManyToOne(() => CallEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'callId' })
  call: Relation<CallEntity>;

  // Insertion order within the run, so results list in the order they were requested.
  @Column('integer')
  position: number;

  @Column('text')
  status: CallStatus;

  @Column('text', { nullable: true })
  error: string | null;

  @Column('text', { nullable: true })
  evaluationId: string | null;

  @Column('text')
  updatedAt: string;
}
