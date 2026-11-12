import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Pins a throwaway database and fake provider keys before any module loads.
    setupFiles: ['./test/setup-env.ts'],
  },
});
