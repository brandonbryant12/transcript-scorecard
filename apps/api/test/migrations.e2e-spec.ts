import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/database/data-source-options.js';

const CURRENT_TABLES = [
  'behavior_results',
  'calls',
  'coach_behavior_labels',
  'coach_reviews',
  'coach_skill_ratings',
  'evaluations',
  'live_sessions',
  'provider_requests',
  'run_calls',
  'scorecard_versions',
  'scorecards',
  'scoring_runs',
  'skill_results',
];

const tablesOf = async (dataSource: DataSource): Promise<string[]> => {
  const rows: Array<{ name: string }> = await dataSource.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return rows.map((row) => row.name);
};

describe('migrations', () => {
  it('create the current schema on a fresh in-memory database', async () => {
    const dataSource = new DataSource(dataSourceOptions(':memory:'));
    await dataSource.initialize();
    try {
      const tables = await tablesOf(dataSource);
      expect(tables).toEqual(expect.arrayContaining([...CURRENT_TABLES, 'migrations']));
      expect(tables.filter((name) => name.startsWith('temporary_'))).toEqual([]);
      expect(tables.filter((name) => name.startsWith('legacy_v1_'))).toEqual([]);
      expect(await dataSource.showMigrations()).toBe(false);
    } finally {
      await dataSource.destroy();
    }
  });

  describe('on a database from the first version', () => {
    let directory: string;
    let file: string;

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), 'scorecard-migrations-'));
      file = join(directory, 'legacy.sqlite');
      const legacy = new Database(file);
      legacy.exec(`
        CREATE TABLE criteria (id TEXT PRIMARY KEY, label TEXT NOT NULL);
        CREATE TABLE calls (id TEXT PRIMARY KEY, title TEXT NOT NULL, transcript TEXT NOT NULL);
        INSERT INTO criteria VALUES ('empathy', 'Empathy');
        INSERT INTO calls VALUES ('old-call-1', 'Legacy call', '[]');
      `);
      legacy.close();
    });

    afterEach(() => {
      rmSync(directory, { recursive: true, force: true });
    });

    it('preserves the legacy tables under legacy_v1_ and creates the new schema beside them', async () => {
      const dataSource = new DataSource(dataSourceOptions(file));
      await dataSource.initialize();
      try {
        const tables = await tablesOf(dataSource);
        expect(tables).toEqual(
          expect.arrayContaining(['legacy_v1_calls', 'legacy_v1_criteria', ...CURRENT_TABLES]),
        );
        expect(tables).not.toContain('criteria');

        expect(await dataSource.query('SELECT id, title FROM legacy_v1_calls')).toEqual([
          { id: 'old-call-1', title: 'Legacy call' },
        ]);
        expect(await dataSource.query('SELECT COUNT(*) AS count FROM calls')).toEqual([
          { count: 0 },
        ]);
        const columns: Array<{ name: string }> = await dataSource.query('PRAGMA table_info(calls)');
        expect(columns.map((column) => column.name)).toEqual(
          expect.arrayContaining(['customerName', 'agentName', 'source', 'transcript']),
        );
      } finally {
        await dataSource.destroy();
      }
    });

    it('is idempotent across restarts', async () => {
      for (let start = 0; start < 2; start++) {
        const dataSource = new DataSource(dataSourceOptions(file));
        await dataSource.initialize();
        await dataSource.destroy();
      }
      const reopened = new Database(file, { readonly: true });
      try {
        const migrations = reopened.prepare('SELECT name FROM migrations ORDER BY id').all();
        expect(migrations).toEqual([
          { name: 'PreserveLegacyTables1731283200000' },
          { name: 'InitialSchema1731283200001' },
        ]);
      } finally {
        reopened.close();
      }
    });
  });
});
