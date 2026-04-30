import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { serializeNote, parseFrontmatter } from '../../vault/markdown';

/**
 * **Validates: Requirements 3.1, 3.2, 3.7 — Property 1 from design doc**
 *
 * For any note with id (hex string), title (non-empty string), tags (array of
 * non-empty strings without newlines), and content (string), serializing to
 * Markdown and parsing back should produce identical values.
 */
describe('Markdown frontmatter round-trip (Property 1)', () => {
  it('serialize → parse preserves id, tags, created, modified, and content', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.stringMatching(/^[0-9a-f]{12}$/),
          title: fc.string({ minLength: 1, maxLength: 100 }).filter(
            (s) => s.trim().length > 0
          ),
          tags: fc.array(
            fc
              .string({ minLength: 1, maxLength: 30 })
              .filter((s) => !s.includes('\n') && !s.includes('\r') && s.trim().length > 0),
            { maxLength: 5 }
          ),
          content: fc.string({ maxLength: 500 }),
          created: fc.constant('2026-01-15T10:00:00Z'),
          modified: fc.constant('2026-01-15T14:30:00Z'),
        }),
        ({ id, title, tags, content, created, modified }) => {
          const serialized = serializeNote({
            id,
            title,
            tags,
            created,
            modified,
            content,
          });

          const parsed = parseFrontmatter(serialized);

          expect(parsed.data.id).toBe(id);
          expect(parsed.data.tags).toEqual(tags);
          expect(parsed.data.created).toBe(created);
          expect(parsed.data.modified).toBe(modified);
          // gray-matter may add/trim trailing newlines — compare trimmed
          expect(parsed.content.trim()).toBe(content.trim());
        }
      ),
      { numRuns: 100 }
    );
  });
});
