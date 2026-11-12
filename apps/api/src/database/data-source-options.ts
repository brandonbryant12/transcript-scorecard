import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities.js';
import { MIGRATIONS } from './migrations/index.js';

// One definition of the database, used by the running application, the tests and the
// TypeORM CLI. The schema is owned by migrations: `synchronize` stays off so the tables
// never drift from what the migrations describe.
export const dataSourceOptions = (database: string): DataSourceOptions => {
  if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
  return {
    type: 'better-sqlite3',
    database,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsRun: true,
    synchronize: false,
  };
};
