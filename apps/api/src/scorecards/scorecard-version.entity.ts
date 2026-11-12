import type { ScorecardDefinition } from '@scorecard/domain';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
  type Relation,
} from 'typeorm';
import { ScorecardEntity } from './scorecard.entity.js';

// Immutable. Publishing an edit inserts the next version; nothing updates a row here.
// Runs, evaluations and coach reviews each point at the exact version they used.
@Entity('scorecard_versions')
@Unique(['scorecardId', 'version'])
export class ScorecardVersionEntity {
  @PrimaryColumn('text')
  id: string;

  @Column('text')
  scorecardId: string;

  @ManyToOne(() => ScorecardEntity, (scorecard) => scorecard.versions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'scorecardId' })
  scorecard: Relation<ScorecardEntity>;

  @Column('integer')
  version: number;

  @Column('simple-json')
  definition: ScorecardDefinition;

  @Column('text')
  createdAt: string;
}
