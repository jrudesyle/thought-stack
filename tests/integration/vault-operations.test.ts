import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initializeVault } from '../../electron/vault/index';
import { createNote, getNote, saveNote, listNotes, deleteNote } from '../../electron/vault/notes';
import { createNotebook, listNotebooks, renameNotebook, deleteNotebook } from '../../electron/vault/notebooks';
import { softDelete, restore, permanentDelete, emptyTrash, listTrash } from '../../electron/vault/trash';
import { serializeNote } from '../../electron/vault/markdown';
import {
  initSearchIndex,
  rebuildIndexFull,
  searchNotes,
} from '../../electron/index/index';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTempVault(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-integration-'));
  initializeVault(tmp);
  return tmp;
}

// ─── Note CRUD ───────────────────────────────────────────────────────────────

describe('Note CRUD operations', () => {
  let vault: string;

  beforeEach(() => {
    vault = createTempVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('creates a note and reads it back with matching data', () => {
    createNotebook(vault, 'Work');
    const created = createNote(vault, 'Work', 'My First Note');

    expect(created.title).toBe('My First Note');
    expect(created.notebook).toBe('Work');
    expect(created.tags).toEqual([]);
    expect(created.id).toBeTruthy();

    const read = getNote(vault, created.path);
    expect(read.id).toBe(created.id);
    expect(read.title).toBe('My First Note');
    expect(read.notebook).toBe('Work');
  });

  it('updates a note title and content', () => {
    createNotebook(vault, 'Work');
    const created = createNote(vault, 'Work', 'Original Title');

    const updated = saveNote(vault, created.path, 'Updated Title', 'New content here', ['tag1']);

    expect(updated.title).toBe('Updated Title');
    expect(updated.content).toBe('New content here');
    expect(updated.tags).toEqual(['tag1']);

    // Read back to verify persistence
    const read = getNote(vault, updated.path);
    expect(read.title).toBe('Updated Title');
    expect(read.content.trim()).toBe('New content here');
    expect(read.tags).toEqual(['tag1']);
  });

  it('lists notes sorted by modified descending', () => {
    createNotebook(vault, 'Work');
    const note1 = createNote(vault, 'Work', 'First');
    // Save note1 again to update its modified timestamp
    saveNote(vault, note1.path, 'First', 'updated content', []);

    const note2 = createNote(vault, 'Work', 'Second');

    const notes = listNotes(vault, { notebook: 'Work' });
    expect(notes.length).toBe(2);
    // note2 was created after note1's save, so it should be first
    // (or note1 if its save was later — either way, sorted by modified desc)
    const modifiedDates = notes.map((n) => n.modified);
    expect(modifiedDates[0] >= modifiedDates[1]).toBe(true);
  });

  it('deletes a note (soft delete)', () => {
    createNotebook(vault, 'Work');
    const created = createNote(vault, 'Work', 'To Delete');

    const result = deleteNote(vault, created.path);
    expect(result).toBe(true);

    // Note should no longer appear in normal listing
    const notes = listNotes(vault, { notebook: 'Work' });
    expect(notes.length).toBe(0);
  });
});

// ─── Notebook operations ─────────────────────────────────────────────────────

describe('Notebook operations', () => {
  let vault: string;

  beforeEach(() => {
    vault = createTempVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('creates and lists notebooks', () => {
    createNotebook(vault, 'Work');
    createNotebook(vault, 'Personal');

    const notebooks = listNotebooks(vault);
    const names = notebooks.map((n) => n.name);
    expect(names).toContain('Work');
    expect(names).toContain('Personal');
  });

  it('renames a notebook', () => {
    createNotebook(vault, 'OldName');
    const renamed = renameNotebook(vault, 'OldName', 'NewName');

    expect(renamed.name).toBe('NewName');

    const notebooks = listNotebooks(vault);
    const names = notebooks.map((n) => n.name);
    expect(names).toContain('NewName');
    expect(names).not.toContain('OldName');
  });

  it('deletes a notebook and moves notes to trash', () => {
    createNotebook(vault, 'ToDelete');
    createNote(vault, 'ToDelete', 'Note In Deleted NB');

    const result = deleteNotebook(vault, 'ToDelete');
    expect(result).toBe(true);

    // Notebook directory should be gone
    const notebooks = listNotebooks(vault);
    expect(notebooks.map((n) => n.name)).not.toContain('ToDelete');

    // Note should be in trash
    const trashed = listTrash(vault);
    expect(trashed.length).toBe(1);
  });
});

// ─── Trash operations ────────────────────────────────────────────────────────

describe('Trash operations', () => {
  let vault: string;

  beforeEach(() => {
    vault = createTempVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('soft deletes a note and lists it in trash', () => {
    createNotebook(vault, 'Work');
    const note = createNote(vault, 'Work', 'Trashable');

    softDelete(vault, note.path);

    const trashed = listTrash(vault);
    expect(trashed.length).toBe(1);
    expect(trashed[0].id).toBe(note.id);
  });

  it('restores a trashed note to its original location', () => {
    createNotebook(vault, 'Work');
    const note = createNote(vault, 'Work', 'Restorable');
    const originalPath = note.path;

    softDelete(vault, note.path);

    // Find the trashed filename
    const trashed = listTrash(vault);
    const trashFilename = path.basename(trashed[0].path);

    const restored = restore(vault, trashFilename);
    expect(restored.id).toBe(note.id);
    expect(restored.path).toBe(originalPath);

    // Should be back in normal listing
    const notes = listNotes(vault, { notebook: 'Work' });
    expect(notes.length).toBe(1);
    expect(notes[0].id).toBe(note.id);
  });

  it('permanently deletes a trashed note', () => {
    createNotebook(vault, 'Work');
    const note = createNote(vault, 'Work', 'Permanent');

    softDelete(vault, note.path);

    const trashed = listTrash(vault);
    const trashFilename = path.basename(trashed[0].path);

    const result = permanentDelete(vault, trashFilename);
    expect(result).toBe(true);

    // Trash should be empty
    const remaining = listTrash(vault);
    expect(remaining.length).toBe(0);
  });

  it('empties the trash', () => {
    createNotebook(vault, 'Work');
    createNote(vault, 'Work', 'Trash1').path;
    createNote(vault, 'Work', 'Trash2').path;

    // Soft delete both
    const notes = listNotes(vault, { notebook: 'Work' });
    for (const n of notes) {
      softDelete(vault, n.path);
    }

    const count = emptyTrash(vault);
    expect(count).toBe(2);

    const remaining = listTrash(vault);
    expect(remaining.length).toBe(0);
  });
});

// ─── Search index accuracy ───────────────────────────────────────────────────

describe('Search index accuracy', () => {
  let vault: string;

  beforeEach(() => {
    vault = createTempVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('indexes notes and returns search results for matching terms', () => {
    createNotebook(vault, 'Work');
    createNote(vault, 'Work', 'Architecture Design');
    // Save with specific content for searching
    const notes = listNotes(vault, { notebook: 'Work' });
    saveNote(vault, notes[0].path, 'Architecture Design', 'Microservices pattern with event-driven communication', ['design']);

    const db = initSearchIndex(vault);
    rebuildIndexFull(db, vault);

    const results = searchNotes(db, 'microservices');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Architecture Design');

    db.close();
  });

  it('does not return trashed notes in search results', () => {
    createNotebook(vault, 'Work');
    const note = createNote(vault, 'Work', 'Searchable');
    saveNote(vault, note.path, 'Searchable', 'unique-search-term-xyz', []);

    // Index before trashing
    const db = initSearchIndex(vault);
    rebuildIndexFull(db, vault);

    let results = searchNotes(db, 'unique-search-term-xyz');
    expect(results.length).toBe(1);

    // Trash the note and rebuild
    softDelete(vault, note.path);
    rebuildIndexFull(db, vault);

    results = searchNotes(db, 'unique-search-term-xyz');
    expect(results.length).toBe(0);

    db.close();
  });

  it('searches across title, body, and tags', () => {
    createNotebook(vault, 'Work');
    const note = createNote(vault, 'Work', 'Plain Note');
    saveNote(vault, note.path, 'Plain Note', 'Nothing special', ['kubernetes']);

    const db = initSearchIndex(vault);
    rebuildIndexFull(db, vault);

    // Search by tag
    const tagResults = searchNotes(db, 'kubernetes');
    expect(tagResults.length).toBe(1);

    // Search by title
    const titleResults = searchNotes(db, 'Plain');
    expect(titleResults.length).toBe(1);

    // Search by body
    const bodyResults = searchNotes(db, 'special');
    expect(bodyResults.length).toBe(1);

    db.close();
  });
});
