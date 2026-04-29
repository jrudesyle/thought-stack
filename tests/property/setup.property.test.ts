import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createTestDatabase } from '../helpers/db.ts';

describe('Property test setup', () => {
  it('fast-check runs correctly', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a);
      }),
      { numRuns: 100 }
    );
  });

  it('fast-check works with the test database', () => {
    const db = createTestDatabase();

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        (stackName) => {
          // Each iteration uses a fresh database
          const testDb = createTestDatabase();
          testDb
            .prepare("INSERT INTO notebook_stacks (id, name) VALUES (?, ?)")
            .run('s1', stackName);

          const row = testDb
            .prepare("SELECT name FROM notebook_stacks WHERE id = ?")
            .get('s1') as { name: string } | null;

          expect(row).not.toBeNull();
          expect(row!.name).toBe(stackName);

          testDb.close();
        }
      ),
      { numRuns: 50 }
    );

    db.close();
  });
});
