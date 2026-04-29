import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../helpers/db.ts';
import { createStacksDAL } from '../../../src/server/dal/stacks.dal.ts';

describe('StacksDAL', () => {
  let db: TestDatabase;
  let dal: ReturnType<typeof createStacksDAL>;

  beforeEach(() => {
    db = createTestDatabase();
    dal = createStacksDAL(db as any);
  });

  afterEach(() => {
    db.close();
  });

  // Helper to create a notebook directly in the DB
  function createNotebook(name: string, stackId: string | null = null): string {
    const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
    db.prepare(
      'INSERT INTO notebooks (id, name, stack_id) VALUES (?, ?, ?)'
    ).run(id, name, stackId);
    return id;
  }

  // Helper to create a note in a notebook
  function createNote(notebookId: string, title = 'Test Note'): string {
    const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
    db.prepare(
      'INSERT INTO notes (id, title, notebook_id) VALUES (?, ?, ?)'
    ).run(id, title, notebookId);
    return id;
  }

  describe('create', () => {
    it('should create a stack with a valid name', () => {
      const stack = dal.create('Work');

      expect(stack.id).toBeTruthy();
      expect(stack.name).toBe('Work');
      expect(stack.created_at).toBeTruthy();
      expect(stack.updated_at).toBeTruthy();
    });

    it('should persist the stack to the database', () => {
      const stack = dal.create('Persisted');
      const row = db.prepare('SELECT * FROM notebook_stacks WHERE id = ?').get(stack.id) as any;

      expect(row).not.toBeNull();
      expect(row.name).toBe('Persisted');
    });

    it('should generate unique IDs for each stack', () => {
      const s1 = dal.create('First');
      const s2 = dal.create('Second');

      expect(s1.id).not.toBe(s2.id);
    });

    it('should trim whitespace from the name', () => {
      const stack = dal.create('  Trimmed  ');
      expect(stack.name).toBe('Trimmed');
    });

    it('should throw on empty name', () => {
      expect(() => dal.create('')).toThrow('Stack name cannot be empty');
    });

    it('should throw on whitespace-only name', () => {
      expect(() => dal.create('   ')).toThrow('Stack name cannot be empty');
    });

    it('should reject duplicate stack names', () => {
      dal.create('Unique');
      expect(() => dal.create('Unique')).toThrow("A stack named 'Unique' already exists");
    });

    it('should reject duplicate names after trimming', () => {
      dal.create('Work');
      expect(() => dal.create('  Work  ')).toThrow("A stack named 'Work' already exists");
    });
  });

  describe('getAll', () => {
    it('should return empty array when no stacks exist', () => {
      const result = dal.getAll();
      expect(result).toEqual([]);
    });

    it('should return all stacks ordered by name', () => {
      dal.create('Zebra');
      dal.create('Alpha');
      dal.create('Middle');

      const result = dal.getAll();
      const names = result.map(s => s.name);
      expect(names).toEqual(['Alpha', 'Middle', 'Zebra']);
    });

    it('should include nested notebooks for each stack', () => {
      const stack = dal.create('Work');
      createNotebook('Meeting Notes', stack.id);
      createNotebook('Project Plans', stack.id);

      const result = dal.getAll();
      expect(result).toHaveLength(1);
      expect(result[0].notebooks).toHaveLength(2);
    });

    it('should return empty notebooks array for stacks with no notebooks', () => {
      dal.create('Empty Stack');

      const result = dal.getAll();
      expect(result[0].notebooks).toEqual([]);
    });

    it('should include note counts for nested notebooks (non-trashed only)', () => {
      const stack = dal.create('Work');
      const nbId = createNotebook('Notes', stack.id);
      createNote(nbId, 'Note 1');
      createNote(nbId, 'Note 2');

      // Create a trashed note — should not count
      const trashedId = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
      db.prepare(
        'INSERT INTO notes (id, title, notebook_id, is_trashed) VALUES (?, ?, ?, 1)'
      ).run(trashedId, 'Trashed', nbId);

      const result = dal.getAll();
      expect(result[0].notebooks[0].note_count).toBe(2);
    });

    it('should order nested notebooks by name', () => {
      const stack = dal.create('Work');
      createNotebook('Zebra NB', stack.id);
      createNotebook('Alpha NB', stack.id);

      const result = dal.getAll();
      const nbNames = result[0].notebooks.map(nb => nb.name);
      expect(nbNames).toEqual(['Alpha NB', 'Zebra NB']);
    });

    it('should not include notebooks without a stack', () => {
      const stack = dal.create('Work');
      createNotebook('In Stack', stack.id);
      createNotebook('No Stack', null);

      const result = dal.getAll();
      expect(result[0].notebooks).toHaveLength(1);
      expect(result[0].notebooks[0].name).toBe('In Stack');
    });

    it('should handle multiple stacks with their own notebooks', () => {
      const s1 = dal.create('Stack A');
      const s2 = dal.create('Stack B');
      createNotebook('NB in A', s1.id);
      createNotebook('NB in B', s2.id);

      const result = dal.getAll();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Stack A');
      expect(result[0].notebooks).toHaveLength(1);
      expect(result[0].notebooks[0].name).toBe('NB in A');
      expect(result[1].name).toBe('Stack B');
      expect(result[1].notebooks).toHaveLength(1);
      expect(result[1].notebooks[0].name).toBe('NB in B');
    });
  });

  describe('update', () => {
    it('should rename a stack', () => {
      const stack = dal.create('Old Name');
      const updated = dal.update(stack.id, 'New Name');

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
    });

    it('should update the updated_at timestamp', () => {
      const stack = dal.create('Timestamped');
      const updated = dal.update(stack.id, 'Changed');

      expect(updated!.updated_at).toBeTruthy();
      expect(updated!.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('should persist the update to the database', () => {
      const stack = dal.create('Before');
      dal.update(stack.id, 'After');

      const row = db.prepare('SELECT name FROM notebook_stacks WHERE id = ?').get(stack.id) as any;
      expect(row.name).toBe('After');
    });

    it('should return null for non-existent ID', () => {
      const result = dal.update('nonexistent', 'Nope');
      expect(result).toBeNull();
    });

    it('should throw on empty name', () => {
      const stack = dal.create('Valid');
      expect(() => dal.update(stack.id, '')).toThrow('Stack name cannot be empty');
    });

    it('should throw on whitespace-only name', () => {
      const stack = dal.create('Valid');
      expect(() => dal.update(stack.id, '   ')).toThrow('Stack name cannot be empty');
    });

    it('should reject duplicate name on update', () => {
      dal.create('Taken');
      const stack = dal.create('Available');

      expect(() => dal.update(stack.id, 'Taken')).toThrow("A stack named 'Taken' already exists");
    });

    it('should allow renaming to the same name (no-op rename)', () => {
      const stack = dal.create('Same');
      const updated = dal.update(stack.id, 'Same');
      expect(updated!.name).toBe('Same');
    });

    it('should trim whitespace from the new name', () => {
      const stack = dal.create('Original');
      const updated = dal.update(stack.id, '  Trimmed  ');
      expect(updated!.name).toBe('Trimmed');
    });
  });

  describe('delete', () => {
    it('should delete an existing stack', () => {
      const stack = dal.create('Doomed');
      const result = dal.delete(stack.id);

      expect(result).toBe(true);

      const row = db.prepare('SELECT * FROM notebook_stacks WHERE id = ?').get(stack.id);
      expect(row).toBeNull();
    });

    it('should return false for non-existent ID', () => {
      const result = dal.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('should set notebooks stack_id to NULL (not delete them)', () => {
      const stack = dal.create('With Notebooks');
      const nbId = createNotebook('Child NB', stack.id);

      dal.delete(stack.id);

      const nb = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(nbId) as any;
      expect(nb).not.toBeNull();
      expect(nb.stack_id).toBeNull();
    });

    it('should set stack_id to NULL for multiple notebooks', () => {
      const stack = dal.create('Multi');
      const nb1 = createNotebook('NB1', stack.id);
      const nb2 = createNotebook('NB2', stack.id);

      dal.delete(stack.id);

      const row1 = db.prepare('SELECT stack_id FROM notebooks WHERE id = ?').get(nb1) as any;
      const row2 = db.prepare('SELECT stack_id FROM notebooks WHERE id = ?').get(nb2) as any;
      expect(row1.stack_id).toBeNull();
      expect(row2.stack_id).toBeNull();
    });

    it('should not affect notebooks in other stacks', () => {
      const s1 = dal.create('Stack 1');
      const s2 = dal.create('Stack 2');
      createNotebook('NB in S1', s1.id);
      const nb2 = createNotebook('NB in S2', s2.id);

      dal.delete(s1.id);

      const row = db.prepare('SELECT stack_id FROM notebooks WHERE id = ?').get(nb2) as any;
      expect(row.stack_id).toBe(s2.id);
    });
  });

  describe('autoCleanEmpty', () => {
    it('should delete stacks with zero notebooks', () => {
      const stack = dal.create('Empty');

      const deleted = dal.autoCleanEmpty();
      expect(deleted).toBe(1);

      const row = db.prepare('SELECT * FROM notebook_stacks WHERE id = ?').get(stack.id);
      expect(row).toBeNull();
    });

    it('should not delete stacks that have notebooks', () => {
      const stack = dal.create('Has Notebooks');
      createNotebook('Child', stack.id);

      const deleted = dal.autoCleanEmpty();
      expect(deleted).toBe(0);

      const row = db.prepare('SELECT * FROM notebook_stacks WHERE id = ?').get(stack.id);
      expect(row).not.toBeNull();
    });

    it('should return 0 when no stacks exist', () => {
      const deleted = dal.autoCleanEmpty();
      expect(deleted).toBe(0);
    });

    it('should delete multiple empty stacks at once', () => {
      dal.create('Empty 1');
      dal.create('Empty 2');
      dal.create('Empty 3');

      const deleted = dal.autoCleanEmpty();
      expect(deleted).toBe(3);
    });

    it('should only delete empty stacks, keeping non-empty ones', () => {
      const kept = dal.create('Kept');
      dal.create('Removed 1');
      dal.create('Removed 2');
      createNotebook('Child', kept.id);

      const deleted = dal.autoCleanEmpty();
      expect(deleted).toBe(2);

      const remaining = db.prepare('SELECT COUNT(*) as cnt FROM notebook_stacks').get() as any;
      expect(remaining.cnt).toBe(1);
    });

    it('should clean up after a notebook is moved out of a stack', () => {
      const stack = dal.create('Will Be Empty');
      const nbId = createNotebook('Movable', stack.id);

      // Simulate moving the notebook out of the stack
      db.prepare('UPDATE notebooks SET stack_id = NULL WHERE id = ?').run(nbId);

      const deleted = dal.autoCleanEmpty();
      expect(deleted).toBe(1);
    });

    it('should clean up after a notebook is deleted from a stack', () => {
      const stack = dal.create('Will Be Empty');
      const nbId = createNotebook('Deletable', stack.id);

      // Delete the notebook
      db.prepare('DELETE FROM notebooks WHERE id = ?').run(nbId);

      const deleted = dal.autoCleanEmpty();
      expect(deleted).toBe(1);
    });
  });
});
