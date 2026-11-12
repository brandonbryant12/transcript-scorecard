import type { CallSource, TranscriptTurn } from '@scorecard/domain';
import { Column, Entity, PrimaryColumn } from 'typeorm';

// A conversation and its transcript. A call has no stored status: whether it has been
// scored is derived from its evaluations and its most recent run.
@Entity('calls')
export class CallEntity {
  @PrimaryColumn('text')
  id: string;

  @Column('text')
  customerName: string;

  @Column('text')
  agentName: string;

  @Column('text')
  subject: string;

  @Column('text')
  startedAt: string;

  @Column('integer')
  durationSeconds: number;

  // seed: shipped with the demo. stream: turns were pushed in over the ingest API.
  @Column('text')
  source: CallSource;

  @Column('simple-json')
  transcript: TranscriptTurn[];
}
