import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sanitizeFilename } from '../../vault/sanitize';

/**
 * **Validates: Requirements 3.3, 3.5 — Property 7 from design doc**
 *
 * For any non-empty string, `sanitizeFilename()` should produce a valid
 * filename (no invalid chars, non-empty). It should also be idempotent.
 */
describe('Filename sanitization properties (Property 7)', () => {
  const INVALID_CHARS = /[/\\:*?"<>|]/;

  it('sanitized filenames contain no invalid filesystem characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (title) => {
          const sanitized = sanitizeFilename(title);
          expect(sanitized).not.toMatch(INVALID_CHARS);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('sanitized filenames are never empty', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (title) => {
          const sanitized = sanitizeFilename(title);
          expect(sanitized.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('sanitizeFilename is idempotent: sanitizing twice yields the same result', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (title) => {
          const once = sanitizeFilename(title);
          const twice = sanitizeFilename(once);
          expect(twice).toBe(once);
        }
      ),
      { numRuns: 100 }
    );
  });
});
