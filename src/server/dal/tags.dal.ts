import { randomUUID } from 'node:crypto';
import type { Database } from '../db/index.ts';

/**
 * Row shape returned by tag queries.
 */
export interface Tag {
  id: string;
  name: string;
  created_at: string;
}

/**
 * Tag with note count, returned by getAll().
 */
export interface TagWithCount extends Tag {
  note_count: number;
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

/**
 * Creates a Tags Data Access Layer bound to the given database instance.
 */
export function createTagsDAL(db: Database) {
  return {
    /**
     * Create a new tag.
     * Enforces unique name (case-insensitive via COLLATE NOCASE in schema).
     * Throws on duplicate or empty name.
     */
    create(name: string): Tag {
      if (!name || name.trim().length === 0) {
        throw new Error('Tag name cannot be empty');
      }

      const trimmedName = name.trim();
      const id = generateId();
      const timestamp = now();

      // Check for existing tag with same name (case-insensitive)
      const existing = db.prepare(
        'SELECT id FROM tags WHERE name = ?'
      ).get(trimmedName) as { id: string } | null;

      if (existing) {
        throw new Error(`A tag named '${trimmedName}' already exists`);
      }

      db.prepare(
        'INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)'
      ).run(id, trimmedName, timestamp);

      return {
        id,
        name: trimmedName,
        created_at: timestamp,
      };
    },

    /**
     * List all tags with note counts.
     * Only counts non-trashed notes.
     */
    getAll(): TagWithCount[] {
      return db.prepare(
        `SELECT
           t.id,
           t.name,
           t.created_at,
           COUNT(CASE WHEN n.is_trashed = 0 THEN 1 END) AS note_count
         FROM tags t
         LEFT JOIN note_tags nt ON nt.tag_id = t.id
         LEFT JOIN notes n ON n.id = nt.note_id
         GROUP BY t.id
         ORDER BY t.name`
      ).all() as TagWithCount[];
    },

    /**
     * Fetch a single tag by ID. Returns null if not found.
     */
    getById(id: string): Tag | null {
      return db.prepare(
        'SELECT id, name, created_at FROM tags WHERE id = ?'
      ).get(id) as Tag | null;
    },

    /**
     * Rename a tag. Since it's a single row in the tags table,
     * all associations automatically reflect the new name.
     * Returns the updated tag, or null if the ID doesn't exist.
     */
    rename(id: string, newName: string): Tag | null {
      if (!newName || newName.trim().length === 0) {
        throw new Error('Tag name cannot be empty');
      }

      const trimmedName = newName.trim();

      const existing = db.prepare(
        'SELECT id, name, created_at FROM tags WHERE id = ?'
      ).get(id) as Tag | null;

      if (!existing) return null;

      // Check for duplicate name (excluding self, case-insensitive)
      const dup = db.prepare(
        'SELECT id FROM tags WHERE name = ? AND id != ?'
      ).get(trimmedName, id) as { id: string } | null;

      if (dup) {
        throw new Error(`A tag named '${trimmedName}' already exists`);
      }

      db.prepare(
        'UPDATE tags SET name = ? WHERE id = ?'
      ).run(trimmedName, id);

      return {
        id,
        name: trimmedName,
        created_at: existing.created_at,
      };
    },

    /**
     * Delete a tag by ID. Cascades to note_tags via ON DELETE CASCADE.
     * Returns true if a row was deleted, false otherwise.
     */
    delete(id: string): boolean {
      const result = db.prepare('DELETE FROM tags WHERE id = ?').run(id);
      return result.changes > 0;
    },

    /**
     * Add a tag to a note. Creates the tag if it doesn't exist,
     * then creates the note_tag association.
     * Returns the tag (existing or newly created).
     */
    addToNote(noteId: string, tagName: string): Tag {
      if (!tagName || tagName.trim().length === 0) {
        throw new Error('Tag name cannot be empty');
      }

      const trimmedName = tagName.trim();

      // Find or create the tag
      let tag = db.prepare(
        'SELECT id, name, created_at FROM tags WHERE name = ?'
      ).get(trimmedName) as Tag | null;

      if (!tag) {
        const id = generateId();
        const timestamp = now();
        db.prepare(
          'INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)'
        ).run(id, trimmedName, timestamp);
        tag = { id, name: trimmedName, created_at: timestamp };
      }

      // Create the association (ignore if already exists)
      const existing = db.prepare(
        'SELECT note_id FROM note_tags WHERE note_id = ? AND tag_id = ?'
      ).get(noteId, tag.id);

      if (!existing) {
        db.prepare(
          'INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)'
        ).run(noteId, tag.id);
      }

      return tag;
    },

    /**
     * Remove a tag from a note. If no other notes use the tag,
     * auto-delete the orphan tag.
     * Returns true if the association was removed, false if it didn't exist.
     */
    removeFromNote(noteId: string, tagId: string): boolean {
      const result = db.prepare(
        'DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?'
      ).run(noteId, tagId);

      if (result.changes === 0) return false;

      // Check if the tag is now orphaned (no other notes use it)
      const remaining = db.prepare(
        'SELECT COUNT(*) AS cnt FROM note_tags WHERE tag_id = ?'
      ).get(tagId) as { cnt: number };

      if (remaining.cnt === 0) {
        db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
      }

      return true;
    },

    /**
     * List tags for a specific note.
     */
    getByNote(noteId: string): Tag[] {
      return db.prepare(
        `SELECT t.id, t.name, t.created_at
         FROM tags t
         INNER JOIN note_tags nt ON nt.tag_id = t.id
         WHERE nt.note_id = ?
         ORDER BY t.name`
      ).all(noteId) as Tag[];
    },

    /**
     * Return tags whose names start with the given prefix (case-insensitive).
     */
    autocomplete(prefix: string): Tag[] {
      if (!prefix || prefix.trim().length === 0) {
        return [];
      }

      const trimmedPrefix = prefix.trim();

      // Use LIKE with escaped prefix for case-insensitive prefix matching.
      // Escape any existing % or _ characters in the prefix.
      const escaped = trimmedPrefix.replace(/%/g, '\\%').replace(/_/g, '\\_');

      return db.prepare(
        `SELECT id, name, created_at
         FROM tags
         WHERE name LIKE ? ESCAPE '\\'
         ORDER BY name`
      ).all(`${escaped}%`) as Tag[];
    },
  };
}
