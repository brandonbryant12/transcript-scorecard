import { DataSource } from 'typeorm';
import { envSchema } from '../config/env.js';
import { dataSourceOptions } from './data-source-options.js';

// Entry point for the TypeORM CLI (`pnpm --filter @scorecard/api migration:generate`).
// The application itself gets its DataSource from DatabaseModule.
export default new DataSource(dataSourceOptions(envSchema.parse(process.env).SCORECARD_DB_PATH));
