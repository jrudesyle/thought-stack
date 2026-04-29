import { randomUUID } from 'node:crypto';
import type { Database } from '../db/index.ts';

/**
 * Row shape returned by note queries.
 */
export interface Note {
  id: string;
  title: string;
  content: string;
  notebook_id: string;
  is_trashed: number;
  trashed_at: string | null;
  original_notebook_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Note with its associated tags, returned by getById.
 */
export interface NoteWithTags extends Note {
  tags: NoteTag[];
}

/**
 * Tag info nested inside a note result.
 */
export interface NoteTag {
  id: string;
  name: string;
}

/**
 * Fields that can be updated on a note.
 */
export interface UpdateNoteInput {
  title?: string;
  content?: string;
}

/**
 * Options for listing notes with sorting and pagination.
 */
export interface ListOptions {
  sortBy?: 'updated_at' | 'created_at' | 'title';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Generates a hex UUID (32 hex chars, no dashes) matching the schema's
 * `lower(hex(randomblob(16)))` default format.
 */
function generateId(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * Returns the current datetime formatted for SQLite storage.
 */
function now(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

// Allowed sort columns to prevent SQL injection
const ALLOWED_SORT_COLUMNS = new Set(['updated_at', 'created_at', 'title']);

/**
 * Creates a Notes Data Access Layer bound to the given database instance.
 */
export function createNotesDAL(db: Database) {
  return {
    /**
     * Create a new note in the specified notebook.
     * Title defaults to empty string, content defaults to '{}' (empty TipTap JSON).
     */
    create(notebookId: string, title?: string, content?: string): Note {
      const id = generateId();
      const timestamp = now();
      const resolvedTitle = title ?? '';
      const resolvedContent = content ?? '{}';

      db.prepare(
        `INSERT INTO notes (id, title, content, notebook_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, resolvedTitle, resolvedContent, notebookId, timestamp, timestamp);

      return {
        id,
        title: resolvedTitle,
        content: resolvedContent,
        notebook_id: notebookId,
        is_trashed: 0,
        trashed_at: null,
        original_notebook_id: null,
        created_at: timestamp,
        updated_at: timestamp,
      };
    },

    /**
     * Fetch a single note by ID, including its associated tags.
     * Returns null if not found.
     */
    getById(id: string): NoteWithTags | null {
      const note = db.prepare(
        `SELECT id, title, content, notebook_id, is_trashed, trashed_at,
                original_notebook_id, created_at, updated_at
         FROM notes
         WHERE id = ?`
      ).get(id) as Note | null;

      if (!note) return null;

      const tags = db.prepare(
        `SELECT t.id, t.name
         FROM tags t
         INNER JOIN note_tags nt ON nt.tag_id = t.id
         WHERE nt.note_id = ?
         ORDER BY t.name`
      ).all(id) as NoteTag[];

      return { ...note, tags };
    },

    /**
     * List non-trashed notes in a specific notebook with sorting and pagination.
     * Defaults to sorting by updated_at DESC.
     */
    getByNotebook(notebookId: string, options?: ListOptions): Note[] {
      const sortBy = options?.sortBy && ALLOWED_SORT_COLUMNS.has(options.sortBy)
        ? options.sortBy
        : 'updated_at';
      const sortOrder = options?.sortOrder === 'asc' ? 'ASC' : 'DESC';

      let sql = `SELECT id, title, content, notebook_id, is_trashed, trashed_at,
                        original_notebook_id, created_at, updated_at
                 FROM notes
                 WHERE notebook_id = ? AND is_trashed = 0
                 ORDER BY ${sortBy} ${sortOrder}`;

      const params: unknown[] = [notebookId];

      if (options?.limit !== undefined) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      if (options?.offset !== undefined) {
        if (options?.limit === undefined) {
          sql += ' LIMIT -1';
        }
        sql += ' OFFSET ?';
        params.push(options.offset);
      }

      return db.prepare(sql).all(...params) as Note[];
    },

    /**
     * List all non-trashed notes sorted by updated_at DESC by default.
     * Supports sorting and pagination.
     */
    getAll(options?: ListOptions): Note[] {
      const sortBy = options?.sortBy && ALLOWED_SORT_COLUMNS.has(options.sortBy)
        ? options.sortBy
        : 'updated_at';
      const sortOrder = options?.sortOrder === 'asc' ? 'ASC' : 'DESC';

      let sql = `SELECT id, title, content, notebook_id, is_trashed, trashed_at,
                        original_notebook_id, created_at, updated_at
                 FROM notes
                 WHERE is_trashed = 0
                 ORDER BY ${sortBy} ${sortOrder}`;

      const params: unknown[] = [];

      if (options?.limit !== undefined) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      if (options?.offset !== undefined) {
        if (options?.limit === undefined) {
          sql += ' LIMIT -1';
        }
        sql += ' OFFSET ?';
        params.push(options.offset);
      }

      return db.prepare(sql).all(...params) as Note[];
    },

    /**
     * Update a note's title and/or content. Sets updated_at to current time.
     * Returns the updated note, or null if the ID doesn't exist.
     */
    update(id: string, updates: UpdateNoteInput): Note | null {
      const existing = db.prepare(
        `SELECT id, title, content, notebook_id, is_trashed, trashed_at,
                original_notebook_id, created_at, updated_at
         FROM notes WHERE id = ?`
      ).get(id) as Note | null;

      if (!existing) return null;

      const newTitle = updates.title !== undefined ? updates.title : existing.title;
      const newContent = updates.content !== undefined ? updates.content : existing.content;
      const timestamp = now();

      db.prepare(
        `UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?`
      ).run(newTitle, newContent, timestamp, id);

      return {
        ...existing,
        title: newTitle,
        content: newContent,
        updated_at: timestamp,
      };
    },

    /**
     * Move a note to a different notebook.
     * Returns true if the note was found and moved, false otherwise.
     */
    moveToNotebook(noteId: string, notebookId: string): boolean {
      const timestamp = now();
      const result = db.prepare(
        `UPDATE notes SET notebook_id = ?, updated_at = ? WHERE id = ?`
      ).run(notebookId, timestamp, noteId);
      return result.changes > 0;
    },

    /**
     * Duplicate a note. Creates a new note with title "Copy of {original title}"
     * in the same notebook with the same content.
     * Returns the new note, or null if the original doesn't exist.
     */
    duplicate(noteId: string): Note | null {
      const original = db.prepare(
        `SELECT id, title, content, notebook_id, is_trashed, trashed_at,
                original_notebook_id, created_at, updated_at
         FROM notes WHERE id = ?`
      ).get(noteId) as Note | null;

      if (!original) return null;

      const id = generateId();
      const timestamp = now();
      const newTitle = `Copy of ${original.title}`;

      db.prepare(
        `INSERT INTO notes (id, title, content, notebook_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, newTitle, original.content, original.notebook_id, timestamp, timestamp);

      return {
        id,
        title: newTitle,
        content: original.content,
        notebook_id: original.notebook_id,
        is_trashed: 0,
        trashed_at: null,
        original_notebook_id: null,
        created_at: timestamp,
        updated_at: timestamp,
      };
    },

    /**
     * Soft-delete a note: set is_trashed=1, trashed_at to current datetime,
     * and store the current notebook_id in original_notebook_id.
     * Returns true if the note was found and trashed, false otherwise.
     */
    softDelete(noteId: string): boolean {
      const timestamp = now();

      // Store original_notebook_id before trashing
      const result = db.prepare(
        `UPDATE notes
         SET is_trashed = 1,
             trashed_at = ?,
             original_notebook_id = notebook_id
         WHERE id = ? AND is_trashed = 0`
      ).run(timestamp, noteId);

      return result.changes > 0;
    },

    /**
     * Restore a note from trash.
     * Restores to original_notebook_id by default, or to a specified notebook.
     * Sets is_trashed=0, clears trashed_at.
     * Returns true if the note was found and restored, false otherwise.
     */
    restore(noteId: string, notebookId?: string): boolean {
      if (notebookId) {
        // Restore to specified notebook
        const result = db.prepare(
          `UPDATE notes
           SET is_trashed = 0,
               trashed_at = NULL,
               notebook_id = ?,
               original_notebook_id = NULL
           WHERE id = ? AND is_trashed = 1`
        ).run(notebookId, noteId);
        return result.changes > 0;
      }

      // Restore to original notebook
      const result = db.prepare(
        `UPDATE notes
         SET is_trashed = 0,
             trashed_at = NULL,
             notebook_id = COALESCE(original_notebook_id, notebook_id),
             original_notebook_id = NULL
         WHERE id = ? AND is_trashed = 1`
      ).run(noteId);
      return result.changes > 0;
    },

    /**
     * Permanently delete a note row. Cascades to note_tags and note_images
     * via the schema's ON DELETE CASCADE.
     * Returns true if a row was deleted, false otherwise.
     */
    permanentDelete(noteId: string): boolean {
      const result = db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
      return result.changes > 0;
    },

    /**
     * List all trashed notes, sorted by trashed_at DESC (most recently trashed first).
     */
    getTrash(): Note[] {
      return db.prepare(
        `SELECT id, title, content, notebook_id, is_trashed, trashed_at,
                original_notebook_id, created_at, updated_at
         FROM notes
         WHERE is_trashed = 1
         ORDER BY trashed_at DESC`
      ).all() as Note[];
    },

    /**
     * Permanently delete all trashed notes.
     * Returns the number of notes deleted.
     */
    emptyTrash(): number {
      const result = db.prepare('DELETE FROM notes WHERE is_trashed = 1').run();
      return result.changes;
    },
  };
}
