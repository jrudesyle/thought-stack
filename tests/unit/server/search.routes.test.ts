import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../helpers/db.ts';
import { createApp } from '../../../src/server/app.ts';
import type { Database } from '../../../src/server/db/index.ts';
import { createSearchDAL } from '../../../src/server/dal/search.dal.ts';

/**
 * Helper to create a notebook and return its ID.
 */
async function createNotebook(app: ReturnType<typeof createApp>, name: string): Promise<string> {
  const res = await app.request('/api/notebooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = await res.json();
  return body.id;
}

/**
 * Helper to create a note and return the full response body.
 */
async function createNote(
  app: ReturnType<typeof createApp>,
  notebookId: string,
  title?: string,
  content?: string,
): Promise<Record<string, unknown>> {
  const res = await app.request('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notebookId, title, content }),
  });
  return res.json();
}

/**
 * Helper to create a TipTap JSON document with text content.
 */
function tipTapDoc(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  });
}

describe('Search API', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createTestDatabase();
    app = createApp(db as unknown as Database);
  });

  afterEach(() => {
    db.close();
  });

  // ── GET /api/search (no query) ───────────────────────────────────

  describe('GET /api/search without query', () => {
    it('should return empty results with message when no query provided', async () => {
      const res = await app.request('/api/search');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toEqual([]);
      expect(body.message).toBe('Enter a search query to find notes');
    });

    it('should return empty results when query is empty string', async () => {
      const res = await app.request('/api/search?q=');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toEqual([]);
      expect(body.message).toBe('Enter a search query to find notes');
    });

    it('should return empty results when query is whitespace', async () => {
      const res = await app.request('/api/search?q=%20%20');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toEqual([]);
      expect(body.message).toBe('Enter a search query to find notes');
    });
  });

  // ── GET /api/search with query ───────────────────────────────────

  describe('GET /api/search with query', () => {
    it('should return matching notes by title', async () => {
      const nbId = await createNotebook(app, 'TestNB');
      await createNote(app, nbId, 'Meeting Notes for Monday');
      await createNote(app, nbId, 'Shopping List');

      // Rebuild FTS index so title matches work
      const searchDAL = createSearchDAL(db as unknown as Database);
      searchDAL.rebuildIndex();

      const res = await app.request('/api/search?q=meeting');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].title).toBe('Meeting Notes for Monday');
      expect(body.results[0].notebookName).toBe('TestNB');
      expect(body.results[0].noteId).toBeDefined();
      expect(body.results[0].rank).toBeDefined();
      expect(body.message).toBeNull();
    });

    it('should return matching notes by body content', async () => {
      const nbId = await createNotebook(app, 'TestNB');
      const content = tipTapDoc('The quick brown fox jumps over the lazy dog');
      await createNote(app, nbId, 'Animal Story', content);
      await createNote(app, nbId, 'Other Note', tipTapDoc('Nothing relevant here'));

      // Rebuild FTS index to include body text
      const searchDAL = createSearchDAL(db as unknown as Database);
      searchDAL.rebuildIndex();

      const res = await app.request('/api/search?q=fox');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].title).toBe('Animal Story');
      expect(body.results[0].snippet).toContain('fox');
    });

    it('should return results with tags array', async () => {
      const nbId = await createNotebook(app, 'TestNB');
      const note = await createNote(app, nbId, 'Tagged Note');

      // Add a tag to the note
      await app.request(`/api/notes/${note.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'important' }),
      });

      const searchDAL = createSearchDAL(db as unknown as Database);
      searchDAL.rebuildIndex();

      const res = await app.request('/api/search?q=tagged');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].tags).toContain('important');
    });

    it('should return "No notes found" message when no results match', async () => {
      const nbId = await createNotebook(app, 'TestNB');
      await createNote(app, nbId, 'Some Note');

      const searchDAL = createSearchDAL(db as unknown as Database);
      searchDAL.rebuildIndex();

      const res = await app.request('/api/search?q=nonexistentterm');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toEqual([]);
      expect(body.message).toBe('No notes found matching your search');
    });
  });

  // ── GET /api/search with filters ─────────────────────────────────

  describe('GET /api/search with filters', () => {
    it('should filter results by notebookId', async () => {
      const nb1 = await createNotebook(app, 'Work');
      const nb2 = await createNotebook(app, 'Personal');
      await createNote(app, nb1, 'Work Meeting');
      await createNote(app, nb2, 'Personal Meeting');

      const searchDAL = createSearchDAL(db as unknown as Database);
      searchDAL.rebuildIndex();

      const res = await app.request(`/api/search?q=meeting&notebookId=${nb1}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].title).toBe('Work Meeting');
      expect(body.results[0].notebookName).toBe('Work');
    });

    it('should filter results by tagId', async () => {
      const nbId = await createNotebook(app, 'TestNB');
      const note1 = await createNote(app, nbId, 'Important Meeting');
      await createNote(app, nbId, 'Regular Meeting');

      // Add tag to note1
      const tagRes = await app.request(`/api/notes/${note1.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'urgent' }),
      });
      const tag = await tagRes.json();

      const searchDAL = createSearchDAL(db as unknown as Database);
      searchDAL.rebuildIndex();

      const res = await app.request(`/api/search?q=meeting&tagId=${tag.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].title).toBe('Important Meeting');
    });
  });

  // ── Trashed notes excluded ───────────────────────────────────────

  describe('trashed notes exclusion', () => {
    it('should not return trashed notes in search results', async () => {
      const nbId = await createNotebook(app, 'TestNB');
      const note = await createNote(app, nbId, 'Searchable Note');

      const searchDAL = createSearchDAL(db as unknown as Database);
      searchDAL.rebuildIndex();

      // Trash the note
      await app.request(`/api/notes/${note.id}`, { method: 'DELETE' });

      const res = await app.request('/api/search?q=searchable');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(0);
    });
  });
});
