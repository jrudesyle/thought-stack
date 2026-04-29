import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../helpers/db.ts';
import { createSearchDAL, extractTextFromTipTap } from '../../../src/server/dal/search.dal.ts';

describe('SearchDAL', () => {
  let db: TestDatabase;
  let dal: ReturnType<typeof createSearchDAL>;

  beforeEach(() => {
    db = createTestDatabase();
    dal = createSearchDAL(db as any);
  });

  afterEach(() => {
    db.close();
  });

  // --- Helpers ---

  function createNotebook(name = 'Test Notebook'): string {
    const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
    db.prepare(
      "INSERT INTO notebooks (id, name) VALUES (?, ?)"
    ).run(id, name);
    return id;
  }

  function createNote(
    notebookId: string,
    title = 'Test Note',
    content = '{}'
  ): string {
    const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
    db.prepare(
      "INSERT INTO notes (id, title, content, notebook_id) VALUES (?, ?, ?, ?)"
    ).run(id, title, content, notebookId);
    return id;
  }

  function createTrashedNote(
    notebookId: string,
    title = 'Trashed Note',
    content = '{}'
  ): string {
    const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
    db.prepare(
      "INSERT INTO notes (id, title, content, notebook_id, is_trashed, trashed_at) VALUES (?, ?, ?, ?, 1, datetime('now'))"
    ).run(id, title, content, notebookId);
    return id;
  }

  function createTag(name: string): string {
    const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
    db.prepare(
      "INSERT INTO tags (id, name) VALUES (?, ?)"
    ).run(id, name);
    return id;
  }

  function addTagToNote(noteId: string, tagId: string): void {
    db.prepare(
      "INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)"
    ).run(noteId, tagId);
  }

  /**
   * Build a minimal TipTap/ProseMirror JSON document from text paragraphs.
   */
  function tipTapDoc(...paragraphs: string[]): string {
    return JSON.stringify({
      type: 'doc',
      content: paragraphs.map((text) => ({
        type: 'paragraph',
        content: [{ type: 'text', text }],
      })),
    });
  }

  // --- extractTextFromTipTap ---

  describe('extractTextFromTipTap', () => {
    it('should extract text from a simple paragraph', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      };
      expect(extractTextFromTipTap(doc)).toBe('Hello world');
    });

    it('should extract text from multiple paragraphs separated by newlines', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'First paragraph' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Second paragraph' }],
          },
        ],
      };
      expect(extractTextFromTipTap(doc)).toBe(
        'First paragraph\nSecond paragraph'
      );
    });

    it('should handle nested content (e.g., bold/italic marks)', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Normal ' },
              {
                type: 'text',
                text: 'bold',
                marks: [{ type: 'bold' }],
              },
              { type: 'text', text: ' text' },
            ],
          },
        ],
      };
      expect(extractTextFromTipTap(doc)).toBe('Normal \nbold\n text');
    });

    it('should handle headings', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'My Heading' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Body text' }],
          },
        ],
      };
      expect(extractTextFromTipTap(doc)).toBe('My Heading\nBody text');
    });

    it('should handle bullet lists', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Item 1' }],
                  },
                ],
              },
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Item 2' }],
                  },
                ],
              },
            ],
          },
        ],
      };
      expect(extractTextFromTipTap(doc)).toBe('Item 1\nItem 2');
    });

    it('should return empty string for null input', () => {
      expect(extractTextFromTipTap(null)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(extractTextFromTipTap(undefined)).toBe('');
    });

    it('should return empty string for non-object input', () => {
      expect(extractTextFromTipTap('just a string')).toBe('');
    });

    it('should return empty string for empty doc', () => {
      expect(extractTextFromTipTap({ type: 'doc', content: [] })).toBe('');
    });

    it('should handle doc with no content property', () => {
      expect(extractTextFromTipTap({ type: 'doc' })).toBe('');
    });
  });

  // --- search ---

  describe('search', () => {
    it('should return empty array for empty query', () => {
      expect(dal.search('')).toEqual([]);
    });

    it('should return empty array for whitespace-only query', () => {
      expect(dal.search('   ')).toEqual([]);
    });

    it('should find notes matching title', () => {
      const nbId = createNotebook('Work');
      createNote(nbId, 'Meeting notes for Monday');

      const results = dal.search('Meeting');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Meeting notes for Monday');
      expect(results[0].notebookName).toBe('Work');
    });

    it('should find notes matching body text after reindex', () => {
      const nbId = createNotebook('Personal');
      const noteId = createNote(
        nbId,
        'Shopping List',
        tipTapDoc('Buy groceries and vegetables')
      );

      // Reindex to populate body_text in FTS
      dal.reindex(noteId);

      const results = dal.search('groceries');
      expect(results).toHaveLength(1);
      expect(results[0].noteId).toBe(noteId);
    });

    it('should return snippet with highlighted matches', () => {
      const nbId = createNotebook();
      const noteId = createNote(
        nbId,
        'Test Note',
        tipTapDoc('The quick brown fox jumps over the lazy dog')
      );
      dal.reindex(noteId);

      const results = dal.search('fox');
      expect(results).toHaveLength(1);
      // Snippet is generated manually with <mark> tags
      expect(results[0].snippet).toContain('<mark>fox</mark>');
    });

    it('should return rank scores', () => {
      const nbId = createNotebook();
      createNote(nbId, 'Alpha topic');
      createNote(nbId, 'Beta topic');

      const results = dal.search('topic');
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const r of results) {
        expect(typeof r.rank).toBe('number');
      }
    });

    it('should exclude trashed notes from results', () => {
      const nbId = createNotebook();
      createNote(nbId, 'Active searchable note');
      createTrashedNote(nbId, 'Trashed searchable note');

      const results = dal.search('searchable');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Active searchable note');
    });

    it('should include tags in results', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId, 'Tagged note');
      const tagId = createTag('important');
      addTagToNote(noteId, tagId);

      const results = dal.search('Tagged');
      expect(results).toHaveLength(1);
      expect(results[0].tags).toContain('important');
    });

    it('should return updatedAt in results', () => {
      const nbId = createNotebook();
      createNote(nbId, 'Timestamped note');

      const results = dal.search('Timestamped');
      expect(results).toHaveLength(1);
      expect(results[0].updatedAt).toBeTruthy();
    });

    it('should return notebookName in results', () => {
      const nbId = createNotebook('Science');
      createNote(nbId, 'Physics equations');

      const results = dal.search('Physics');
      expect(results).toHaveLength(1);
      expect(results[0].notebookName).toBe('Science');
    });

    it('should return multiple matching notes', () => {
      const nbId = createNotebook();
      createNote(nbId, 'JavaScript tutorial');
      createNote(nbId, 'JavaScript patterns');
      createNote(nbId, 'Python tutorial');

      const results = dal.search('JavaScript');
      expect(results).toHaveLength(2);
    });
  });

  // --- search with filters ---

  describe('search with filters', () => {
    it('should filter results by notebookId', () => {
      const nb1 = createNotebook('Work');
      const nb2 = createNotebook('Personal');
      createNote(nb1, 'Work meeting notes');
      createNote(nb2, 'Personal meeting notes');

      const results = dal.search('meeting', { notebookId: nb1 });
      expect(results).toHaveLength(1);
      expect(results[0].notebookName).toBe('Work');
    });

    it('should filter results by tagIds', () => {
      const nbId = createNotebook();
      const note1 = createNote(nbId, 'Important task');
      const note2 = createNote(nbId, 'Regular task');
      const tagId = createTag('urgent');
      addTagToNote(note1, tagId);

      const results = dal.search('task', { tagIds: [tagId] });
      expect(results).toHaveLength(1);
      expect(results[0].noteId).toBe(note1);
    });

    it('should filter by multiple tagIds (AND logic)', () => {
      const nbId = createNotebook();
      const note1 = createNote(nbId, 'Dual tagged item');
      const note2 = createNote(nbId, 'Single tagged item');
      const tag1 = createTag('alpha');
      const tag2 = createTag('beta');
      addTagToNote(note1, tag1);
      addTagToNote(note1, tag2);
      addTagToNote(note2, tag1);

      const results = dal.search('tagged', { tagIds: [tag1, tag2] });
      expect(results).toHaveLength(1);
      expect(results[0].noteId).toBe(note1);
    });

    it('should combine notebookId and tagIds filters', () => {
      const nb1 = createNotebook('Work');
      const nb2 = createNotebook('Personal');
      const note1 = createNote(nb1, 'Work project alpha');
      const note2 = createNote(nb2, 'Personal project alpha');
      const tagId = createTag('project');
      addTagToNote(note1, tagId);
      addTagToNote(note2, tagId);

      const results = dal.search('project', {
        notebookId: nb1,
        tagIds: [tagId],
      });
      expect(results).toHaveLength(1);
      expect(results[0].noteId).toBe(note1);
    });

    it('should return empty when no notes match filters', () => {
      const nb1 = createNotebook('Work');
      const nb2 = createNotebook('Personal');
      createNote(nb1, 'Work document');

      const results = dal.search('document', { notebookId: nb2 });
      expect(results).toEqual([]);
    });

    it('should return empty when tagIds filter matches no notes', () => {
      const nbId = createNotebook();
      createNote(nbId, 'Untagged document');
      const tagId = createTag('nonexistent-assoc');

      const results = dal.search('document', { tagIds: [tagId] });
      expect(results).toEqual([]);
    });
  });

  // --- reindex ---

  describe('reindex', () => {
    it('should update FTS index with body text from TipTap JSON', () => {
      const nbId = createNotebook();
      const noteId = createNote(
        nbId,
        'My Note',
        tipTapDoc('This contains unique searchterm')
      );

      // Before reindex, body_text is empty — only title is searchable
      let results = dal.search('searchterm');
      expect(results).toHaveLength(0);

      dal.reindex(noteId);

      results = dal.search('searchterm');
      expect(results).toHaveLength(1);
      expect(results[0].noteId).toBe(noteId);
    });

    it('should handle invalid JSON content gracefully', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId, 'Bad Content Note', 'not valid json');

      // Should not throw
      expect(() => dal.reindex(noteId)).not.toThrow();
    });

    it('should handle empty content object', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId, 'Empty Content', '{}');

      expect(() => dal.reindex(noteId)).not.toThrow();
    });

    it('should do nothing for non-existent noteId', () => {
      expect(() => dal.reindex('nonexistent')).not.toThrow();
    });

    it('should update FTS when content changes', () => {
      const nbId = createNotebook();
      const noteId = createNote(
        nbId,
        'Evolving Note',
        tipTapDoc('original content here')
      );
      dal.reindex(noteId);

      // Update the note content directly
      db.prepare('UPDATE notes SET content = ? WHERE id = ?').run(
        tipTapDoc('completely new replacement text'),
        noteId
      );
      dal.reindex(noteId);

      // Old content should not be found
      const oldResults = dal.search('original');
      expect(oldResults).toHaveLength(0);

      // New content should be found
      const newResults = dal.search('replacement');
      expect(newResults).toHaveLength(1);
    });
  });

  // --- rebuildIndex ---

  describe('rebuildIndex', () => {
    it('should rebuild the entire FTS index', () => {
      const nbId = createNotebook();
      const note1 = createNote(
        nbId,
        'First Note',
        tipTapDoc('Content of the first note')
      );
      const note2 = createNote(
        nbId,
        'Second Note',
        tipTapDoc('Content of the second note')
      );

      // Before rebuild, body_text is empty
      expect(dal.search('Content')).toHaveLength(0);

      dal.rebuildIndex();

      // After rebuild, body text should be searchable
      const results = dal.search('Content');
      expect(results).toHaveLength(2);
    });

    it('should handle notes with invalid JSON during rebuild', () => {
      const nbId = createNotebook();
      createNote(nbId, 'Good Note', tipTapDoc('Valid content'));
      createNote(nbId, 'Bad Note', 'not json');

      expect(() => dal.rebuildIndex()).not.toThrow();

      // The good note should still be searchable by body
      const results = dal.search('Valid');
      expect(results).toHaveLength(1);
    });

    it('should make titles searchable after rebuild', () => {
      const nbId = createNotebook();
      createNote(nbId, 'Unique Title Alpha');
      createNote(nbId, 'Unique Title Beta');

      dal.rebuildIndex();

      const results = dal.search('Unique');
      expect(results).toHaveLength(2);
    });

    it('should include trashed notes in FTS index but exclude from search', () => {
      const nbId = createNotebook();
      createNote(nbId, 'Active rebuild note', tipTapDoc('rebuild content'));
      createTrashedNote(nbId, 'Trashed rebuild note', tipTapDoc('rebuild content'));

      dal.rebuildIndex();

      // Search should only return the active note
      const results = dal.search('rebuild');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Active rebuild note');
    });
  });
});
