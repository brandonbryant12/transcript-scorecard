import type { LiveSource, LiveStatus, ScoringProvider, ScoringState } from '@scorecard/domain';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';
import { CallEntity } from '../calls/call.entity.js';
import { ScoringRunEntity } from '../runs/scoring-run.entity.js';
import { ScorecardVersionEntity } from '../scorecards/scorecard-version.entity.js';

// Playback and scoring state for one live session. Its results are ordinary evaluations
// under `runId`; resetting a replay gives the session a new run rather than erasing
// what the old one produced.
@Entity('live_sessions')
export class LiveSessionEntity {
  @PrimaryColumn('text')
  id: string;

  @Column('text')
  callId: string;

  @ManyToOne(() => CallEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'callId' })
  call: Relation<CallEntity>;

  @Column('text')
  runId: string;

  @ManyToOne(() => ScoringRunEntity)
  @JoinColumn({ name: 'runId' })
  run: Relation<ScoringRunEntity>;

  @Column('text')
  provider: ScoringProvider;

  @Column('text')
  scorecardVersionId: string;

  @ManyToOne(() => ScorecardVersionEntity)
  @JoinColumn({ name: 'scorecardVersionId' })
  scorecardVersion: Relation<ScorecardVersionEntity>;

  // replay: a stored transcript revealed on a timer. stream: turns pushed in live.
  @Column('text')
  source: LiveSource;

  @Column('text')
  status: LiveStatus;

  // True once no more turns will arrive, so the next pass is the final one.
  @Column('boolean', { default: false })
  inputComplete: boolean;

  @Column('integer', { default: 0 })
  revealedTurnCount: number;

  @Column('integer', { default: 0 })
  scoredTurnCount: number;

  @Column('boolean', { default: false })
  isProcessing: boolean;

  @Column('text', { nullable: true })
  requestStartedAt: string | null;

  @Column('integer', { default: 0 })
  elapsedMs: number;

  @Column('integer')
  revealIntervalMs: number;

  @Column('integer')
  scoreEveryTurns: number;

  // The raw readings gathered so far. Each pass adds to them, so a turn is read once.
  @Column('simple-json')
  state: ScoringState;

  @Column('text', { nullable: true })
  latestEvaluationId: string | null;

  @Column('text', { nullable: true })
  error: string | null;

  @Column('text')
  createdAt: string;

  @Column('text')
  updatedAt: string;
}
