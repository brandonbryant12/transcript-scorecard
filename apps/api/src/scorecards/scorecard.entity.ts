import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { ScorecardVersionEntity } from './scorecard-version.entity.js';

// A named scorecard. Its content lives in its versions; this row only gives them a home.
@Entity('scorecards')
export class ScorecardEntity {
  @PrimaryColumn('text')
  id: string;

  @Column('text')
  name: string;

  @Column('text')
  createdAt: string;

  @OneToMany(() => ScorecardVersionEntity, (version) => version.scorecard)
  versions: ScorecardVersionEntity[];
}
