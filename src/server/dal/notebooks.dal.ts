import { randomUUID } from 'node:crypto';
import type { Database } from '../db/index.ts';

/**
 * Row shape returned by notebook queries.
 */
export interface Notebook {
  id: string;
  name: string;
  stack_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Extended notebook info returned by getAll(), includes stack name and note count.
 */
export interface NotebookWithMeta extends Notebook {
  stack_name: string | null;
  note_count: number;
}

/**
 * Fields that can be updated on a notebook.
 */
export interface UpdateNotebookInput {
  name?: string;
  stackId?: string | null;
}

/**
 * Generates a hex UUID (32 hex chars, no dashes) matching the schema's
 * `lower(hex(randomblob(16)))` default format.
 */
function generateId(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * Creates a Notebooks Data Access Layer bound to the given database instance.
 */
export function createNotebooksDAL(db: Database) {
  return {
    /**
     * Create a new notebook.
     * Enforces the UNIQUE(name, stack_id) constraint — throws on duplicate.
     */
    create(name: string, stackId?: string | null): Notebook {
      if (!name || name.trim().length === 0) {
        throw new Error('Notebook name cannot be empty');
      }

      const id = generateId();
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

      const trimmedName = name.trim();
      const resolvedStackId = stackId ?? null;

      // SQLite UNIQUE(name, stack_id) treats NULL != NULL, so we must
      // manually check for duplicates when stack_id is NULL.
      if (resolvedStackId === null) {
        const existing = db.prepare(
          `SELECT id FROM notebooks WHERE name = ? AND stack_id IS NULL`
        ).get(trimmedName);
        if (existing) {
          throw new Error(`A notebook named '${trimmedName}' already exists`);
        }
      }

      db.prepare(
        `INSERT INTO notebooks (id, name, stack_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(id, trimmedName, resolvedStackId, now, now);

      return {
        id,
        name: trimmedName,
        stack_id: resolvedStackId,
        created_at: now,
        updated_at: now,
      };
    },

    /**
     * List all notebooks with stack info and note counts.
     * Note counts only include non-trashed notes.
     */
    getAll(): NotebookWithMeta[] {
      return db.prepare(
        `SELECT
           n.id,
           n.name,
           n.stack_id,
           n.created_at,
           n.updated_at,
           s.name AS stack_name,
           COUNT(nt.id) AS note_count
         FROM notebooks n
         LEFT JOIN notebook_stacks s ON n.stack_id = s.id
         LEFT JOIN notes nt ON nt.notebook_id = n.id AND nt.is_trashed = 0
         GROUP BY n.id
         ORDER BY n.name`
      ).all() as NotebookWithMeta[];
    },

    /**
     * Fetch a single notebook by ID. Returns null if not found.
     */
    getById(id: string): Notebook | null {
      return db.prepare(
        `SELECT id, name, stack_id, created_at, updated_at
         FROM notebooks
         WHERE id = ?`
      ).get(id) as Notebook | null;
    },

    /**
     * Update a notebook's name and/or stack assignment.
     * Enforces the UNIQUE(name, stack_id) constraint — throws on duplicate.
     * Returns the updated notebook, or null if the ID doesn't exist.
     */
    update(id: string, updates: UpdateNotebookInput): Notebook | null {
      const existing = this.getById(id);
      if (!existing) return null;

      const newName = updates.name !== undefined ? updates.name.trim() : existing.name;
      const newStackId = updates.stackId !== undefined ? updates.stackId : existing.stack_id;

      if (!newName || newName.length === 0) {
        throw new Error('Notebook name cannot be empty');
      }

      // Check for duplicate name in the target stack (handle NULL stack_id)
      if (newStackId === null) {
        const dup = db.prepare(
          `SELECT id FROM notebooks WHERE name = ? AND stack_id IS NULL AND id != ?`
        ).get(newName, id);
        if (dup) {
          throw new Error(`A notebook named '${newName}' already exists`);
        }
      }

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

      db.prepare(
        `UPDATE notebooks
         SET name = ?, stack_id = ?, updated_at = ?
         WHERE id = ?`
      ).run(newName, newStackId, now, id);

      return {
        id,
        name: newName,
        stack_id: newStackId,
        created_at: existing.created_at,
        updated_at: now,
      };
    },

    /**
     * Delete a notebook by ID.
     * Notes in the notebook are cascade-deleted per the schema's ON DELETE CASCADE.
     * Returns true if a row was deleted, false if the ID didn't exist.
     */
    delete(id: string): boolean {
      const result = db.prepare('DELETE FROM notebooks WHERE id = ?').run(id);
      return result.changes > 0;
    },
  };
}
