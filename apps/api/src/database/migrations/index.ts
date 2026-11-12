import { PreserveLegacyTables1731283200000 } from './1731283200000-preserve-legacy-tables.js';
import { InitialSchema1731283200001 } from './1731283200001-initial-schema.js';

// Listed explicitly, oldest first, so the same set runs under the application, the tests
// and the CLI without depending on file globs.
export const MIGRATIONS = [PreserveLegacyTables1731283200000, InitialSchema1731283200001];
