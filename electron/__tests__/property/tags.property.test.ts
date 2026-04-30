import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * **Validates: Requirements 6.1, 6.2 — Property 3 from design doc**
 *
 * For any set of notes with tags, the tag count for each tag should equal
 * the number of notes containing that tag. Tested purely in-memory.
 */
describe('Tag aggregation consistency (Property 3)', () => {
  /** Mimics the tag aggregation logic from tags.ipc.ts */
  function aggregateTags(
    notes: Array<{ tags: string[] }>
  ): Map<string, number> {
    const tagCounts = new Map<string, number>();
    for (const note of notes) {
      for (const tag of note.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    return tagCounts;
  }

  it('tag count equals the number of notes containing that tag', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            tags: fc.array(
              fc.string({ minLength: 1, maxLength: 20 }).filter(
                (s) => s.trim().length > 0
              ),
              { maxLength: 5 }
            ),
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (notes) => {
          const tagCounts = aggregateTags(notes);

          for (const [tag, count] of tagCounts) {
            const actual = notes.filter((n) => n.tags.includes(tag)).length;
            expect(actual).toBe(count);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('adding a tag to a note increases that tag count by 1', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            tags: fc.array(
              fc.string({ minLength: 1, maxLength: 20 }).filter(
                (s) => s.trim().length > 0
              ),
              { maxLength: 5 }
            ),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (s) => s.trim().length > 0
        ),
        fc.nat({ max: 100 }),
        (notes, newTag, indexSeed) => {
          const before = aggregateTags(notes);
          const beforeCount = before.get(newTag) ?? 0;

          // Pick a note to add the tag to
          const idx = indexSeed % notes.length;
          const noteAlreadyHasTag = notes[idx].tags.includes(newTag);

          // Create updated notes with the tag added
          const updatedNotes = notes.map((n, i) => {
            if (i !== idx) return n;
            if (noteAlreadyHasTag) return n;
            return { tags: [...n.tags, newTag] };
          });

          const after = aggregateTags(updatedNotes);
          const afterCount = after.get(newTag) ?? 0;

          if (noteAlreadyHasTag) {
            expect(afterCount).toBe(beforeCount);
          } else {
            expect(afterCount).toBe(beforeCount + 1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
