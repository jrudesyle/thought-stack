import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use forks pool so native addons (better-sqlite3) load correctly
    pool: 'forks',
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'property',
          include: ['tests/property/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 10_000,
        },
      },
    ],
  },
});
