import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../helpers/db.ts';
import { createApp } from '../../../src/server/app.ts';
import type { Database } from '../../../src/server/db/index.ts';

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
): Promise<Record<string, unknown>> {
  const res = await app.request('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notebookId, title }),
  });
  return res.json();
}

describe('Tags API', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createTestDatabase();
    app = createApp(db as unknown as Database);
  });

  afterEach(() => {
    db.close();
  });

  // ── GET /api/tags ────────────────────────────────────────────────

  describe('GET /api/tags', () => {
    it('should return empty array when no tags exist', async () => {
      const res = await app.request('/api/tags');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it('should return all tags with note counts', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Tagged Note');

      // Create tags and associate one with a note
      await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'alpha' }),
      });
      await app.request(`/api/notes/${note.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'beta' }),
      });

      const res = await app.request('/api/tags');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);

      const alpha = body.find((t: { name: string }) => t.name === 'alpha');
      const beta = body.find((t: { name: string }) => t.name === 'beta');
      expect(alpha.note_count).toBe(0);
      expect(beta.note_count).toBe(1);
    });
  });

  // ── POST /api/tags ───────────────────────────────────────────────

  describe('POST /api/tags', () => {
    it('should create a tag', async () => {
      const res = await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'important' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('important');
      expect(body.id).toBeDefined();
      expect(body.created_at).toBeDefined();
    });

    it('should return 400 when name is empty', async () => {
      const res = await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.field).toBe('name');
    });

    it('should return 400 when name is missing', async () => {
      const res = await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 when creating duplicate tag', async () => {
      await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'duplicate' }),
      });
      const res = await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'duplicate' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('DUPLICATE_NAME');
    });
  });

  // ── PUT /api/tags/:id ────────────────────────────────────────────

  describe('PUT /api/tags/:id', () => {
    it('should rename a tag', async () => {
      const createRes = await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'old-name' }),
      });
      const created = await createRes.json();

      const res = await app.request(`/api/tags/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-name' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('new-name');
      expect(body.id).toBe(created.id);
    });

    it('should return 404 when renaming non-existent tag', async () => {
      const res = await app.request('/api/tags/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when renaming with empty name', async () => {
      const createRes = await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
      const created = await createRes.json();

      const res = await app.request(`/api/tags/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 when renaming to duplicate name', async () => {
      await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'existing' }),
      });
      const createRes = await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'to-rename' }),
      });
      const created = await createRes.json();

      const res = await app.request(`/api/tags/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'existing' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('DUPLICATE_NAME');
    });
  });

  // ── DELETE /api/tags/:id ─────────────────────────────────────────

  describe('DELETE /api/tags/:id', () => {
    it('should delete a tag', async () => {
      const createRes = await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'to-delete' }),
      });
      const created = await createRes.json();

      const res = await app.request(`/api/tags/${created.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify it's gone
      const listRes = await app.request('/api/tags');
      const list = await listRes.json();
      expect(list).toHaveLength(0);
    });

    it('should return 404 when deleting non-existent tag', async () => {
      const res = await app.request('/api/tags/nonexistent', {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── GET /api/tags/autocomplete ───────────────────────────────────

  describe('GET /api/tags/autocomplete', () => {
    it('should return empty array when no tags match', async () => {
      const res = await app.request('/api/tags/autocomplete?q=xyz');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it('should return empty array when q is empty', async () => {
      await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });

      const res = await app.request('/api/tags/autocomplete?q=');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it('should return tags matching prefix', async () => {
      await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'javascript' }),
      });
      await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'java' }),
      });
      await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'python' }),
      });

      const res = await app.request('/api/tags/autocomplete?q=jav');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
      const names = body.map((t: { name: string }) => t.name);
      expect(names).toContain('java');
      expect(names).toContain('javascript');
    });

    it('should match case-insensitively', async () => {
      await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'TypeScript' }),
      });

      const res = await app.request('/api/tags/autocomplete?q=type');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('TypeScript');
    });

    it('should not be treated as a tag ID', async () => {
      // This verifies that /tags/autocomplete is registered before /tags/:id
      const res = await app.request('/api/tags/autocomplete?q=test');
      expect(res.status).toBe(200);
      const body = await res.json();
      // Should return an array, not a NOT_FOUND error
      expect(Array.isArray(body)).toBe(true);
    });
  });
});

describe('Note-Tag Association API', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createTestDatabase();
    app = createApp(db as unknown as Database);
  });

  afterEach(() => {
    db.close();
  });

  // ── POST /api/notes/:noteId/tags ─────────────────────────────────

  describe('POST /api/notes/:noteId/tags', () => {
    it('should add a new tag to a note (auto-create)', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'My Note');

      const res = await app.request(`/api/notes/${note.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-tag' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('new-tag');
      expect(body.id).toBeDefined();

      // Verify the tag appears in the tags list with count 1
      const tagsRes = await app.request('/api/tags');
      const tags = await tagsRes.json();
      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe('new-tag');
      expect(tags[0].note_count).toBe(1);
    });

    it('should add an existing tag to a note', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note1 = await createNote(app, nbId, 'Note 1');
      const note2 = await createNote(app, nbId, 'Note 2');

      // Add tag to note1
      await app.request(`/api/notes/${note1.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'shared-tag' }),
      });

      // Add same tag to note2
      const res = await app.request(`/api/notes/${note2.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'shared-tag' }),
      });
      expect(res.status).toBe(201);

      // Should still be only one tag, but with count 2
      const tagsRes = await app.request('/api/tags');
      const tags = await tagsRes.json();
      expect(tags).toHaveLength(1);
      expect(tags[0].note_count).toBe(2);
    });

    it('should return 400 when tag name is empty', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Note');

      const res = await app.request(`/api/notes/${note.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.field).toBe('name');
    });

    it('should return 404 when note does not exist', async () => {
      const res = await app.request('/api/notes/nonexistent/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'tag' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should be idempotent when adding same tag twice', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Note');

      // Add tag twice
      await app.request(`/api/notes/${note.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'idempotent' }),
      });
      const res = await app.request(`/api/notes/${note.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'idempotent' }),
      });
      expect(res.status).toBe(201);

      // Should still be count 1
      const tagsRes = await app.request('/api/tags');
      const tags = await tagsRes.json();
      expect(tags).toHaveLength(1);
      expect(tags[0].note_count).toBe(1);
    });
  });

  // ── DELETE /api/notes/:noteId/tags/:tagId ────────────────────────

  describe('DELETE /api/notes/:noteId/tags/:tagId', () => {
    it('should remove a tag from a note', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note1 = await createNote(app, nbId, 'Note 1');
      const note2 = await createNote(app, nbId, 'Note 2');

      // Add tag to both notes
      const tagRes = await app.request(`/api/notes/${note1.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'shared' }),
      });
      const tag = await tagRes.json();
      await app.request(`/api/notes/${note2.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'shared' }),
      });

      // Remove from note1
      const res = await app.request(`/api/notes/${note1.id}/tags/${tag.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Tag should still exist (note2 still uses it)
      const tagsRes = await app.request('/api/tags');
      const tags = await tagsRes.json();
      expect(tags).toHaveLength(1);
      expect(tags[0].note_count).toBe(1);
    });

    it('should auto-delete orphan tag when last note is untagged', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Note');

      // Add tag
      const tagRes = await app.request(`/api/notes/${note.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'orphan-candidate' }),
      });
      const tag = await tagRes.json();

      // Remove tag from the only note
      await app.request(`/api/notes/${note.id}/tags/${tag.id}`, {
        method: 'DELETE',
      });

      // Tag should be auto-deleted
      const tagsRes = await app.request('/api/tags');
      const tags = await tagsRes.json();
      expect(tags).toHaveLength(0);
    });

    it('should return 404 when note does not exist', async () => {
      const res = await app.request('/api/notes/nonexistent/tags/sometag', {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 404 when tag is not associated with note', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Note');

      const res = await app.request(`/api/notes/${note.id}/tags/nonexistent`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });
});
