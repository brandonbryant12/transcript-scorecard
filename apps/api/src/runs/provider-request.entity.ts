import type { ScoringProvider, Stage } from '@scorecard/domain';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// The request ledger: one row per provider API call, successful or not. Latency
// percentiles, token totals and cost for a run are sums over these rows.
@Entity('provider_requests')
@Index(['runId'])
export class ProviderRequestEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('text')
  runId: string;

  @Column('text')
  callId: string;

  @Column('text')
  provider: ScoringProvider;

  // null when the request failed before the provider named a model.
  @Column('text', { nullable: true })
  model: string | null;

  @Column('text')
  stage: Stage;

  @Column('integer')
  turnCount: number;

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

  @Column('boolean')
  ok: boolean;

  @Column('text')
  startedAt: string;
}
