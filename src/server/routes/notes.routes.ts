import { Hono } from 'hono';
import type { Database } from '../db/index.ts';
import { createNotesDAL } from '../dal/notes.dal.ts';
import { createSearchDAL } from '../dal/search.dal.ts';

/**
 * Creates notes API routes.
 *
 * Endpoints:
 *   GET    /notes                  — list notes (query: notebookId, tagId, trash)
 *   GET    /notes/:id              — get single note with content and tags
 *   POST   /notes                  — create note
 *   PUT    /notes/:id              — update note (content, title, metadata); trigger FTS reindex
 *   DELETE /notes/trash             — empty trash (must be before /:id to avoid matching "trash" as ID)
 *   DELETE /notes/:id              — soft delete (move to trash)
 *   POST   /notes/:id/duplicate    — duplicate note
 *   POST   /notes/:id/move         — move to different notebook
 *   POST   /notes/:id/restore      — restore from trash
 *   DELETE /notes/:id/permanent    — permanent delete from trash
 */
export function createNotesRoutes(db: Database): Hono {
  const app = new Hono();
  const notesDAL = createNotesDAL(db);
  const searchDAL = createSearchDAL(db);

  // ── List notes ───────────────────────────────────────────────────

  /**
   * GET /notes — list notes with optional filters.
   * Query params:
   *   - notebookId: filter by notebook
   *   - tagId: filter by tag
   *   - trash: if "true", return trashed notes
   */
  app.get('/notes', (c) => {
    const notebookId = c.req.query('notebookId');
    const tagId = c.req.query('tagId');
    const trash = c.req.query('trash');

    // Return trashed notes
    if (trash === 'true') {
      const trashed = notesDAL.getTrash();
      return c.json(trashed);
    }

    // Filter by notebook
    if (notebookId) {
      const notes = notesDAL.getByNotebook(notebookId);
      return c.json(notes);
    }

    // Filter by tag — query notes associated with the given tag
    if (tagId) {
      const notes = db.prepare(
        `SELECT n.id, n.title, n.content, n.notebook_id, n.is_trashed, n.trashed_at,
                n.original_notebook_id, n.created_at, n.updated_at
         FROM notes n
         INNER JOIN note_tags nt ON nt.note_id = n.id
         WHERE nt.tag_id = ? AND n.is_trashed = 0
         ORDER BY n.updated_at DESC`
      ).all(tagId) as unknown[];
      return c.json(notes);
    }

    // Default: all non-trashed notes
    const notes = notesDAL.getAll();
    return c.json(notes);
  });

  // ── Get single note ──────────────────────────────────────────────

  /**
   * GET /notes/:id — get a single note with content and tags.
   */
  app.get('/notes/:id', (c) => {
    const { id } = c.req.param();
    const note = notesDAL.getById(id);

    if (!note) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Note '${id}' not found`,
          },
        },
        404,
      );
    }

    return c.json(note);
  });

  // ── Create note ──────────────────────────────────────────────────

  /**
   * POST /notes — create a new note.
   * Body: { notebookId: string, title?: string, content?: string }
   */
  app.post('/notes', async (c) => {
    const body = await c.req.json<{
      notebookId?: string;
      title?: string;
      content?: string;
    }>();

    if (!body.notebookId || body.notebookId.trim().length === 0) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'notebookId is required',
            field: 'notebookId',
          },
        },
        400,
      );
    }

    // Verify the notebook exists
    const notebook = db.prepare(
      'SELECT id FROM notebooks WHERE id = ?'
    ).get(body.notebookId);

    if (!notebook) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Notebook '${body.notebookId}' not found`,
          },
        },
        404,
      );
    }

    const note = notesDAL.create(body.notebookId, body.title, body.content);
    return c.json(note, 201);
  });

  // ── Update note ──────────────────────────────────────────────────

  /**
   * PUT /notes/:id — update a note's title and/or content.
   * Body: { title?: string, content?: string }
   * Triggers FTS reindex when content is updated.
   */
  app.put('/notes/:id', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<{ title?: string; content?: string }>();

    const updated = notesDAL.update(id, {
      title: body.title,
      content: body.content,
    });

    if (!updated) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Note '${id}' not found`,
          },
        },
        404,
      );
    }

    // Trigger FTS reindex when content or title changes
    if (body.content !== undefined || body.title !== undefined) {
      searchDAL.reindex(id);
    }

    return c.json(updated);
  });

  // ── Empty trash (must be before DELETE /notes/:id) ───────────────

  /**
   * DELETE /notes/trash — permanently delete all trashed notes.
   */
  app.delete('/notes/trash', (c) => {
    const count = notesDAL.emptyTrash();
    return c.json({ success: true, deleted: count });
  });

  // ── Soft delete ──────────────────────────────────────────────────

  /**
   * DELETE /notes/:id — soft delete a note (move to trash).
   */
  app.delete('/notes/:id', (c) => {
    const { id } = c.req.param();
    const deleted = notesDAL.softDelete(id);

    if (!deleted) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Note '${id}' not found`,
          },
        },
        404,
      );
    }

    return c.json({ success: true });
  });

  // ── Duplicate note ───────────────────────────────────────────────

  /**
   * POST /notes/:id/duplicate — duplicate a note.
   */
  app.post('/notes/:id/duplicate', (c) => {
    const { id } = c.req.param();
    const duplicate = notesDAL.duplicate(id);

    if (!duplicate) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Note '${id}' not found`,
          },
        },
        404,
      );
    }

    return c.json(duplicate, 201);
  });

  // ── Move note ────────────────────────────────────────────────────

  /**
   * POST /notes/:id/move — move a note to a different notebook.
   * Body: { notebookId: string }
   */
  app.post('/notes/:id/move', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<{ notebookId?: string }>();

    if (!body.notebookId || body.notebookId.trim().length === 0) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'notebookId is required',
            field: 'notebookId',
          },
        },
        400,
      );
    }

    // Verify the target notebook exists
    const notebook = db.prepare(
      'SELECT id FROM notebooks WHERE id = ?'
    ).get(body.notebookId);

    if (!notebook) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Notebook '${body.notebookId}' not found`,
          },
        },
        404,
      );
    }

    const moved = notesDAL.moveToNotebook(id, body.notebookId);

    if (!moved) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Note '${id}' not found`,
          },
        },
        404,
      );
    }

    return c.json({ success: true });
  });

  // ── Restore from trash ───────────────────────────────────────────

  /**
   * POST /notes/:id/restore — restore a note from trash.
   * Body: { notebookId?: string } — optional target notebook
   */
  app.post('/notes/:id/restore', async (c) => {
    const { id } = c.req.param();

    let notebookId: string | undefined;
    try {
      const body = await c.req.json<{ notebookId?: string }>();
      notebookId = body.notebookId;
    } catch {
      // No body is fine — restore to original notebook
    }

    const restored = notesDAL.restore(id, notebookId);

    if (!restored) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Note '${id}' not found in trash`,
          },
        },
        404,
      );
    }

    return c.json({ success: true });
  });

  // ── Permanent delete ─────────────────────────────────────────────

  /**
   * DELETE /notes/:id/permanent — permanently delete a note from trash.
   */
  app.delete('/notes/:id/permanent', (c) => {
    const { id } = c.req.param();
    const deleted = notesDAL.permanentDelete(id);

    if (!deleted) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Note '${id}' not found`,
          },
        },
        404,
      );
    }

    return c.json({ success: true });
  });

  return app;
}
