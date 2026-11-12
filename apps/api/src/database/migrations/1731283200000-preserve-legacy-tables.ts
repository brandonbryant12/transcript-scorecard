import type { MigrationInterface, QueryRunner } from 'typeorm';

// Tables from the first version of this project that share a name with a table in the
// current schema, or were replaced by one.
const LEGACY_TABLES = [
  'calls',
  'criteria',
  'runs',
  'run_calls',
  'run_criteria',
  'evaluations',
  'criterion_results',
  'live_sessions',
  'live_snapshots',
];

// A database created by the first version is kept, not dropped. Its tables are renamed
// out of the way so earlier results stay readable with any SQLite client, and the
// current schema is then created beside them. A fresh database has nothing to rename.
export class PreserveLegacyTables1731283200000 implements MigrationInterface {
  name = 'PreserveLegacyTables1731283200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // `criteria` only ever existed in the first schema, so it identifies one reliably.
    if (!(await queryRunner.hasTable('criteria'))) return;
    for (const table of LEGACY_TABLES) {
      if (
        (await queryRunner.hasTable(table)) &&
        !(await queryRunner.hasTable(`legacy_v1_${table}`))
      ) {
        await queryRunner.query(`ALTER TABLE "${table}" RENAME TO "legacy_v1_${table}"`);
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of LEGACY_TABLES) {
      if (
        (await queryRunner.hasTable(`legacy_v1_${table}`)) &&
        !(await queryRunner.hasTable(table))
      ) {
        await queryRunner.query(`ALTER TABLE "legacy_v1_${table}" RENAME TO "${table}"`);
      }
    }
  }
}
