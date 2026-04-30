import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { migrateDatabase } from '../../migration/migrate';

// ── Helpers ────────────────────────────────────────────────────────

let tmpDir: string;
let dbPath: string;
let vaultPath: string;

function createTestDb(): Database.Database {
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE notebook_stacks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE notebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stack_id TEXT REFERENCES notebook_stacks(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '{}',
      notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      is_trashed INTEGER NOT NULL DEFAULT 0,
      trashed_at TEXT,
      original_notebook_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE note_tags (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    );

    CREATE TABLE note_images (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      mime_type TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

function seedBasicData(db: Database.Database) {
  // Create a notebook
  db.prepare(
    "INSERT INTO notebooks (id, name, created_at, updated_at) VALUES ('nb1', 'My Notes', '2024-01-01 10:00:00', '2024-01-01 10:00:00')"
  ).run();

  // Create a note with TipTap JSON content
  const tiptapContent = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Hello World' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'This is a test note.' }],
      },
    ],
  });

  db.prepare(
    "INSERT INTO notes (id, title, content, notebook_id, created_at, updated_at) VALUES ('note1', 'Test Note', ?, 'nb1', '2024-01-15 10:30:00', '2024-01-15 14:00:00')"
  ).run(tiptapContent);

  // Create a tag and associate it
  db.prepare(
    "INSERT INTO tags (id, name, created_at) VALUES ('tag1', 'important', '2024-01-01 10:00:00')"
  ).run();
  db.prepare("INSERT INTO note_tags (note_id, tag_id) VALUES ('note1', 'tag1')").run();
}

// ── Setup / Teardown ───────────────────────────────────────────────

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  dbPath = path.join(tmpDir, 'notes.db');
  vaultPath = path.join(tmpDir, 'vault');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ──────────────────────────────────────────────────────────

