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
  content?: string,
): Promise<Record<string, unknown>> {
  const res = await app.request('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notebookId, title, content }),
  });
  return res.json();
}

describe('Notes API', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createTestDatabase();
    app = createApp(db as unknown as Database);
  });

  afterEach(() => {
    db.close();
  });

  // ── POST /api/notes ──────────────────────────────────────────────

  describe('POST /api/notes', () => {
    it('should create a note in a notebook', async () => {
      const nbId = await createNotebook(app, 'TestNB');
      const res = await app.request('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebookId: nbId, title: 'My Note' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.title).toBe('My Note');
      expect(body.notebook_id).toBe(nbId);
      expect(body.is_trashed).toBe(0);
    });

    it('should create a note with default empty title and content', async () => {
      const nbId = await createNotebook(app, 'TestNB');
      const res = await app.request('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebookId: nbId }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.title).toBe('');
      expect(body.content).toBe('{}');
    });

    it('should return 400 when notebookId is missing', async () => {
      const res = await app.request('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Orphan' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.field).toBe('notebookId');
    });

    it('should return 404 when notebookId does not exist', async () => {
      const res = await app.request('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebookId: 'nonexistent', title: 'Test' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── GET /api/notes ───────────────────────────────────────────────

  describe('GET /api/notes', () => {
    it('should return empty array when no notes exist', async () => {
      const res = await app.request('/api/notes');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it('should return all non-trashed notes', async () => {
      const nbId = await createNotebook(app, 'NB');
      await createNote(app, nbId, 'Note 1');
      await createNote(app, nbId, 'Note 2');

      const res = await app.request('/api/notes');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
    });

    it('should filter notes by notebookId', async () => {
      const nb1 = await createNotebook(app, 'NB1');
      const nb2 = await createNotebook(app, 'NB2');
      await createNote(app, nb1, 'In NB1');
      await createNote(app, nb2, 'In NB2');

      const res = await app.request(`/api/notes?notebookId=${nb1}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('In NB1');
    });

    it('should return trashed notes when trash=true', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Trashable');

      // Soft delete the note
      await app.request(`/api/notes/${note.id}`, { method: 'DELETE' });

      // Default listing should be empty
      const allRes = await app.request('/api/notes');
      const allBody = await allRes.json();
      expect(allBody).toHaveLength(0);

      // Trash listing should have the note
      const trashRes = await app.request('/api/notes?trash=true');
      expect(trashRes.status).toBe(200);
      const trashBody = await trashRes.json();
      expect(trashBody).toHaveLength(1);
      expect(trashBody[0].title).toBe('Trashable');
      expect(trashBody[0].is_trashed).toBe(1);
    });

    it('should filter notes by tagId', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note1 = await createNote(app, nbId, 'Tagged');
      await createNote(app, nbId, 'Untagged');

      // Create a tag and associate it with note1
      const tagId = 'testtag123';
      db.exec(`INSERT INTO tags (id, name) VALUES ('${tagId}', 'mytag')`);
      db.exec(`INSERT INTO note_tags (note_id, tag_id) VALUES ('${note1.id}', '${tagId}')`);

      const res = await app.request(`/api/notes?tagId=${tagId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('Tagged');
    });
  });

  // ── GET /api/notes/:id ──────────────────────────────────────────

  describe('GET /api/notes/:id', () => {
    it('should return a note with tags', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'My Note', '{"type":"doc"}');

      const res = await app.request(`/api/notes/${note.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(note.id);
      expect(body.title).toBe('My Note');
      expect(body.content).toBe('{"type":"doc"}');
      expect(body.tags).toEqual([]);
    });

    it('should return 404 for non-existent note', async () => {
      const res = await app.request('/api/notes/nonexistent');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── PUT /api/notes/:id ──────────────────────────────────────────

  describe('PUT /api/notes/:id', () => {
    it('should update a note title', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Original');

      const res = await app.request(`/api/notes/${note.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe('Updated');
    });

    it('should update a note content', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Test');

      const newContent = '{"type":"doc","content":[{"type":"paragraph"}]}';
      const res = await app.request(`/api/notes/${note.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.content).toBe(newContent);
    });

    it('should return 404 when updating non-existent note', async () => {
      const res = await app.request('/api/notes/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── DELETE /api/notes/:id (soft delete) ──────────────────────────

  describe('DELETE /api/notes/:id', () => {
    it('should soft delete a note', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'ToTrash');

      const res = await app.request(`/api/notes/${note.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Note should be in trash
      const getRes = await app.request(`/api/notes/${note.id}`);
      const getBody = await getRes.json();
      expect(getBody.is_trashed).toBe(1);
      expect(getBody.trashed_at).toBeTruthy();
    });

    it('should return 404 when soft-deleting non-existent note', async () => {
      const res = await app.request('/api/notes/nonexistent', {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── POST /api/notes/:id/duplicate ────────────────────────────────

  describe('POST /api/notes/:id/duplicate', () => {
    it('should duplicate a note with "Copy of" prefix', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Original', '{"data":"test"}');

      const res = await app.request(`/api/notes/${note.id}/duplicate`, {
        method: 'POST',
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.title).toBe('Copy of Original');
      expect(body.content).toBe('{"data":"test"}');
      expect(body.notebook_id).toBe(nbId);
      expect(body.id).not.toBe(note.id);
    });

    it('should return 404 when duplicating non-existent note', async () => {
      const res = await app.request('/api/notes/nonexistent/duplicate', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── POST /api/notes/:id/move ─────────────────────────────────────

  describe('POST /api/notes/:id/move', () => {
    it('should move a note to a different notebook', async () => {
      const nb1 = await createNotebook(app, 'NB1');
      const nb2 = await createNotebook(app, 'NB2');
      const note = await createNote(app, nb1, 'Movable');

      const res = await app.request(`/api/notes/${note.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebookId: nb2 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify the note is now in nb2
      const getRes = await app.request(`/api/notes/${note.id}`);
      const getBody = await getRes.json();
      expect(getBody.notebook_id).toBe(nb2);
    });

    it('should return 400 when notebookId is missing', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Test');

      const res = await app.request(`/api/notes/${note.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 when target notebook does not exist', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Test');

      const res = await app.request(`/api/notes/${note.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebookId: 'nonexistent' }),
      });
      expect(res.status).toBe(404);
    });

    it('should return 404 when note does not exist', async () => {
      const nbId = await createNotebook(app, 'NB');

      const res = await app.request('/api/notes/nonexistent/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebookId: nbId }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/notes/:id/restore ──────────────────────────────────

  describe('POST /api/notes/:id/restore', () => {
    it('should restore a trashed note to its original notebook', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Restorable');

      // Trash it
      await app.request(`/api/notes/${note.id}`, { method: 'DELETE' });

      // Restore it
      const res = await app.request(`/api/notes/${note.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify it's restored
      const getRes = await app.request(`/api/notes/${note.id}`);
      const getBody = await getRes.json();
      expect(getBody.is_trashed).toBe(0);
      expect(getBody.trashed_at).toBeNull();
      expect(getBody.notebook_id).toBe(nbId);
    });

    it('should return 404 when restoring non-trashed note', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Active');

      const res = await app.request(`/api/notes/${note.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /api/notes/:id/permanent ──────────────────────────────

  describe('DELETE /api/notes/:id/permanent', () => {
    it('should permanently delete a note', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note = await createNote(app, nbId, 'Permanent');

      // Trash it first
      await app.request(`/api/notes/${note.id}`, { method: 'DELETE' });

      // Permanently delete
      const res = await app.request(`/api/notes/${note.id}/permanent`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify it's gone
      const getRes = await app.request(`/api/notes/${note.id}`);
      expect(getRes.status).toBe(404);
    });

    it('should return 404 when permanently deleting non-existent note', async () => {
      const res = await app.request('/api/notes/nonexistent/permanent', {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /api/notes/trash ──────────────────────────────────────

  describe('DELETE /api/notes/trash', () => {
    it('should empty the trash', async () => {
      const nbId = await createNotebook(app, 'NB');
      const note1 = await createNote(app, nbId, 'Trash1');
      const note2 = await createNote(app, nbId, 'Trash2');

      // Trash both
      await app.request(`/api/notes/${note1.id}`, { method: 'DELETE' });
      await app.request(`/api/notes/${note2.id}`, { method: 'DELETE' });

      // Empty trash
      const res = await app.request('/api/notes/trash', {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.deleted).toBe(2);

      // Verify trash is empty
      const trashRes = await app.request('/api/notes?trash=true');
      const trashBody = await trashRes.json();
      expect(trashBody).toHaveLength(0);
    });

    it('should return success even when trash is already empty', async () => {
      const res = await app.request('/api/notes/trash', {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.deleted).toBe(0);
    });

    it('should not be intercepted by DELETE /api/notes/:id', async () => {
      // This test verifies that DELETE /api/notes/trash is matched
      // before DELETE /api/notes/:id (which would treat "trash" as an ID)
      const res = await app.request('/api/notes/trash', {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      // Should have the emptyTrash response shape, not a NOT_FOUND error
      expect(body.success).toBe(true);
      expect(body).toHaveProperty('deleted');
    });
  });
});
