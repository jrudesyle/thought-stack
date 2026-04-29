import { Hono } from 'hono';
import type { Database } from '../db/index.ts';

/**
 * Allowed MIME types for image uploads.
 */
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
]);

/**
 * Creates image API routes.
 *
 * Endpoints:
 *   POST /notes/:id/images  — upload an image for a note (multipart/form-data)
 *   GET  /images/:id         — serve an image by ID with correct MIME type
 */
export function createImagesRoutes(db: Database): Hono {
  const app = new Hono();

  // ── Upload image ─────────────────────────────────────────────────

  /**
   * POST /notes/:id/images — upload an image for a note.
   *
   * Expects multipart/form-data with a "file" field containing the image.
   * Validates MIME type and stores the image as a blob in note_images.
   */
  app.post('/notes/:id/images', async (c) => {
    const noteId = c.req.param('id');

    // Verify the note exists
    const note = db.prepare('SELECT id FROM notes WHERE id = ?').get(noteId);
    if (!note) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: `Note '${noteId}' not found` } },
        404,
      );
    }

    // Parse multipart form data
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Expected multipart/form-data with a "file" field' } },
        400,
      );
    }

    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Missing "file" field in form data', field: 'file' } },
        400,
      );
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: `Unsupported image type "${file.type}". Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
            field: 'file',
          },
        },
        400,
      );
    }

    // Read file data as buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Insert into note_images
    const id = crypto.randomUUID().replace(/-/g, '');
    db.prepare(
      `INSERT INTO note_images (id, note_id, mime_type, data) VALUES (?, ?, ?, ?)`
    ).run(id, noteId, file.type, buffer);

    return c.json({ id, noteId, mimeType: file.type, url: `/api/images/${id}` }, 201);
  });

  // ── Serve image ──────────────────────────────────────────────────

  /**
   * GET /images/:id — serve an image by ID with correct MIME type.
   */
  app.get('/images/:id', (c) => {
    const imageId = c.req.param('id');

    const image = db.prepare(
      'SELECT mime_type, data FROM note_images WHERE id = ?'
    ).get(imageId) as { mime_type: string; data: Buffer } | null;

    if (!image) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: `Image '${imageId}' not found` } },
        404,
      );
    }

    return new Response(image.data, {
      status: 200,
      headers: {
        'Content-Type': image.mime_type,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  });

  return app;
}
