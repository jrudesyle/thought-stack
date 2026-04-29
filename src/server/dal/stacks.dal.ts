import { randomUUID } from 'node:crypto';
import type { Database } from '../db/index.ts';

/**
 * Row shape returned by stack queries.
 */
export interface Stack {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/**
 * Stack with its nested notebooks, used for sidebar rendering.
 */
export interface StackWithNotebooks extends Stack {
  notebooks: StackNotebook[];
}

/**
 * Notebook info nested inside a stack result.
 */
export interface StackNotebook {
  id: string;
  name: string;
  note_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Generates a hex UUID (32 hex chars, no dashes) matching the schema's
 * `lower(hex(randomblob(16)))` default format.
 */
function generateId(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * Creates a Notebook Stacks Data Access Layer bound to the given database instance.
 */
export function createStacksDAL(db: Database) {
  return {
    /**
     * Create a new notebook stack.
     * Enforces the UNIQUE constraint on name — throws on duplicate.
     */
    create(name: string): Stack {
      if (!name || name.trim().length === 0) {
        throw new Error('Stack name cannot be empty');
      }

      const id = generateId();
      const trimmedName = name.trim();
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

      // Check for duplicate name (the DB UNIQUE constraint would catch this too,
      // but we provide a friendlier error message)
      const existing = db.prepare(
        'SELECT id FROM notebook_stacks WHERE name = ?'
      ).get(trimmedName);
      if (existing) {
        throw new Error(`A stack named '${trimmedName}' already exists`);
      }

      db.prepare(
        `INSERT INTO notebook_stacks (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      ).run(id, trimmedName, now, now);

      return {
        id,
        name: trimmedName,
        created_at: now,
        updated_at: now,
      };
    },

    /**
     * List all stacks with their nested notebooks.
     * Each notebook includes a note_count of non-trashed notes.
     * Used for sidebar rendering.
     */
    getAll(): StackWithNotebooks[] {
      // Fetch all stacks
      const stacks = db.prepare(
        `SELECT id, name, created_at, updated_at
         FROM notebook_stacks
         ORDER BY name`
      ).all() as Stack[];

      // Fetch all notebooks that belong to a stack, with note counts
      const notebooks = db.prepare(
        `SELECT
           n.id,
           n.name,
           n.stack_id,
           n.created_at,
           n.updated_at,
           COUNT(nt.id) AS note_count
         FROM notebooks n
         LEFT JOIN notes nt ON nt.notebook_id = n.id AND nt.is_trashed = 0
         WHERE n.stack_id IS NOT NULL
         GROUP BY n.id
         ORDER BY n.name`
      ).all() as (StackNotebook & { stack_id: string })[];

      // Group notebooks by stack_id
      const notebooksByStack = new Map<string, StackNotebook[]>();
      for (const nb of notebooks) {
        const list = notebooksByStack.get(nb.stack_id) ?? [];
        list.push({
          id: nb.id,
          name: nb.name,
          note_count: nb.note_count,
          created_at: nb.created_at,
          updated_at: nb.updated_at,
        });
        notebooksByStack.set(nb.stack_id, list);
      }

      return stacks.map(stack => ({
        ...stack,
        notebooks: notebooksByStack.get(stack.id) ?? [],
      }));
    },

    /**
     * Rename a stack.
     * Enforces the UNIQUE constraint on name — throws on duplicate.
     * Returns the updated stack, or null if the ID doesn't exist.
     */
    update(id: string, name: string): Stack | null {
      const existing = db.prepare(
        'SELECT id, name, created_at, updated_at FROM notebook_stacks WHERE id = ?'
      ).get(id) as Stack | null;

      if (!existing) return null;

      if (!name || name.trim().length === 0) {
        throw new Error('Stack name cannot be empty');
      }

      const trimmedName = name.trim();

      // Check for duplicate name (excluding self)
      const dup = db.prepare(
        'SELECT id FROM notebook_stacks WHERE name = ? AND id != ?'
      ).get(trimmedName, id);
      if (dup) {
        throw new Error(`A stack named '${trimmedName}' already exists`);
      }

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

      db.prepare(
        `UPDATE notebook_stacks SET name = ?, updated_at = ? WHERE id = ?`
      ).run(trimmedName, now, id);

      return {
        id,
        name: trimmedName,
        created_at: existing.created_at,
        updated_at: now,
      };
    },

    /**
     * Delete a stack by ID.
     * Notebooks in the stack have their stack_id set to NULL (not deleted),
     * per the schema's ON DELETE SET NULL foreign key constraint.
     * Returns true if a row was deleted, false if the ID didn't exist.
     */
    delete(id: string): boolean {
      const result = db.prepare('DELETE FROM notebook_stacks WHERE id = ?').run(id);
      return result.changes > 0;
    },

    /**
     * Auto-clean empty stacks: delete any stacks that have zero notebooks.
     * Called after notebook moves/deletes to implement the
     * "auto-delete empty stack" requirement (Requirement 2.4).
     * Returns the number of stacks deleted.
     */
    autoCleanEmpty(): number {
      const result = db.prepare(
        `DELETE FROM notebook_stacks
         WHERE id NOT IN (
           SELECT DISTINCT stack_id FROM notebooks WHERE stack_id IS NOT NULL
         )`
      ).run();
      return result.changes;
    },
  };
}
