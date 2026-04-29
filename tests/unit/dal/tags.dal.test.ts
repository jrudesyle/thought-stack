import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../helpers/db.ts';
import { createTagsDAL } from '../../../src/server/dal/tags.dal.ts';

describe('TagsDAL', () => {
  let db: TestDatabase;
  let dal: ReturnType<typeof createTagsDAL>;

  beforeEach(() => {
    db = createTestDatabase();
    dal = createTagsDAL(db as any);
  });

  afterEach(() => {
    db.close();
  });

  // Helper to create a notebook directly in the DB
  function createNotebook(name = 'Test Notebook'): string {
    const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
    db.prepare(
      "INSERT INTO notebooks (id, name) VALUES (?, ?)"
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

  // Helper to create a trashed note
  function createTrashedNote(notebookId: string, title = 'Trashed Note'): string {
    const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
    db.prepare(
      "INSERT INTO notes (id, title, notebook_id, is_trashed, trashed_at) VALUES (?, ?, ?, 1, datetime('now'))"
    ).run(id, title, notebookId);
    return id;
  }

  describe('create', () => {
    it('should create a tag with a valid name', () => {
      const tag = dal.create('javascript');

      expect(tag.id).toBeTruthy();
      expect(tag.name).toBe('javascript');
      expect(tag.created_at).toBeTruthy();
    });

    it('should persist the tag to the database', () => {
      const tag = dal.create('persisted');
      const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(tag.id) as any;

      expect(row).not.toBeNull();
      expect(row.name).toBe('persisted');
    });

    it('should generate unique IDs', () => {
      const t1 = dal.create('tag1');
      const t2 = dal.create('tag2');

      expect(t1.id).not.toBe(t2.id);
    });

    it('should trim whitespace from the name', () => {
      const tag = dal.create('  trimmed  ');
      expect(tag.name).toBe('trimmed');
    });

    it('should throw on empty name', () => {
      expect(() => dal.create('')).toThrow('Tag name cannot be empty');
    });

    it('should throw on whitespace-only name', () => {
      expect(() => dal.create('   ')).toThrow('Tag name cannot be empty');
    });

    it('should reject duplicate name (case-insensitive)', () => {
      dal.create('JavaScript');
      expect(() => dal.create('javascript')).toThrow(/already exists/);
    });

    it('should reject duplicate name (exact match)', () => {
      dal.create('react');
      expect(() => dal.create('react')).toThrow(/already exists/);
    });
  });

  describe('getAll', () => {
    it('should return empty array when no tags exist', () => {
      const result = dal.getAll();
      expect(result).toEqual([]);
    });

    it('should return all tags with note counts', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId);

      dal.addToNote(noteId, 'tag1');
      dal.addToNote(noteId, 'tag2');

      const result = dal.getAll();
      expect(result).toHaveLength(2);
      expect(result.every(t => t.note_count === 1)).toBe(true);
    });

    it('should count only non-trashed notes', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId);
      const trashedId = createTrashedNote(nbId);

      dal.addToNote(noteId, 'important');
      dal.addToNote(trashedId, 'important');

      const result = dal.getAll();
      const tag = result.find(t => t.name === 'important');
      expect(tag!.note_count).toBe(1);
    });

    it('should return 0 note count for tags with no associated notes', () => {
      dal.create('orphan');

      const result = dal.getAll();
      expect(result[0].note_count).toBe(0);
    });

    it('should order tags by name', () => {
      dal.create('zebra');
      dal.create('alpha');
      dal.create('middle');

      const result = dal.getAll();
      const names = result.map(t => t.name);
      expect(names).toEqual(['alpha', 'middle', 'zebra']);
    });
  });

  describe('getById', () => {
    it('should return a tag by ID', () => {
      const created = dal.create('findme');
      const found = dal.getById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('findme');
    });

    it('should return null for non-existent ID', () => {
      const found = dal.getById('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('rename', () => {
    it('should rename a tag', () => {
      const tag = dal.create('oldname');
      const updated = dal.rename(tag.id, 'newname');

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('newname');
      expect(updated!.id).toBe(tag.id);
    });

    it('should persist the rename to the database', () => {
      const tag = dal.create('before');
      dal.rename(tag.id, 'after');

      const row = db.prepare('SELECT name FROM tags WHERE id = ?').get(tag.id) as any;
      expect(row.name).toBe('after');
    });

    it('should preserve created_at', () => {
      const tag = dal.create('original');
      const updated = dal.rename(tag.id, 'renamed');

      expect(updated!.created_at).toBe(tag.created_at);
    });

    it('should return null for non-existent ID', () => {
      const result = dal.rename('nonexistent', 'newname');
      expect(result).toBeNull();
    });

    it('should throw on empty new name', () => {
      const tag = dal.create('valid');
      expect(() => dal.rename(tag.id, '')).toThrow('Tag name cannot be empty');
    });

    it('should reject duplicate name on rename (case-insensitive)', () => {
      dal.create('taken');
      const tag = dal.create('available');

      expect(() => dal.rename(tag.id, 'Taken')).toThrow(/already exists/);
    });

    it('should allow renaming to the same name (no-op)', () => {
      const tag = dal.create('same');
      const updated = dal.rename(tag.id, 'same');
      expect(updated!.name).toBe('same');
    });

    it('should propagate rename to all note associations', () => {
      const nbId = createNotebook();
      const note1 = createNote(nbId, 'Note 1');
      const note2 = createNote(nbId, 'Note 2');

      const tag = dal.addToNote(note1, 'original');
      dal.addToNote(note2, 'original');

      dal.rename(tag.id, 'renamed');

      // Both notes should now see the renamed tag
      const tags1 = dal.getByNote(note1);
      const tags2 = dal.getByNote(note2);

      expect(tags1[0].name).toBe('renamed');
      expect(tags2[0].name).toBe('renamed');
    });
  });

  describe('delete', () => {
    it('should delete an existing tag', () => {
      const tag = dal.create('doomed');
      const result = dal.delete(tag.id);

      expect(result).toBe(true);
      expect(dal.getById(tag.id)).toBeNull();
    });

    it('should return false for non-existent ID', () => {
      const result = dal.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('should cascade-delete note_tags associations', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId);
      const tag = dal.addToNote(noteId, 'cascade');

      dal.delete(tag.id);

      const assoc = db.prepare(
        'SELECT * FROM note_tags WHERE tag_id = ?'
      ).get(tag.id);
      expect(assoc).toBeNull();
    });
  });

  describe('addToNote', () => {
    it('should create a new tag and associate it with the note', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId);

      const tag = dal.addToNote(noteId, 'newtag');

      expect(tag.id).toBeTruthy();
      expect(tag.name).toBe('newtag');

      // Verify association exists
      const assoc = db.prepare(
        'SELECT * FROM note_tags WHERE note_id = ? AND tag_id = ?'
      ).get(noteId, tag.id);
      expect(assoc).not.toBeNull();
    });

    it('should reuse an existing tag', () => {
      const nbId = createNotebook();
      const note1 = createNote(nbId, 'Note 1');
      const note2 = createNote(nbId, 'Note 2');

      const tag1 = dal.addToNote(note1, 'shared');
      const tag2 = dal.addToNote(note2, 'shared');

      expect(tag1.id).toBe(tag2.id);
    });

    it('should match existing tags case-insensitively', () => {
      const nbId = createNotebook();
      const note1 = createNote(nbId, 'Note 1');
      const note2 = createNote(nbId, 'Note 2');

      const tag1 = dal.addToNote(note1, 'JavaScript');
      const tag2 = dal.addToNote(note2, 'javascript');

      expect(tag1.id).toBe(tag2.id);
    });

    it('should not create duplicate association', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId);

      dal.addToNote(noteId, 'once');
      dal.addToNote(noteId, 'once'); // second call should be idempotent

      const count = db.prepare(
        'SELECT COUNT(*) AS cnt FROM note_tags WHERE note_id = ?'
      ).get(noteId) as { cnt: number };
      expect(count.cnt).toBe(1);
    });

    it('should throw on empty tag name', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId);

      expect(() => dal.addToNote(noteId, '')).toThrow('Tag name cannot be empty');
    });

    it('should trim whitespace from tag name', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId);

      const tag = dal.addToNote(noteId, '  trimmed  ');
      expect(tag.name).toBe('trimmed');
    });
  });

  describe('removeFromNote', () => {
    it('should remove the association between a note and a tag', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId);
      const tag = dal.addToNote(noteId, 'removable');

      const result = dal.removeFromNote(noteId, tag.id);

      expect(result).toBe(true);

      const assoc = db.prepare(
        'SELECT * FROM note_tags WHERE note_id = ? AND tag_id = ?'
      ).get(noteId, tag.id);
      expect(assoc).toBeNull();
    });

    it('should return false if the association does not exist', () => {
      const result = dal.removeFromNote('nonexistent', 'nonexistent');
      expect(result).toBe(false);
    });

    it('should auto-delete orphan tag when no other notes use it', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId);
      const tag = dal.addToNote(noteId, 'orphan');

      dal.removeFromNote(noteId, tag.id);

      // Tag should be deleted
      expect(dal.getById(tag.id)).toBeNull();
    });

    it('should keep tag when other notes still use it', () => {
      const nbId = createNotebook();
      const note1 = createNote(nbId, 'Note 1');
      const note2 = createNote(nbId, 'Note 2');

      const tag = dal.addToNote(note1, 'shared');
      dal.addToNote(note2, 'shared');

      dal.removeFromNote(note1, tag.id);

      // Tag should still exist
      expect(dal.getById(tag.id)).not.toBeNull();

      // But note1 should no longer have the tag
      const tags1 = dal.getByNote(note1);
      expect(tags1).toHaveLength(0);

      // note2 should still have the tag
      const tags2 = dal.getByNote(note2);
      expect(tags2).toHaveLength(1);
    });

    it('should handle removing from a note with multiple tags', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId);

      const tag1 = dal.addToNote(noteId, 'keep');
      const tag2 = dal.addToNote(noteId, 'remove');

      dal.removeFromNote(noteId, tag2.id);

      const tags = dal.getByNote(noteId);
      expect(tags).toHaveLength(1);
      expect(tags[0].id).toBe(tag1.id);
    });
  });

  describe('getByNote', () => {
    it('should return tags for a note', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId);

      dal.addToNote(noteId, 'tag1');
      dal.addToNote(noteId, 'tag2');

      const tags = dal.getByNote(noteId);
      expect(tags).toHaveLength(2);
    });

    it('should return empty array for a note with no tags', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId);

      const tags = dal.getByNote(noteId);
      expect(tags).toEqual([]);
    });

    it('should order tags by name', () => {
      const nbId = createNotebook();
      const noteId = createNote(nbId);

      dal.addToNote(noteId, 'zebra');
      dal.addToNote(noteId, 'alpha');
      dal.addToNote(noteId, 'middle');

      const tags = dal.getByNote(noteId);
      const names = tags.map(t => t.name);
      expect(names).toEqual(['alpha', 'middle', 'zebra']);
    });

    it('should not return tags from other notes', () => {
      const nbId = createNotebook();
      const note1 = createNote(nbId, 'Note 1');
      const note2 = createNote(nbId, 'Note 2');

      dal.addToNote(note1, 'only-note1');
      dal.addToNote(note2, 'only-note2');

      const tags1 = dal.getByNote(note1);
      expect(tags1).toHaveLength(1);
      expect(tags1[0].name).toBe('only-note1');
    });
  });

  describe('autocomplete', () => {
    it('should return tags matching the prefix', () => {
      dal.create('javascript');
      dal.create('java');
      dal.create('python');

      const results = dal.autocomplete('jav');
      expect(results).toHaveLength(2);
      const names = results.map(t => t.name);
      expect(names).toContain('java');
      expect(names).toContain('javascript');
    });

    it('should be case-insensitive', () => {
      dal.create('JavaScript');

      const results = dal.autocomplete('java');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('JavaScript');
    });

    it('should return empty array for no matches', () => {
      dal.create('python');

      const results = dal.autocomplete('java');
      expect(results).toEqual([]);
    });

    it('should return empty array for empty prefix', () => {
      dal.create('something');

      const results = dal.autocomplete('');
      expect(results).toEqual([]);
    });

    it('should return empty array for whitespace-only prefix', () => {
      dal.create('something');

      const results = dal.autocomplete('   ');
      expect(results).toEqual([]);
    });

    it('should order results by name', () => {
      dal.create('react-router');
      dal.create('react');
      dal.create('react-dom');

      const results = dal.autocomplete('react');
      const names = results.map(t => t.name);
      expect(names).toEqual(['react', 'react-dom', 'react-router']);
    });

    it('should handle special LIKE characters in prefix', () => {
      dal.create('100% done');
      dal.create('100 items');

      const results = dal.autocomplete('100%');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('100% done');
    });

    it('should handle underscore in prefix', () => {
      dal.create('_private');
      dal.create('aprivate');

      const results = dal.autocomplete('_p');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('_private');
    });

    it('should return all tags matching a single character prefix', () => {
      dal.create('alpha');
      dal.create('beta');
      dal.create('angular');

      const results = dal.autocomplete('a');
      expect(results).toHaveLength(2);
    });
  });
});
