import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { serializeNote } from '../../vault/markdown';
import {
  initSearchIndex,
  rebuildIndexIncremental,
  updateNoteIndex,
  searchNotes,
  rebuildIndexFull,
  ensureSearchIndex,
} from '../../index/index';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Creates a temporary vault directory with `.thoughtstack/` metadata dir. */
function createTempVault(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'search-test-'));
  fs.mkdirSync(path.join(tmp, '.thoughtstack'), { recursive: true });
  return tmp;
}

/** Writes a Markdown note file into the vault. */
function writeNote(
  vaultRoot: string,
  notebook: string,
  filename: string,
  opts: {
    id: string;
    tags?: string[];
    created?: string;
    modified?: string;
    content?: string;
  }
): string {
  const notebookDir = path.join(vaultRoot, notebook);
  fs.mkdirSync(notebookDir, { recursive: true });

  const md = serializeNote({
    id: opts.id,
    title: filename.replace(/\.md$/, ''),
    tags: opts.tags ?? [],
    created: opts.created ?? '2026-01-01T00:00:00Z',
    modified: opts.modified ?? '2026-01-01T00:00:00Z',
    content: opts.content ?? '',
  });

  const filePath = path.join(notebookDir, filename);
  fs.writeFileSync(filePath, md, 'utf-8');
  return path.join(notebook, filename); // relative path
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Search Index', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = createTempVault();
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  // ── 3.1 / 3.7: Index initialisation creates tables ──────────────────────

  describe('initSearchIndex', () => {
    it('creates notes_index and notes_fts tables', () => {
      const db = initSearchIndex(vaultPath);

      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name`
        )
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('notes_index');
      expect(tableNames).toContain('notes_fts');

      db.close();
    });

    it('creates FTS sync triggers', () => {
      const db = initSearchIndex(vaultPath);

      const triggers = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`)
        .all() as { name: string }[];

      const triggerNames = triggers.map((t) => t.name);
      expect(triggerNames).toContain('notes_index_ai');
      expect(triggerNames).toContain('notes_index_ad');
      expect(triggerNames).toContain('notes_index_au');

      db.close();
    });

    it('is idempotent – calling twice does not throw', () => {
      const db1 = initSearchIndex(vaultPath);
      db1.close();

      const db2 = initSearchIndex(vaultPath);
      const tables = db2
        .prepare(
          `SELECT name FROM sqlite_master WHERE type IN ('table') AND name = 'notes_index'`
        )
        .all();
      expect(tables).toHaveLength(1);
      db2.close();
    });

    it('handles corrupt cache.db by recreating it', () => {
      // Write garbage to the cache.db path
      const dbPath = path.join(vaultPath, '.thoughtstack', 'cache.db');
      fs.writeFileSync(dbPath, 'this is not a valid sqlite database');

      const db = initSearchIndex(vaultPath);
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type IN ('table') AND name = 'notes_index'`
        )
        .all();
      expect(tables).toHaveLength(1);
      db.close();
    });
  });

  // ── 3.3 / 3.7: Single note indexing and retrieval ────────────────────────

  describe('updateNoteIndex', () => {
    it('indexes a single note and stores it in notes_index', () => {
      const db = initSearchIndex(vaultPath);
      const relPath = writeNote(vaultPath, 'Work', 'Meeting.md', {
        id: 'aaa111',
        tags: ['meeting', 'work'],
        content: 'Discussed project roadmap and milestones.',
      });

      updateNoteIndex(db, vaultPath, relPath);

      const row = db
        .prepare(`SELECT * FROM notes_index WHERE id = ?`)
        .get('aaa111') as Record<string, unknown>;

      expect(row).toBeDefined();
      expect(row.title).toBe('Meeting');
      expect(row.notebook).toBe('Work');
      expect(row.tags).toBe('meeting,work');
      expect(row.path).toBe(relPath);

      db.close();
    });

    it('upserts when called twice for the same note', () => {
      const db = initSearchIndex(vaultPath);
      const relPath = writeNote(vaultPath, 'Work', 'Meeting.md', {
        id: 'aaa111',
        content: 'Version 1',
        modified: '2026-01-01T00:00:00Z',
      });

      updateNoteIndex(db, vaultPath, relPath);

      // Overwrite the file with updated content
      writeNote(vaultPath, 'Work', 'Meeting.md', {
        id: 'aaa111',
        content: 'Version 2 updated',
        modified: '2026-02-01T00:00:00Z',
      });

      updateNoteIndex(db, vaultPath, relPath);

      const rows = db
        .prepare(`SELECT * FROM notes_index WHERE id = ?`)
        .all('aaa111');
      expect(rows).toHaveLength(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row.body_text).toContain('Version 2 updated');

      db.close();
    });
  });

  // ── 3.4 / 3.7: Full-text search ─────────────────────────────────────────

  describe('searchNotes', () => {
    it('returns matching notes for a simple query', () => {
      const db = initSearchIndex(vaultPath);

      writeNote(vaultPath, 'Work', 'Roadmap.md', {
        id: 'note1',
        content: 'The product roadmap includes several milestones for Q3.',
      });
      writeNote(vaultPath, 'Personal', 'Groceries.md', {
        id: 'note2',
        content: 'Buy milk, eggs, and bread from the store.',
      });

      rebuildIndexFull(db, vaultPath);

      const results = searchNotes(db, 'roadmap');
      expect(results).toHaveLength(1);
      expect(results[0].noteId).toBe('note1');
      expect(results[0].title).toBe('Roadmap');
      expect(results[0].notebook).toBe('Work');

      db.close();
    });

    it('returns empty array for empty query', () => {
      const db = initSearchIndex(vaultPath);
      const results = searchNotes(db, '');
      expect(results).toEqual([]);
      db.close();
    });

    it('returns results with snippets', () => {
      const db = initSearchIndex(vaultPath);

      writeNote(vaultPath, 'Work', 'Design.md', {
        id: 'note1',
        content:
          'The architecture design uses a microservices pattern with event-driven communication between services.',
      });

      rebuildIndexFull(db, vaultPath);

      const results = searchNotes(db, 'microservices');
      expect(results).toHaveLength(1);
      expect(results[0].snippet).toContain('microservices');

      db.close();
    });

    it('searches across title, body, and tags', () => {
      const db = initSearchIndex(vaultPath);

      writeNote(vaultPath, 'Work', 'Plain.md', {
        id: 'note1',
        tags: ['kubernetes'],
        content: 'Nothing special here.',
      });

      rebuildIndexFull(db, vaultPath);

      // Search by tag content
      const results = searchNotes(db, 'kubernetes');
      expect(results).toHaveLength(1);
      expect(results[0].noteId).toBe('note1');

      db.close();
    });

    it('filters by notebook', () => {
      const db = initSearchIndex(vaultPath);

      writeNote(vaultPath, 'Work', 'Alpha.md', {
        id: 'note1',
        content: 'Important project details.',
      });
      writeNote(vaultPath, 'Personal', 'Alpha.md', {
        id: 'note2',
        content: 'Important personal details.',
      });

      rebuildIndexFull(db, vaultPath);

      const results = searchNotes(db, 'important', { notebook: 'Work' });
      expect(results).toHaveLength(1);
      expect(results[0].noteId).toBe('note1');

      db.close();
    });

    it('filters by tag', () => {
      const db = initSearchIndex(vaultPath);

      writeNote(vaultPath, 'Work', 'Tagged.md', {
        id: 'note1',
        tags: ['urgent', 'review'],
        content: 'This needs attention.',
      });
      writeNote(vaultPath, 'Work', 'Untagged.md', {
        id: 'note2',
        tags: [],
        content: 'This also needs attention.',
      });

      rebuildIndexFull(db, vaultPath);

      const results = searchNotes(db, 'attention', { tag: 'urgent' });
      expect(results).toHaveLength(1);
      expect(results[0].noteId).toBe('note1');

      db.close();
    });

    it('returns tags as an array', () => {
      const db = initSearchIndex(vaultPath);

      writeNote(vaultPath, 'Work', 'Multi.md', {
        id: 'note1',
        tags: ['alpha', 'beta', 'gamma'],
        content: 'Content with multiple tags.',
      });

      rebuildIndexFull(db, vaultPath);

      const results = searchNotes(db, 'multiple');
      expect(results).toHaveLength(1);
      expect(results[0].tags).toEqual(['alpha', 'beta', 'gamma']);

      db.close();
    });
  });

  // ── 3.2 / 3.7: Incremental rebuild ──────────────────────────────────────

  describe('rebuildIndexIncremental', () => {
    it('indexes all notes on first run', () => {
      const db = initSearchIndex(vaultPath);

      writeNote(vaultPath, 'Work', 'Note1.md', { id: 'n1' });
      writeNote(vaultPath, 'Work', 'Note2.md', { id: 'n2' });
      writeNote(vaultPath, 'Personal', 'Note3.md', { id: 'n3' });

      const count = rebuildIndexIncremental(db, vaultPath);
      expect(count).toBe(3);

      const rows = db.prepare(`SELECT * FROM notes_index`).all();
      expect(rows).toHaveLength(3);

      db.close();
    });

    it('detects modified notes and updates them', () => {
      const db = initSearchIndex(vaultPath);

      writeNote(vaultPath, 'Work', 'Note1.md', {
        id: 'n1',
        modified: '2026-01-01T00:00:00Z',
        content: 'Original content',
      });

      rebuildIndexIncremental(db, vaultPath);

      // Update the note with a new modified timestamp
      writeNote(vaultPath, 'Work', 'Note1.md', {
        id: 'n1',
        modified: '2026-02-01T00:00:00Z',
        content: 'Updated content',
      });

      const count = rebuildIndexIncremental(db, vaultPath);
      expect(count).toBe(1);

      const row = db
        .prepare(`SELECT body_text FROM notes_index WHERE id = ?`)
        .get('n1') as { body_text: string };
      expect(row.body_text).toContain('Updated content');

      db.close();
    });

    it('skips unchanged notes', () => {
      const db = initSearchIndex(vaultPath);

      writeNote(vaultPath, 'Work', 'Note1.md', {
        id: 'n1',
        modified: '2026-01-01T00:00:00Z',
      });

      rebuildIndexIncremental(db, vaultPath);

      // Run again without changes
      const count = rebuildIndexIncremental(db, vaultPath);
      expect(count).toBe(0);

      db.close();
    });

    it('removes index entries for deleted files', () => {
      const db = initSearchIndex(vaultPath);

      const relPath = writeNote(vaultPath, 'Work', 'ToDelete.md', {
        id: 'del1',
      });

      rebuildIndexIncremental(db, vaultPath);
      expect(
        db.prepare(`SELECT * FROM notes_index WHERE id = ?`).get('del1')
      ).toBeDefined();

      // Delete the file from disk
      fs.unlinkSync(path.join(vaultPath, relPath));

      rebuildIndexIncremental(db, vaultPath);
      expect(
        db.prepare(`SELECT * FROM notes_index WHERE id = ?`).get('del1')
      ).toBeUndefined();

      db.close();
    });

    it('skips .trash, .thoughtstack, and .images directories', () => {
      const db = initSearchIndex(vaultPath);

      writeNote(vaultPath, 'Work', 'Good.md', { id: 'good1' });

      // Write notes in excluded directories
      writeNote(vaultPath, '.trash', 'Trashed.md', { id: 'trash1' });
      writeNote(vaultPath, '.images', 'Image.md', { id: 'img1' });

      const count = rebuildIndexIncremental(db, vaultPath);
      expect(count).toBe(1);

      const rows = db.prepare(`SELECT id FROM notes_index`).all() as {
        id: string;
      }[];
      expect(rows.map((r) => r.id)).toEqual(['good1']);

      db.close();
    });
  });

  // ── 3.5 / 3.7: Full rebuild ─────────────────────────────────────────────

  describe('rebuildIndexFull', () => {
    it('clears existing data and re-indexes all notes', () => {
      const db = initSearchIndex(vaultPath);

      writeNote(vaultPath, 'Work', 'Note1.md', { id: 'n1' });
      rebuildIndexIncremental(db, vaultPath);

      // Add another note
      writeNote(vaultPath, 'Work', 'Note2.md', { id: 'n2' });

      const count = rebuildIndexFull(db, vaultPath);
      expect(count).toBe(2);

      const rows = db.prepare(`SELECT * FROM notes_index`).all();
      expect(rows).toHaveLength(2);

      db.close();
    });

    it('removes stale entries that no longer exist on disk', () => {
      const db = initSearchIndex(vaultPath);

      const relPath = writeNote(vaultPath, 'Work', 'Stale.md', {
        id: 'stale1',
      });
      writeNote(vaultPath, 'Work', 'Fresh.md', { id: 'fresh1' });

      rebuildIndexFull(db, vaultPath);
      expect(db.prepare(`SELECT * FROM notes_index`).all()).toHaveLength(2);

      // Delete one file
      fs.unlinkSync(path.join(vaultPath, relPath));

      const count = rebuildIndexFull(db, vaultPath);
      expect(count).toBe(1);

      const rows = db.prepare(`SELECT * FROM notes_index`).all();
      expect(rows).toHaveLength(1);

      db.close();
    });
  });

  // ── 3.6 / 3.7: ensureSearchIndex ────────────────────────────────────────

  describe('ensureSearchIndex', () => {
    it('initialises and incrementally rebuilds in one call', () => {
      writeNote(vaultPath, 'Work', 'Note1.md', {
        id: 'n1',
        content: 'Searchable content here.',
      });

      const db = ensureSearchIndex(vaultPath);

      const rows = db.prepare(`SELECT * FROM notes_index`).all();
      expect(rows).toHaveLength(1);

      // Verify FTS works after ensureSearchIndex
      const results = searchNotes(db, 'searchable');
      expect(results).toHaveLength(1);

      db.close();
    });
  });

  // ── Nested notebook (stack) support ──────────────────────────────────────

  describe('nested notebooks', () => {
    it('indexes notes in nested stack directories', () => {
      const db = initSearchIndex(vaultPath);

      writeNote(vaultPath, path.join('Work', 'ProjectAlpha'), 'Spec.md', {
        id: 'nested1',
        content: 'Nested note in a stack.',
      });

      const count = rebuildIndexFull(db, vaultPath);
      expect(count).toBe(1);

      const row = db
        .prepare(`SELECT * FROM notes_index WHERE id = ?`)
        .get('nested1') as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.notebook).toBe('Work');

      db.close();
    });
  });
});
