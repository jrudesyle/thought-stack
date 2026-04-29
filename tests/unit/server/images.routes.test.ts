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
 * Helper to create a note and return its ID.
 */
async function createNote(app: ReturnType<typeof createApp>, notebookId: string): Promise<string> {
  const res = await app.request('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notebookId, title: 'Test Note' }),
  });
  const body = await res.json();
  return body.id;
}

describe('Images API', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createTestDatabase();
    app = createApp(db as unknown as Database);
  });

  afterEach(() => {
    db.close();
  });

  // ── POST /api/notes/:id/images ───────────────────────────────────

  describe('POST /api/notes/:id/images', () => {
    it('should upload a PNG image and return image metadata', async () => {
      const nbId = await createNotebook(app, 'NB');
      const noteId = await createNote(app, nbId);

      // Create a minimal PNG (1x1 pixel)
      const pngBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const file = new File([pngBytes], 'test.png', { type: 'image/png' });
      const formData = new FormData();
      formData.append('file', file);

      const res = await app.request(`/api/notes/${noteId}/images`, {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.noteId).toBe(noteId);
      expect(body.mimeType).toBe('image/png');
      expect(body.url).toContain('/api/images/');
    });

    it('should reject unsupported MIME types', async () => {
      const nbId = await createNotebook(app, 'NB');
      const noteId = await createNote(app, nbId);

      const file = new File([new Uint8Array([0x00])], 'test.txt', { type: 'text/plain' });
      const formData = new FormData();
      formData.append('file', file);

      const res = await app.request(`/api/notes/${noteId}/images`, {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Unsupported image type');
    });

    it('should return 404 for non-existent note', async () => {
      const file = new File([new Uint8Array([0x00])], 'test.png', { type: 'image/png' });
      const formData = new FormData();
      formData.append('file', file);

      const res = await app.request('/api/notes/nonexistent/images', {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(404);
    });

    it('should accept JPEG images', async () => {
      const nbId = await createNotebook(app, 'NB');
      const noteId = await createNote(app, nbId);

      const file = new File([new Uint8Array([0xff, 0xd8])], 'photo.jpg', { type: 'image/jpeg' });
      const formData = new FormData();
      formData.append('file', file);

      const res = await app.request(`/api/notes/${noteId}/images`, {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.mimeType).toBe('image/jpeg');
    });

    it('should accept WebP images', async () => {
      const nbId = await createNotebook(app, 'NB');
      const noteId = await createNote(app, nbId);

      const file = new File([new Uint8Array([0x52, 0x49])], 'image.webp', { type: 'image/webp' });
      const formData = new FormData();
      formData.append('file', file);

      const res = await app.request(`/api/notes/${noteId}/images`, {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.mimeType).toBe('image/webp');
    });

    it('should accept SVG images', async () => {
      const nbId = await createNotebook(app, 'NB');
      const noteId = await createNote(app, nbId);

      const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
      const file = new File([svgContent], 'icon.svg', { type: 'image/svg+xml' });
      const formData = new FormData();
      formData.append('file', file);

      const res = await app.request(`/api/notes/${noteId}/images`, {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.mimeType).toBe('image/svg+xml');
    });

    it('should accept GIF images', async () => {
      const nbId = await createNotebook(app, 'NB');
      const noteId = await createNote(app, nbId);

      const file = new File([new Uint8Array([0x47, 0x49, 0x46])], 'anim.gif', { type: 'image/gif' });
      const formData = new FormData();
      formData.append('file', file);

      const res = await app.request(`/api/notes/${noteId}/images`, {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.mimeType).toBe('image/gif');
    });
  });

  // ── GET /api/images/:id ──────────────────────────────────────────

  describe('GET /api/images/:id', () => {
    it('should serve an uploaded image with correct MIME type', async () => {
      const nbId = await createNotebook(app, 'NB');
      const noteId = await createNote(app, nbId);

      // Upload an image
      const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const file = new File([imageData], 'test.png', { type: 'image/png' });
      const formData = new FormData();
      formData.append('file', file);

      const uploadRes = await app.request(`/api/notes/${noteId}/images`, {
        method: 'POST',
        body: formData,
      });
      const uploadBody = await uploadRes.json();

      // Serve the image
      const serveRes = await app.request(`/api/images/${uploadBody.id}`);
      expect(serveRes.status).toBe(200);
      expect(serveRes.headers.get('Content-Type')).toBe('image/png');
      expect(serveRes.headers.get('Cache-Control')).toContain('immutable');

      const servedData = new Uint8Array(await serveRes.arrayBuffer());
      expect(servedData).toEqual(imageData);
    });

    it('should return 404 for non-existent image', async () => {
      const res = await app.request('/api/images/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
