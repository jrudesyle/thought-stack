import { Hono } from 'hono';
import type { Database } from '../db/index.ts';
import { createTagsDAL } from '../dal/tags.dal.ts';

/**
 * Creates tag API routes and note-tag association routes.
 *
 * Tag endpoints:
 *   GET    /tags                         — list all tags with note counts
 *   GET    /tags/autocomplete?q=         — tag auto-complete (registered BEFORE /tags/:id)
 *   POST   /tags                         — create tag
 *   PUT    /tags/:id                     — rename tag
 *   DELETE /tags/:id                     — delete tag
 *
 * Note-tag association endpoints:
 *   POST   /notes/:noteId/tags           — add tag to note (auto-create if needed)
 *   DELETE /notes/:noteId/tags/:tagId    — remove tag from note (auto-delete orphan)
 */
export function createTagsRoutes(db: Database): Hono {
  const app = new Hono();
  const tagsDAL = createTagsDAL(db);

  // ── List all tags ────────────────────────────────────────────────

  /**
   * GET /tags — list all tags with note counts.
   */
  app.get('/tags', (c) => {
    const tags = tagsDAL.getAll();
    return c.json(tags);
  });

  // ── Autocomplete (must be BEFORE /tags/:id) ──────────────────────

  /**
   * GET /tags/autocomplete?q= — tag auto-complete.
   * Returns tags whose names start with the given prefix (case-insensitive).
   */
  app.get('/tags/autocomplete', (c) => {
    const q = c.req.query('q') ?? '';
    const tags = tagsDAL.autocomplete(q);
    return c.json(tags);
  });

  // ── Create tag ───────────────────────────────────────────────────

  /**
   * POST /tags — create a new tag.
   * Body: { name: string }
   */
  app.post('/tags', async (c) => {
    const body = await c.req.json<{ name?: string }>();

    if (!body.name || body.name.trim().length === 0) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Tag name is required',
            field: 'name',
          },
        },
        400,
      );
    }

    try {
      const tag = tagsDAL.create(body.name);
      return c.json(tag, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already exists')) {
        return c.json(
          {
            error: {
              code: 'DUPLICATE_NAME',
              message,
              field: 'name',
            },
          },
          409,
        );
      }
      throw err;
    }
  });

  // ── Rename tag ───────────────────────────────────────────────────

  /**
   * PUT /tags/:id — rename a tag.
   * Body: { name: string }
   */
  app.put('/tags/:id', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<{ name?: string }>();

    if (!body.name || body.name.trim().length === 0) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Tag name is required',
            field: 'name',
          },
        },
        400,
      );
    }

    try {
      const updated = tagsDAL.rename(id, body.name);

      if (!updated) {
        return c.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: `Tag '${id}' not found`,
            },
          },
          404,
        );
      }

      return c.json(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already exists')) {
        return c.json(
          {
            error: {
              code: 'DUPLICATE_NAME',
              message,
              field: 'name',
            },
          },
          409,
        );
      }
      throw err;
    }
  });

  // ── Delete tag ───────────────────────────────────────────────────

  /**
   * DELETE /tags/:id — delete a tag.
   * Cascades to note_tags via ON DELETE CASCADE.
   */
  app.delete('/tags/:id', (c) => {
    const { id } = c.req.param();
    const deleted = tagsDAL.delete(id);

    if (!deleted) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Tag '${id}' not found`,
          },
        },
        404,
      );
    }

    return c.json({ success: true });
  });

  // ── Add tag to note ──────────────────────────────────────────────

  /**
   * POST /notes/:noteId/tags — add a tag to a note.
   * Auto-creates the tag if it doesn't exist.
   * Body: { name: string }
   */
  app.post('/notes/:noteId/tags', async (c) => {
    const { noteId } = c.req.param();
    const body = await c.req.json<{ name?: string }>();

    if (!body.name || body.name.trim().length === 0) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Tag name is required',
            field: 'name',
          },
        },
        400,
      );
    }

    // Verify the note exists
    const note = db.prepare(
      'SELECT id FROM notes WHERE id = ?'
    ).get(noteId);

    if (!note) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Note '${noteId}' not found`,
          },
        },
        404,
      );
    }

    const tag = tagsDAL.addToNote(noteId, body.name);
    return c.json(tag, 201);
  });

  // ── Remove tag from note ─────────────────────────────────────────

  /**
   * DELETE /notes/:noteId/tags/:tagId — remove a tag from a note.
   * Auto-deletes the tag if it becomes orphaned.
   */
  app.delete('/notes/:noteId/tags/:tagId', (c) => {
    const { noteId, tagId } = c.req.param();

    // Verify the note exists
    const note = db.prepare(
      'SELECT id FROM notes WHERE id = ?'
    ).get(noteId);

    if (!note) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Note '${noteId}' not found`,
          },
        },
        404,
      );
    }

    const removed = tagsDAL.removeFromNote(noteId, tagId);

    if (!removed) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Tag '${tagId}' is not associated with note '${noteId}'`,
          },
        },
        404,
      );
    }

    return c.json({ success: true });
  });

  return app;
}
