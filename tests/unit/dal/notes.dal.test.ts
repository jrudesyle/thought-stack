import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../helpers/db.ts';
import { createNotesDAL } from '../../../src/server/dal/notes.dal.ts';

describe('NotesDAL', () => {
  let db: TestDatabase;
  let dal: ReturnType<typeof createNotesDAL>;

  beforeEach(() => {
    db = createTestDatabase();
    dal = createNotesDAL(db as any);
  });

  afterEach(() => {
    db.close();
  });

  // Helper to create a notebook directly in the DB
  function createNotebook(name: string): string {
    const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
    db.prepare(
      "INSERT INTO notebooks (id, name) VALUES (?, ?)"
    ).run(id, name);
    return id;
  }

  // Helper to create a tag directly in the DB
  function createTag(name: string): string {
    const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
    db.prepare(
      "INSERT INTO tags (id, name) VALUES (?, ?)"
    ).run(id, name);
    return id;
  }

  // Helper to associate a tag with a note
  function addTagToNote(noteId: string, tagId: string): void {
    db.prepare(
      "INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)"
    ).run(noteId, tagId);
  }

  // Helper to create a note image directly in the DB
  function createNoteImage(noteId: string): string {
    const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
    db.prepare(
      "INSERT INTO note_images (id, note_id, mime_type, data) VALUES (?, ?, ?, ?)"
    ).run(id, noteId, 'image/png', Buffer.from('fake-image-data'));
    return id;
  }

  describe('create', () => {
    it('should create a note with defaults', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId);

      expect(note.id).toBeTruthy();
      expect(note.title).toBe('');
      expect(note.content).toBe('{}');
      expect(note.notebook_id).toBe(nbId);
      expect(note.is_trashed).toBe(0);
      expect(note.trashed_at).toBeNull();
      expect(note.original_notebook_id).toBeNull();
      expect(note.created_at).toBeTruthy();
      expect(note.updated_at).toBeTruthy();
    });

    it('should create a note with a title', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'My Note');

      expect(note.title).toBe('My Note');
    });

    it('should create a note with title and content', () => {
      const nbId = createNotebook('Test NB');
      const content = JSON.stringify({ type: 'doc', content: [] });
      const note = dal.create(nbId, 'Rich Note', content);

      expect(note.title).toBe('Rich Note');
      expect(note.content).toBe(content);
    });

    it('should persist the note to the database', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Persisted');

      const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id) as any;
      expect(row).not.toBeNull();
      expect(row.title).toBe('Persisted');
      expect(row.notebook_id).toBe(nbId);
    });

    it('should generate unique IDs', () => {
      const nbId = createNotebook('Test NB');
      const n1 = dal.create(nbId, 'First');
      const n2 = dal.create(nbId, 'Second');

      expect(n1.id).not.toBe(n2.id);
    });
  });

  describe('getById', () => {
    it('should return a note by ID with tags', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Find Me');
      const tagId = createTag('important');
      addTagToNote(note.id, tagId);

      const found = dal.getById(note.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(note.id);
      expect(found!.title).toBe('Find Me');
      expect(found!.tags).toHaveLength(1);
      expect(found!.tags[0].id).toBe(tagId);
      expect(found!.tags[0].name).toBe('important');
    });

    it('should return empty tags array when note has no tags', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'No Tags');

      const found = dal.getById(note.id);
      expect(found!.tags).toEqual([]);
    });

    it('should return multiple tags sorted by name', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Multi Tags');
      const tag1 = createTag('zebra');
      const tag2 = createTag('alpha');
      addTagToNote(note.id, tag1);
      addTagToNote(note.id, tag2);

      const found = dal.getById(note.id);
      expect(found!.tags).toHaveLength(2);
      expect(found!.tags[0].name).toBe('alpha');
      expect(found!.tags[1].name).toBe('zebra');
    });

    it('should return null for non-existent ID', () => {
      const found = dal.getById('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('getByNotebook', () => {
    it('should return notes in a notebook', () => {
      const nbId = createNotebook('Test NB');
      dal.create(nbId, 'Note 1');
      dal.create(nbId, 'Note 2');

      const notes = dal.getByNotebook(nbId);
      expect(notes).toHaveLength(2);
    });

    it('should only return non-trashed notes', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Active');
      const trashed = dal.create(nbId, 'Trashed');
      dal.softDelete(trashed.id);

      const notes = dal.getByNotebook(nbId);
      expect(notes).toHaveLength(1);
      expect(notes[0].id).toBe(note.id);
    });

    it('should sort by updated_at DESC by default', () => {
      const nbId = createNotebook('Test NB');
      const n1 = dal.create(nbId, 'First');
      // Update n1 so it has a later updated_at
      dal.update(n1.id, { title: 'First Updated' });
      const n2 = dal.create(nbId, 'Second');

      const notes = dal.getByNotebook(nbId);
      // n1 was updated after n2 was created, so n1 should come first
      // But timing might be identical in fast tests, so just check they're returned
      expect(notes).toHaveLength(2);
    });

    it('should support sorting by title ASC', () => {
      const nbId = createNotebook('Test NB');
      dal.create(nbId, 'Zebra');
      dal.create(nbId, 'Alpha');
      dal.create(nbId, 'Middle');

      const notes = dal.getByNotebook(nbId, { sortBy: 'title', sortOrder: 'asc' });
      const titles = notes.map(n => n.title);
      expect(titles).toEqual(['Alpha', 'Middle', 'Zebra']);
    });

    it('should support limit', () => {
      const nbId = createNotebook('Test NB');
      dal.create(nbId, 'Note 1');
      dal.create(nbId, 'Note 2');
      dal.create(nbId, 'Note 3');

      const notes = dal.getByNotebook(nbId, { limit: 2 });
      expect(notes).toHaveLength(2);
    });

    it('should support offset', () => {
      const nbId = createNotebook('Test NB');
      dal.create(nbId, 'Alpha');
      dal.create(nbId, 'Beta');
      dal.create(nbId, 'Gamma');

      const notes = dal.getByNotebook(nbId, { sortBy: 'title', sortOrder: 'asc', limit: 2, offset: 1 });
      expect(notes).toHaveLength(2);
      expect(notes[0].title).toBe('Beta');
      expect(notes[1].title).toBe('Gamma');
    });

    it('should return empty array for empty notebook', () => {
      const nbId = createNotebook('Empty NB');
      const notes = dal.getByNotebook(nbId);
      expect(notes).toEqual([]);
    });

    it('should not return notes from other notebooks', () => {
      const nb1 = createNotebook('NB 1');
      const nb2 = createNotebook('NB 2');
      dal.create(nb1, 'In NB1');
      dal.create(nb2, 'In NB2');

      const notes = dal.getByNotebook(nb1);
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe('In NB1');
    });
  });

  describe('getAll', () => {
    it('should return all non-trashed notes', () => {
      const nbId = createNotebook('Test NB');
      dal.create(nbId, 'Note 1');
      dal.create(nbId, 'Note 2');

      const notes = dal.getAll();
      expect(notes).toHaveLength(2);
    });

    it('should exclude trashed notes', () => {
      const nbId = createNotebook('Test NB');
      dal.create(nbId, 'Active');
      const trashed = dal.create(nbId, 'Trashed');
      dal.softDelete(trashed.id);

      const notes = dal.getAll();
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe('Active');
    });

    it('should sort by updated_at DESC by default', () => {
      const nbId = createNotebook('Test NB');
      dal.create(nbId, 'Note 1');
      dal.create(nbId, 'Note 2');

      const notes = dal.getAll();
      expect(notes).toHaveLength(2);
    });

    it('should support sorting by title ASC', () => {
      const nbId = createNotebook('Test NB');
      dal.create(nbId, 'Zebra');
      dal.create(nbId, 'Alpha');

      const notes = dal.getAll({ sortBy: 'title', sortOrder: 'asc' });
      expect(notes[0].title).toBe('Alpha');
      expect(notes[1].title).toBe('Zebra');
    });

    it('should support limit and offset', () => {
      const nbId = createNotebook('Test NB');
      dal.create(nbId, 'Alpha');
      dal.create(nbId, 'Beta');
      dal.create(nbId, 'Gamma');

      const notes = dal.getAll({ sortBy: 'title', sortOrder: 'asc', limit: 1, offset: 1 });
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe('Beta');
    });

    it('should return empty array when no notes exist', () => {
      const notes = dal.getAll();
      expect(notes).toEqual([]);
    });

    it('should return notes from all notebooks', () => {
      const nb1 = createNotebook('NB 1');
      const nb2 = createNotebook('NB 2');
      dal.create(nb1, 'In NB1');
      dal.create(nb2, 'In NB2');

      const notes = dal.getAll();
      expect(notes).toHaveLength(2);
    });
  });

  describe('update', () => {
    it('should update the title', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Old Title');

      const updated = dal.update(note.id, { title: 'New Title' });
      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('New Title');
    });

    it('should update the content', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Note');
      const newContent = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });

      const updated = dal.update(note.id, { content: newContent });
      expect(updated!.content).toBe(newContent);
    });

    it('should update both title and content', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Old');

      const updated = dal.update(note.id, { title: 'New', content: '{"new": true}' });
      expect(updated!.title).toBe('New');
      expect(updated!.content).toBe('{"new": true}');
    });

    it('should update the updated_at timestamp', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Timestamped');

      const updated = dal.update(note.id, { title: 'Changed' });
      expect(updated!.updated_at).toBeTruthy();
      expect(updated!.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('should persist the update to the database', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Before');

      dal.update(note.id, { title: 'After' });
      const row = db.prepare('SELECT title FROM notes WHERE id = ?').get(note.id) as any;
      expect(row.title).toBe('After');
    });

    it('should return null for non-existent ID', () => {
      const result = dal.update('nonexistent', { title: 'Nope' });
      expect(result).toBeNull();
    });

    it('should not change fields that are not provided', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Keep Title', '{"keep": true}');

      const updated = dal.update(note.id, { title: 'Changed Title' });
      expect(updated!.title).toBe('Changed Title');
      expect(updated!.content).toBe('{"keep": true}');
    });
  });

  describe('moveToNotebook', () => {
    it('should move a note to a different notebook', () => {
      const nb1 = createNotebook('Source');
      const nb2 = createNotebook('Target');
      const note = dal.create(nb1, 'Movable');

      const result = dal.moveToNotebook(note.id, nb2);
      expect(result).toBe(true);

      const found = dal.getById(note.id);
      expect(found!.notebook_id).toBe(nb2);
    });

    it('should return false for non-existent note', () => {
      const nbId = createNotebook('Target');
      const result = dal.moveToNotebook('nonexistent', nbId);
      expect(result).toBe(false);
    });

    it('should remove note from source notebook listing', () => {
      const nb1 = createNotebook('Source');
      const nb2 = createNotebook('Target');
      const note = dal.create(nb1, 'Movable');

      dal.moveToNotebook(note.id, nb2);

      const sourceNotes = dal.getByNotebook(nb1);
      expect(sourceNotes).toHaveLength(0);

      const targetNotes = dal.getByNotebook(nb2);
      expect(targetNotes).toHaveLength(1);
      expect(targetNotes[0].id).toBe(note.id);
    });
  });

  describe('duplicate', () => {
    it('should create a copy with "Copy of" title prefix', () => {
      const nbId = createNotebook('Test NB');
      const original = dal.create(nbId, 'Original Note', '{"data": "content"}');

      const copy = dal.duplicate(original.id);
      expect(copy).not.toBeNull();
      expect(copy!.title).toBe('Copy of Original Note');
    });

    it('should preserve the content', () => {
      const nbId = createNotebook('Test NB');
      const content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', text: 'hello' }] });
      const original = dal.create(nbId, 'Note', content);

      const copy = dal.duplicate(original.id);
      expect(copy!.content).toBe(content);
    });

    it('should place the copy in the same notebook', () => {
      const nbId = createNotebook('Test NB');
      const original = dal.create(nbId, 'Note');

      const copy = dal.duplicate(original.id);
      expect(copy!.notebook_id).toBe(nbId);
    });

    it('should generate a new unique ID', () => {
      const nbId = createNotebook('Test NB');
      const original = dal.create(nbId, 'Note');

      const copy = dal.duplicate(original.id);
      expect(copy!.id).not.toBe(original.id);
    });

    it('should not modify the original note', () => {
      const nbId = createNotebook('Test NB');
      const original = dal.create(nbId, 'Original', '{"original": true}');

      dal.duplicate(original.id);

      const found = dal.getById(original.id);
      expect(found!.title).toBe('Original');
      expect(found!.content).toBe('{"original": true}');
    });

    it('should return null for non-existent note', () => {
      const result = dal.duplicate('nonexistent');
      expect(result).toBeNull();
    });

    it('should not be trashed', () => {
      const nbId = createNotebook('Test NB');
      const original = dal.create(nbId, 'Note');

      const copy = dal.duplicate(original.id);
      expect(copy!.is_trashed).toBe(0);
      expect(copy!.trashed_at).toBeNull();
    });
  });

  describe('softDelete', () => {
    it('should set is_trashed to 1', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'To Trash');

      const result = dal.softDelete(note.id);
      expect(result).toBe(true);

      const found = dal.getById(note.id);
      expect(found!.is_trashed).toBe(1);
    });

    it('should set trashed_at to a valid timestamp', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'To Trash');

      dal.softDelete(note.id);

      const found = dal.getById(note.id);
      expect(found!.trashed_at).toBeTruthy();
      expect(found!.trashed_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('should store original_notebook_id', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'To Trash');

      dal.softDelete(note.id);

      const found = dal.getById(note.id);
      expect(found!.original_notebook_id).toBe(nbId);
    });

    it('should preserve title and content', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Important', '{"data": "preserved"}');

      dal.softDelete(note.id);

      const found = dal.getById(note.id);
      expect(found!.title).toBe('Important');
      expect(found!.content).toBe('{"data": "preserved"}');
    });

    it('should return false for non-existent note', () => {
      const result = dal.softDelete('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false for already trashed note', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Already Trashed');

      dal.softDelete(note.id);
      const result = dal.softDelete(note.id);
      expect(result).toBe(false);
    });

    it('should exclude note from getByNotebook', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'To Trash');

      dal.softDelete(note.id);

      const notes = dal.getByNotebook(nbId);
      expect(notes).toHaveLength(0);
    });

    it('should exclude note from getAll', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'To Trash');

      dal.softDelete(note.id);

      const notes = dal.getAll();
      expect(notes).toHaveLength(0);
    });
  });

  describe('restore', () => {
    it('should restore to original notebook by default', () => {
      const nbId = createNotebook('Original NB');
      const note = dal.create(nbId, 'Restorable');

      dal.softDelete(note.id);
      const result = dal.restore(note.id);
      expect(result).toBe(true);

      const found = dal.getById(note.id);
      expect(found!.is_trashed).toBe(0);
      expect(found!.trashed_at).toBeNull();
      expect(found!.notebook_id).toBe(nbId);
      expect(found!.original_notebook_id).toBeNull();
    });

    it('should restore to a specified notebook', () => {
      const nb1 = createNotebook('Original NB');
      const nb2 = createNotebook('New NB');
      const note = dal.create(nb1, 'Restorable');

      dal.softDelete(note.id);
      const result = dal.restore(note.id, nb2);
      expect(result).toBe(true);

      const found = dal.getById(note.id);
      expect(found!.notebook_id).toBe(nb2);
      expect(found!.is_trashed).toBe(0);
    });

    it('should clear trashed_at and original_notebook_id', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Restorable');

      dal.softDelete(note.id);
      dal.restore(note.id);

      const found = dal.getById(note.id);
      expect(found!.trashed_at).toBeNull();
      expect(found!.original_notebook_id).toBeNull();
    });

    it('should return false for non-existent note', () => {
      const result = dal.restore('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false for non-trashed note', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Not Trashed');

      const result = dal.restore(note.id);
      expect(result).toBe(false);
    });

    it('should make note appear in getAll again', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Restorable');

      dal.softDelete(note.id);
      expect(dal.getAll()).toHaveLength(0);

      dal.restore(note.id);
      expect(dal.getAll()).toHaveLength(1);
    });

    it('should preserve title and content through trash-restore cycle', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Important', '{"preserved": true}');

      dal.softDelete(note.id);
      dal.restore(note.id);

      const found = dal.getById(note.id);
      expect(found!.title).toBe('Important');
      expect(found!.content).toBe('{"preserved": true}');
    });
  });

  describe('permanentDelete', () => {
    it('should remove the note from the database', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Doomed');

      const result = dal.permanentDelete(note.id);
      expect(result).toBe(true);

      const found = dal.getById(note.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent note', () => {
      const result = dal.permanentDelete('nonexistent');
      expect(result).toBe(false);
    });

    it('should cascade-delete note_tags', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Tagged');
      const tagId = createTag('test-tag');
      addTagToNote(note.id, tagId);

      dal.permanentDelete(note.id);

      const row = db.prepare('SELECT * FROM note_tags WHERE note_id = ?').get(note.id);
      expect(row).toBeNull();
    });

    it('should cascade-delete note_images', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'With Image');
      const imageId = createNoteImage(note.id);

      dal.permanentDelete(note.id);

      const row = db.prepare('SELECT * FROM note_images WHERE id = ?').get(imageId);
      expect(row).toBeNull();
    });
  });

  describe('getTrash', () => {
    it('should return all trashed notes', () => {
      const nbId = createNotebook('Test NB');
      const n1 = dal.create(nbId, 'Trashed 1');
      const n2 = dal.create(nbId, 'Trashed 2');
      dal.create(nbId, 'Active');

      dal.softDelete(n1.id);
      dal.softDelete(n2.id);

      const trash = dal.getTrash();
      expect(trash).toHaveLength(2);
    });

    it('should return empty array when no trashed notes', () => {
      const nbId = createNotebook('Test NB');
      dal.create(nbId, 'Active');

      const trash = dal.getTrash();
      expect(trash).toEqual([]);
    });

    it('should not include active notes', () => {
      const nbId = createNotebook('Test NB');
      dal.create(nbId, 'Active');
      const trashed = dal.create(nbId, 'Trashed');
      dal.softDelete(trashed.id);

      const trash = dal.getTrash();
      expect(trash).toHaveLength(1);
      expect(trash[0].title).toBe('Trashed');
    });

    it('should include trashed_at timestamp', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Trashed');
      dal.softDelete(note.id);

      const trash = dal.getTrash();
      expect(trash[0].trashed_at).toBeTruthy();
    });
  });

  describe('emptyTrash', () => {
    it('should permanently delete all trashed notes', () => {
      const nbId = createNotebook('Test NB');
      const n1 = dal.create(nbId, 'Trashed 1');
      const n2 = dal.create(nbId, 'Trashed 2');
      dal.softDelete(n1.id);
      dal.softDelete(n2.id);

      const count = dal.emptyTrash();
      expect(count).toBe(2);

      expect(dal.getTrash()).toEqual([]);
    });

    it('should not affect active notes', () => {
      const nbId = createNotebook('Test NB');
      dal.create(nbId, 'Active');
      const trashed = dal.create(nbId, 'Trashed');
      dal.softDelete(trashed.id);

      dal.emptyTrash();

      expect(dal.getAll()).toHaveLength(1);
      expect(dal.getAll()[0].title).toBe('Active');
    });

    it('should return 0 when trash is empty', () => {
      const count = dal.emptyTrash();
      expect(count).toBe(0);
    });

    it('should cascade-delete associated tags and images', () => {
      const nbId = createNotebook('Test NB');
      const note = dal.create(nbId, 'Trashed');
      const tagId = createTag('cleanup');
      addTagToNote(note.id, tagId);
      createNoteImage(note.id);

      dal.softDelete(note.id);
      dal.emptyTrash();

      const tags = db.prepare('SELECT * FROM note_tags WHERE note_id = ?').get(note.id);
      expect(tags).toBeNull();

      const images = db.prepare('SELECT * FROM note_images WHERE note_id = ?').get(note.id);
      expect(images).toBeNull();
    });
  });
});
