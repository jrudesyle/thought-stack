import { describe, it, expect, afterEach } from 'vitest';
import { initDatabase, type Database } from '../../../src/server/db/index.ts';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('initDatabase', () => {
  const tempDirs: string[] = [];
  const databases: Database[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'note-app-test-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const db of databases) {
      try { db.close(); } catch { /* ignore */ }
    }
    databases.length = 0;
    for (const dir of tempDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tempDirs.length = 0;
  });

  it('should create the database file and parent directory', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'subdir', 'nested', 'test.db');
    const db = initDatabase(dbPath);
    databases.push(db);

    expect(existsSync(dbPath)).toBe(true);
  });

  it('should enable WAL mode', () => {
    const dir = makeTempDir();
    const db = initDatabase(join(dir, 'test.db'));
    databases.push(db);

    const mode = db.pragma('journal_mode', { simple: true });
    expect(mode).toBe('wal');
  });

  it('should enable foreign keys', () => {
    const dir = makeTempDir();
    const db = initDatabase(join(dir, 'test.db'));
    databases.push(db);

    const fk = db.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
  });

  it('should create all required tables', () => {
    const dir = makeTempDir();
    const db = initDatabase(join(dir, 'test.db'));
    databases.push(db);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as { name: string }[];

    const tableNames = tables.map(t => t.name).sort();

    expect(tableNames).toContain('notebook_stacks');
    expect(tableNames).toContain('notebooks');
    expect(tableNames).toContain('notes');
    expect(tableNames).toContain('tags');
    expect(tableNames).toContain('note_tags');
    expect(tableNames).toContain('note_images');
    expect(tableNames).toContain('settings');
    expect(tableNames).toContain('plugins');
    expect(tableNames).toContain('notes_fts');
  });

  it('should create all required indexes', () => {
    const dir = makeTempDir();
    const db = initDatabase(join(dir, 'test.db'));
    databases.push(db);

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
    ).all() as { name: string }[];

    const indexNames = indexes.map(i => i.name);

    expect(indexNames).toContain('idx_notes_notebook');
    expect(indexNames).toContain('idx_notes_trashed');
    expect(indexNames).toContain('idx_notes_updated');
    expect(indexNames).toContain('idx_note_tags_tag');
    expect(indexNames).toContain('idx_note_images_note');
  });

  it('should create FTS5 virtual table notes_fts', () => {
    const dir = makeTempDir();
    const db = initDatabase(join(dir, 'test.db'));
    databases.push(db);

    const fts = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'"
    ).get() as { name: string } | null;

    expect(fts).not.toBeNull();
    expect(fts!.name).toBe('notes_fts');
  });

  it('should create FTS sync triggers', () => {
    const dir = makeTempDir();
    const db = initDatabase(join(dir, 'test.db'));
    databases.push(db);

    const triggers = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'notes_fts_%' ORDER BY name"
    ).all() as { name: string }[];

    const triggerNames = triggers.map(t => t.name);

    expect(triggerNames).toContain('notes_fts_insert');
    expect(triggerNames).toContain('notes_fts_delete');
    expect(triggerNames).toContain('notes_fts_update');
  });

  it('should be safe to call on an existing database', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'test.db');

    // First init
    const db1 = initDatabase(dbPath);
    db1.close();

    // Second init on same file — should not throw
    const db2 = initDatabase(dbPath);
    databases.push(db2);

    // Verify tables still exist
    const tables = db2.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='notes'"
    ).get() as { name: string } | null;

    expect(tables).not.toBeNull();
  });

  it('should preserve existing data when re-opened', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'test.db');

    // First init — insert a stack
    const db1 = initDatabase(dbPath);
    db1.prepare(
      "INSERT INTO notebook_stacks (id, name) VALUES (?, ?)"
    ).run('stack-1', 'My Stack');
    db1.close();

    // Second init — data should still be there
    const db2 = initDatabase(dbPath);
    databases.push(db2);

    const stack = db2.prepare(
      "SELECT name FROM notebook_stacks WHERE id = ?"
    ).get('stack-1') as { name: string } | null;

    expect(stack).not.toBeNull();
    expect(stack!.name).toBe('My Stack');
  });

  it('should support the prepare/run/get/all API surface', () => {
    const dir = makeTempDir();
    const db = initDatabase(join(dir, 'test.db'));
    databases.push(db);

    // Insert a notebook stack
    const result = db.prepare(
      "INSERT INTO notebook_stacks (id, name) VALUES (?, ?)"
    ).run('test-id', 'Test Stack');

    expect(result.changes).toBe(1);

    // Get single row
    const row = db.prepare(
      "SELECT * FROM notebook_stacks WHERE id = ?"
    ).get('test-id') as { id: string; name: string } | null;

    expect(row).not.toBeNull();
    expect(row!.name).toBe('Test Stack');

    // Get all rows
    const rows = db.prepare("SELECT * FROM notebook_stacks").all();
    expect(rows.length).toBe(1);
  });

  it('should support transactions', () => {
    const dir = makeTempDir();
    const db = initDatabase(join(dir, 'test.db'));
    databases.push(db);

    // Successful transaction
    const insertTwo = db.transaction((() => {
      db.prepare("INSERT INTO notebook_stacks (id, name) VALUES (?, ?)").run('s1', 'Stack 1');
      db.prepare("INSERT INTO notebook_stacks (id, name) VALUES (?, ?)").run('s2', 'Stack 2');
    }) as () => void);

    insertTwo();

    const count = db.prepare("SELECT COUNT(*) as cnt FROM notebook_stacks").get() as { cnt: number };
    expect(count.cnt).toBe(2);
  });

  it('should rollback transactions on error', () => {
    const dir = makeTempDir();
    const db = initDatabase(join(dir, 'test.db'));
    databases.push(db);

    const failingTx = db.transaction((() => {
      db.prepare("INSERT INTO notebook_stacks (id, name) VALUES (?, ?)").run('s1', 'Stack 1');
      throw new Error('Intentional failure');
    }) as () => void);

    expect(() => failingTx()).toThrow('Intentional failure');

    const count = db.prepare("SELECT COUNT(*) as cnt FROM notebook_stacks").get() as { cnt: number };
    expect(count.cnt).toBe(0);
  });

  it('should return null from get() when no row matches', () => {
    const dir = makeTempDir();
    const db = initDatabase(join(dir, 'test.db'));
    databases.push(db);

    const row = db.prepare("SELECT * FROM notebook_stacks WHERE id = ?").get('nonexistent');
    expect(row).toBeNull();
  });
});
