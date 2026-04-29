import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../helpers/db.ts';
import { createApp } from '../../../src/server/app.ts';
import type { Database } from '../../../src/server/db/index.ts';

/**
 * Helper to create a notebook and return its ID.
 */
async function createNotebook(app: ReturnType<typeof createApp>, name: string, stackId?: string): Promise<string> {
  const res = await app.request('/api/notebooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stackId }),
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

describe('System API', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createTestDatabase();
    app = createApp(db as unknown as Database);
  });

  afterEach(() => {
    db.close();
  });

  // ── GET /api/system/health ───────────────────────────────────────

  describe('GET /api/system/health', () => {
    it('should return ok status', async () => {
      const res = await app.request('/api/system/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: 'ok' });
    });
  });

  // ── POST /api/system/export ──────────────────────────────────────

  describe('POST /api/system/export', () => {
    it('should export empty database', async () => {
      const res = await app.request('/api/system/export', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.version).toBe(1);
      expect(body.exportedAt).toBeDefined();
      expect(body.stacks).toEqual([]);
      expect(body.notebooks).toEqual([]);
      expect(body.notes).toEqual([]);
      expect(body.tags).toEqual([]);
    });

    it('should export all data with correct structure', async () => {
      // Create a stack
      const stackRes = await app.request('/api/notebook-stacks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Stack' }),
      });
      const stack = await stackRes.json();

      // Create a notebook in the stack
      const nbId = await createNotebook(app, 'Work Notes', stack.id);

      // Create a note with content
      const note = await createNote(
        app,
        nbId,
        'Meeting Notes',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}',
      );

      // Add a tag to the note
      await app.request(`/api/notes/${note.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'important' }),
      });

      const res = await app.request('/api/system/export', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.version).toBe(1);
      expect(body.stacks).toHaveLength(1);
      expect(body.stacks[0].name).toBe('My Stack');
      expect(body.stacks[0].id).toBe(stack.id);

      expect(body.notebooks).toHaveLength(1);
      expect(body.notebooks[0].name).toBe('Work Notes');
      expect(body.notebooks[0].stackId).toBe(stack.id);

      expect(body.notes).toHaveLength(1);
      expect(body.notes[0].title).toBe('Meeting Notes');
      expect(body.notes[0].content).toEqual({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
      });
      expect(body.notes[0].notebookId).toBe(nbId);
      expect(body.notes[0].tags).toContain('important');
      expect(body.notes[0].createdAt).toBeDefined();
      expect(body.notes[0].updatedAt).toBeDefined();

      expect(body.tags).toHaveLength(1);
      expect(body.tags[0].name).toBe('important');
    });
  });

  // ── POST /api/system/import ──────────────────────────────────────

  describe('POST /api/system/import', () => {
    it('should import valid data successfully', async () => {
      const importData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        stacks: [{ id: 'stack1', name: 'Imported Stack' }],
        notebooks: [{ id: 'nb1', name: 'Imported NB', stackId: 'stack1' }],
        notes: [
          {
            id: 'note1',
            title: 'Imported Note',
            content: { type: 'doc' },
            notebookId: 'nb1',
            tags: [],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ],
        tags: [],
      };

      const res = await app.request('/api/system/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importData),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.imported.stacks).toBe(1);
      expect(body.imported.notebooks).toBe(1);
      expect(body.imported.notes).toBe(1);
      expect(body.errors).toHaveLength(0);

      // Verify data was actually imported
      const nbRes = await app.request('/api/notebooks');
      const notebooks = await nbRes.json();
      expect(notebooks).toHaveLength(1);
      expect(notebooks[0].name).toBe('Imported NB');
    });

    it('should import notes with tag associations', async () => {
      const importData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        stacks: [],
        notebooks: [{ id: 'nb1', name: 'NB', stackId: null }],
        notes: [
          {
            id: 'note1',
            title: 'Tagged Note',
            content: {},
            notebookId: 'nb1',
            tags: ['work', 'urgent'],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ],
        tags: [
          { id: 'tag1', name: 'work' },
          { id: 'tag2', name: 'urgent' },
        ],
      };

      const res = await app.request('/api/system/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importData),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.imported.tags).toBe(2);
      expect(body.imported.notes).toBe(1);

      // Verify tags are associated with the note
      const noteRes = await app.request('/api/notes/note1');
      const note = await noteRes.json();
      expect(note.tags).toHaveLength(2);
      const tagNames = note.tags.map((t: { name: string }) => t.name);
      expect(tagNames).toContain('work');
      expect(tagNames).toContain('urgent');
    });

    it('should skip malformed entries and return 207', async () => {
      const importData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        stacks: [
          { id: 'stack1', name: 'Valid Stack' },
          { id: null, name: null }, // malformed
        ],
        notebooks: [{ id: 'nb1', name: 'Valid NB', stackId: 'stack1' }],
        notes: [
          {
            id: 'note1',
            title: 'Valid Note',
            content: {},
            notebookId: 'nb1',
            tags: [],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          {
            id: null, // malformed - missing id
            title: 'Bad Note',
            content: {},
            notebookId: 'nb1',
            tags: [],
          },
        ],
        tags: [],
      };

      const res = await app.request('/api/system/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importData),
      });
      expect(res.status).toBe(207);
      const body = await res.json();
      expect(body.imported.stacks).toBe(1);
      expect(body.imported.notebooks).toBe(1);
      expect(body.imported.notes).toBe(1);
      expect(body.errors.length).toBeGreaterThan(0);
      expect(body.message).toContain('errors');
    });

    it('should skip notes referencing non-existent notebooks', async () => {
      const importData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        stacks: [],
        notebooks: [],
        notes: [
          {
            id: 'note1',
            title: 'Orphan Note',
            content: {},
            notebookId: 'nonexistent',
            tags: [],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ],
        tags: [],
      };

      const res = await app.request('/api/system/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importData),
      });
      expect(res.status).toBe(207);
      const body = await res.json();
      expect(body.imported.notes).toBe(0);
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].message).toContain('non-existent notebook');
    });

    it('should return 400 for invalid JSON', async () => {
      const res = await app.request('/api/system/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_JSON');
    });

    it('should handle empty import data gracefully', async () => {
      const importData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        stacks: [],
        notebooks: [],
        notes: [],
        tags: [],
      };

      const res = await app.request('/api/system/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importData),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.imported.total).toBe(0);
      expect(body.errors).toHaveLength(0);
    });
  });

  // ── GET /api/system/settings ─────────────────────────────────────

  describe('GET /api/system/settings', () => {
    it('should return empty object when no settings exist', async () => {
      const res = await app.request('/api/system/settings');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({});
    });

    it('should return all settings as key-value pairs', async () => {
      // Insert settings directly
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('theme', 'dark');
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('fontSize', '14');

      const res = await app.request('/api/system/settings');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ theme: 'dark', fontSize: '14' });
    });
  });

  // ── PUT /api/system/settings ─────────────────────────────────────

  describe('PUT /api/system/settings', () => {
    it('should create new settings', async () => {
      const res = await app.request('/api/system/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'dark', language: 'en' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.theme).toBe('dark');
      expect(body.language).toBe('en');
    });

    it('should update existing settings', async () => {
      // Set initial value
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('theme', 'light');

      const res = await app.request('/api/system/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'dark' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.theme).toBe('dark');
    });

    it('should preserve existing settings when updating others', async () => {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('theme', 'dark');

      const res = await app.request('/api/system/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fontSize: '16' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.theme).toBe('dark');
      expect(body.fontSize).toBe('16');
    });

    it('should return 400 for invalid JSON', async () => {
      const res = await app.request('/api/system/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_JSON');
    });
  });

  // ── Export/Import round trip ──────────────────────────────────────

  describe('Export/Import round trip', () => {
    it('should export and re-import data correctly', async () => {
      // Create data
      const stackRes = await app.request('/api/notebook-stacks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Dev Stack' }),
      });
      const stack = await stackRes.json();

      const nbId = await createNotebook(app, 'Projects', stack.id);
      const note = await createNote(app, nbId, 'Project Plan', '{"type":"doc"}');

      await app.request(`/api/notes/${note.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'planning' }),
      });

      // Export
      const exportRes = await app.request('/api/system/export', { method: 'POST' });
      const exportData = await exportRes.json();

      // Create a fresh database and app for import
      const db2 = createTestDatabase();
      const app2 = createApp(db2 as unknown as Database);

      // Import into fresh database
      const importRes = await app2.request('/api/system/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportData),
      });
      expect(importRes.status).toBe(200);
      const importBody = await importRes.json();
      expect(importBody.imported.stacks).toBe(1);
      expect(importBody.imported.notebooks).toBe(1);
      expect(importBody.imported.notes).toBe(1);
      expect(importBody.imported.tags).toBe(1);
      expect(importBody.errors).toHaveLength(0);

      // Verify imported data
      const nbRes = await app2.request('/api/notebooks');
      const notebooks = await nbRes.json();
      expect(notebooks).toHaveLength(1);
      expect(notebooks[0].name).toBe('Projects');

      db2.close();
    });
  });
});