describe('migrateDatabase', () => {
  it('returns error when database does not exist', () => {
    const result = migrateDatabase('/nonexistent/path.db', vaultPath);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('not found');
    expect(result.notebooks).toBe(0);
    expect(result.notes).toBe(0);
  });

  it('migrates a basic database with one notebook and one note', () => {
    const db = createTestDb();
    seedBasicData(db);
    db.close();

    const result = migrateDatabase(dbPath, vaultPath);

    expect(result.notebooks).toBe(1);
    expect(result.notes).toBe(1);
    expect(result.tags).toBe(1);
    expect(result.errors).toEqual([]);

    // Verify notebook directory was created
    expect(fs.existsSync(path.join(vaultPath, 'My Notes'))).toBe(true);

    // Verify note file was created
    const noteFiles = fs.readdirSync(path.join(vaultPath, 'My Notes')).filter(f => f.endsWith('.md'));
    expect(noteFiles.length).toBe(1);

    // Verify note content
    const noteContent = fs.readFileSync(path.join(vaultPath, 'My Notes', noteFiles[0]), 'utf-8');
    expect(noteContent).toContain('id: note1');
    expect(noteContent).toContain('important');
    expect(noteContent).toContain('# Hello World');
    expect(noteContent).toContain('This is a test note.');
  });

  it('handles notebooks with stacks', () => {
    const db = createTestDb();

    db.prepare(
      "INSERT INTO notebook_stacks (id, name) VALUES ('stack1', 'Work')"
    ).run();
    db.prepare(
      "INSERT INTO notebooks (id, name, stack_id) VALUES ('nb1', 'Project Alpha', 'stack1')"
    ).run();
    db.prepare(
      "INSERT INTO notes (id, title, content, notebook_id) VALUES ('note1', 'Meeting Notes', '{}', 'nb1')"
    ).run();

    db.close();

    const result = migrateDatabase(dbPath, vaultPath);

    expect(result.notebooks).toBe(1);
    // Stack directory should exist with notebook inside
    expect(fs.existsSync(path.join(vaultPath, 'Work', 'Project Alpha'))).toBe(true);
  });

  it('skips trashed notes', () => {
    const db = createTestDb();

    db.prepare(
      "INSERT INTO notebooks (id, name) VALUES ('nb1', 'Notes')"
    ).run();
    db.prepare(
      "INSERT INTO notes (id, title, content, notebook_id, is_trashed) VALUES ('note1', 'Active', '{}', 'nb1', 0)"
    ).run();
    db.prepare(
      "INSERT INTO notes (id, title, content, notebook_id, is_trashed) VALUES ('note2', 'Trashed', '{}', 'nb1', 1)"
    ).run();

    db.close();

    const result = migrateDatabase(dbPath, vaultPath);

    expect(result.notes).toBe(1);
    const noteFiles = fs.readdirSync(path.join(vaultPath, 'Notes')).filter(f => f.endsWith('.md'));
    expect(noteFiles.length).toBe(1);
  });

  it('handles duplicate note titles with numeric suffixes', () => {
    const db = createTestDb();

    db.prepare("INSERT INTO notebooks (id, name) VALUES ('nb1', 'Notes')").run();
    db.prepare(
      "INSERT INTO notes (id, title, content, notebook_id) VALUES ('note1', 'Same Title', '{}', 'nb1')"
    ).run();
    db.prepare(
      "INSERT INTO notes (id, title, content, notebook_id) VALUES ('note2', 'Same Title', '{}', 'nb1')"
    ).run();

    db.close();

    const result = migrateDatabase(dbPath, vaultPath);

    expect(result.notes).toBe(2);
    const noteFiles = fs.readdirSync(path.join(vaultPath, 'Notes')).filter(f => f.endsWith('.md'));
    expect(noteFiles.length).toBe(2);
    expect(noteFiles.sort()).toEqual(['Same Title 2.md', 'Same Title.md']);
  });

  it('migrates images from note_images table', () => {
    const db = createTestDb();

    db.prepare("INSERT INTO notebooks (id, name) VALUES ('nb1', 'Notes')").run();
    db.prepare(
      "INSERT INTO notes (id, title, content, notebook_id) VALUES ('note1', 'With Image', '{}', 'nb1')"
    ).run();

    // Insert a small PNG-like blob
    const fakeImageData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    db.prepare(
      "INSERT INTO note_images (id, note_id, mime_type, data) VALUES ('img1', 'note1', 'image/png', ?)"
    ).run(fakeImageData);

    db.close();

    const result = migrateDatabase(dbPath, vaultPath);

    expect(result.images).toBe(1);

    // Verify image file was saved
    const imagesDir = path.join(vaultPath, 'Notes', '.images');
    expect(fs.existsSync(imagesDir)).toBe(true);
    const imageFiles = fs.readdirSync(imagesDir);
    expect(imageFiles.length).toBe(1);
    expect(imageFiles[0]).toBe('img1.png');

    // Verify image data
    const savedData = fs.readFileSync(path.join(imagesDir, imageFiles[0]));
    expect(savedData).toEqual(fakeImageData);
  });

  it('handles empty database gracefully', () => {
    const db = createTestDb();
    db.close();

    const result = migrateDatabase(dbPath, vaultPath);

    expect(result.notebooks).toBe(0);
    expect(result.notes).toBe(0);
    expect(result.tags).toBe(0);
    expect(result.images).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('initializes vault structure', () => {
    const db = createTestDb();
    db.close();

    migrateDatabase(dbPath, vaultPath);

    // Vault should be initialized with .thoughtstack directory
    expect(fs.existsSync(path.join(vaultPath, '.thoughtstack'))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, '.trash'))).toBe(true);
  });

  it('normalizes SQLite timestamps to ISO 8601', () => {
    const db = createTestDb();

    db.prepare("INSERT INTO notebooks (id, name) VALUES ('nb1', 'Notes')").run();
    db.prepare(
      "INSERT INTO notes (id, title, content, notebook_id, created_at, updated_at) VALUES ('note1', 'Timestamped', '{}', 'nb1', '2024-06-15 09:30:00', '2024-06-15 14:00:00')"
    ).run();

    db.close();

    const result = migrateDatabase(dbPath, vaultPath);
    expect(result.notes).toBe(1);

    const noteFiles = fs.readdirSync(path.join(vaultPath, 'Notes')).filter(f => f.endsWith('.md'));
    const content = fs.readFileSync(path.join(vaultPath, 'Notes', noteFiles[0]), 'utf-8');
    expect(content).toContain('2024-06-15T09:30:00Z');
    expect(content).toContain('2024-06-15T14:00:00Z');
  });
});
