import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../helpers/db.ts';
import { createNotebooksDAL } from '../../../src/server/dal/notebooks.dal.ts';

describe('NotebooksDAL', () => {
  let db: TestDatabase;
  let dal: ReturnType<typeof createNotebooksDAL>;

  beforeEach(() => {
    db = createTestDatabase();
    // The TestDatabase interface is compatible with Database, cast for DAL usage
    dal = createNotebooksDAL(db as any);
  });

  afterEach(() => {
    db.close();
  });

  // Helper to create a stack directly in the DB
  function createStack(name: string): string {
    const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
    db.prepare(
      "INSERT INTO notebook_stacks (id, name) VALUES (?, ?)"
    ).run(id, name);
    return id;
  }

  // Helper to create a note in a notebook
  function createNote(notebookId: string, title = 'Test Note'): string {
    const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
    db.prepare(
      "INSERT INTO notes (id, title, notebook_id) VALUES (?, ?, ?)"
    ).run(id, title, notebookId);
    return id;
  }

  describe('create', () => {
    it('should create a notebook without a stack', () => {
      const notebook = dal.create('My Notebook');

      expect(notebook.id).toBeTruthy();
      expect(notebook.name).toBe('My Notebook');
      expect(notebook.stack_id).toBeNull();
      expect(notebook.created_at).toBeTruthy();
      expect(notebook.updated_at).toBeTruthy();
    });

    it('should create a notebook within a stack', () => {
      const stackId = createStack('Work');
      const notebook = dal.create('Meeting Notes', stackId);

      expect(notebook.name).toBe('Meeting Notes');
      expect(notebook.stack_id).toBe(stackId);
    });

    it('should persist the notebook to the database', () => {
      const notebook = dal.create('Persisted');
      const row = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(notebook.id) as any;

      expect(row).not.toBeNull();
      expect(row.name).toBe('Persisted');
    });

    it('should generate unique IDs for each notebook', () => {
      const nb1 = dal.create('First');
      const nb2 = dal.create('Second');

      expect(nb1.id).not.toBe(nb2.id);
    });

    it('should trim whitespace from the name', () => {
      const notebook = dal.create('  Trimmed Name  ');
      expect(notebook.name).toBe('Trimmed Name');
    });

    it('should throw on empty name', () => {
      expect(() => dal.create('')).toThrow('Notebook name cannot be empty');
    });

    it('should throw on whitespace-only name', () => {
      expect(() => dal.create('   ')).toThrow('Notebook name cannot be empty');
    });

    it('should allow same name in different stacks', () => {
      const stack1 = createStack('Stack A');
      const stack2 = createStack('Stack B');

      const nb1 = dal.create('Notes', stack1);
      const nb2 = dal.create('Notes', stack2);

      expect(nb1.id).not.toBe(nb2.id);
      expect(nb1.name).toBe(nb2.name);
    });

    it('should allow same name with one in a stack and one without', () => {
      const stackId = createStack('Work');

      const nb1 = dal.create('Notes', stackId);
      const nb2 = dal.create('Notes'); // no stack (null)

      expect(nb1.id).not.toBe(nb2.id);
    });

    it('should reject duplicate name within the same stack', () => {
      const stackId = createStack('Work');
      dal.create('Notes', stackId);

      expect(() => dal.create('Notes', stackId)).toThrow();
    });

    it('should reject duplicate name when both have no stack', () => {
      dal.create('Notes');

      expect(() => dal.create('Notes')).toThrow();
    });
  });

  describe('getAll', () => {
    it('should return empty array when no notebooks exist', () => {
      const result = dal.getAll();
      expect(result).toEqual([]);
    });

    it('should return all notebooks with metadata', () => {
      const stackId = createStack('Work');
      dal.create('Notebook A', stackId);
      dal.create('Notebook B');

      const result = dal.getAll();
      expect(result).toHaveLength(2);
    });

    it('should include stack name for notebooks in a stack', () => {
      const stackId = createStack('Work');
      dal.create('Meeting Notes', stackId);

      const result = dal.getAll();
      expect(result[0].stack_name).toBe('Work');
    });

    it('should have null stack_name for notebooks without a stack', () => {
      dal.create('Standalone');

      const result = dal.getAll();
      expect(result[0].stack_name).toBeNull();
    });

    it('should include accurate note counts (non-trashed only)', () => {
      const nb = dal.create('With Notes');
      createNote(nb.id, 'Note 1');
      createNote(nb.id, 'Note 2');

      // Create a trashed note — should not count
      const trashedId = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
      db.prepare(
        "INSERT INTO notes (id, title, notebook_id, is_trashed) VALUES (?, ?, ?, 1)"
      ).run(trashedId, 'Trashed', nb.id);

      const result = dal.getAll();
      const found = result.find(n => n.id === nb.id);
      expect(found!.note_count).toBe(2);
    });

    it('should return 0 note count for empty notebooks', () => {
      dal.create('Empty');

      const result = dal.getAll();
      expect(result[0].note_count).toBe(0);
    });

    it('should order notebooks by name', () => {
      dal.create('Zebra');
      dal.create('Alpha');
      dal.create('Middle');

      const result = dal.getAll();
      const names = result.map(n => n.name);
      expect(names).toEqual(['Alpha', 'Middle', 'Zebra']);
    });
  });

  describe('getById', () => {
    it('should return a notebook by ID', () => {
      const created = dal.create('Find Me');
      const found = dal.getById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('Find Me');
    });

    it('should return null for non-existent ID', () => {
      const found = dal.getById('nonexistent');
      expect(found).toBeNull();
    });

    it('should include stack_id when notebook is in a stack', () => {
      const stackId = createStack('Work');
      const created = dal.create('In Stack', stackId);
      const found = dal.getById(created.id);

      expect(found!.stack_id).toBe(stackId);
    });
  });

  describe('update', () => {
    it('should rename a notebook', () => {
      const nb = dal.create('Old Name');
      const updated = dal.update(nb.id, { name: 'New Name' });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
    });

    it('should move a notebook to a stack', () => {
      const nb = dal.create('Movable');
      const stackId = createStack('Target Stack');

      const updated = dal.update(nb.id, { stackId });
      expect(updated!.stack_id).toBe(stackId);
    });

    it('should remove a notebook from a stack', () => {
      const stackId = createStack('Source Stack');
      const nb = dal.create('In Stack', stackId);

      const updated = dal.update(nb.id, { stackId: null });
      expect(updated!.stack_id).toBeNull();
    });

    it('should update both name and stack at once', () => {
      const stack1 = createStack('Stack 1');
      const stack2 = createStack('Stack 2');
      const nb = dal.create('Original', stack1);

      const updated = dal.update(nb.id, { name: 'Renamed', stackId: stack2 });
      expect(updated!.name).toBe('Renamed');
      expect(updated!.stack_id).toBe(stack2);
    });

    it('should update the updated_at timestamp', () => {
      const nb = dal.create('Timestamped');
      const updated = dal.update(nb.id, { name: 'Changed' });

      // updated_at should be a valid datetime string
      expect(updated!.updated_at).toBeTruthy();
      expect(updated!.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      // The DB row should reflect the new updated_at
      const row = db.prepare('SELECT updated_at FROM notebooks WHERE id = ?').get(nb.id) as any;
      expect(row.updated_at).toBe(updated!.updated_at);
    });

    it('should persist the update to the database', () => {
      const nb = dal.create('Before');
      dal.update(nb.id, { name: 'After' });

      const row = db.prepare('SELECT name FROM notebooks WHERE id = ?').get(nb.id) as any;
      expect(row.name).toBe('After');
    });

    it('should return null for non-existent ID', () => {
      const result = dal.update('nonexistent', { name: 'Nope' });
      expect(result).toBeNull();
    });

    it('should throw on empty name', () => {
      const nb = dal.create('Valid');
      expect(() => dal.update(nb.id, { name: '' })).toThrow('Notebook name cannot be empty');
    });

    it('should reject duplicate name within the same stack on update', () => {
      const stackId = createStack('Shared');
      dal.create('Taken', stackId);
      const nb = dal.create('Available', stackId);

      expect(() => dal.update(nb.id, { name: 'Taken' })).toThrow();
    });

    it('should allow renaming to the same name (no-op rename)', () => {
      const nb = dal.create('Same');
      const updated = dal.update(nb.id, { name: 'Same' });
      expect(updated!.name).toBe('Same');
    });
  });

  describe('delete', () => {
    it('should delete an existing notebook', () => {
      const nb = dal.create('Doomed');
      const result = dal.delete(nb.id);

      expect(result).toBe(true);
      expect(dal.getById(nb.id)).toBeNull();
    });

    it('should return false for non-existent ID', () => {
      const result = dal.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('should cascade-delete notes in the notebook', () => {
      const nb = dal.create('With Notes');
      const noteId = createNote(nb.id, 'Child Note');

      dal.delete(nb.id);

      const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
      expect(note).toBeNull();
    });

    it('should not affect notebooks in other stacks', () => {
      const stack1 = createStack('Stack 1');
      const stack2 = createStack('Stack 2');
      const nb1 = dal.create('NB1', stack1);
      const nb2 = dal.create('NB2', stack2);

      dal.delete(nb1.id);

      expect(dal.getById(nb2.id)).not.toBeNull();
    });

    it('should handle deleting a notebook with multiple notes', () => {
      const nb = dal.create('Many Notes');
      createNote(nb.id, 'Note 1');
      createNote(nb.id, 'Note 2');
      createNote(nb.id, 'Note 3');

      dal.delete(nb.id);

      const count = db.prepare(
        'SELECT COUNT(*) as cnt FROM notes WHERE notebook_id = ?'
      ).get(nb.id) as { cnt: number };
      expect(count.cnt).toBe(0);
    });
  });
});
