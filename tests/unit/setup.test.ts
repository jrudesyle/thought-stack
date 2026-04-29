import { describe, it, expect } from 'vitest';
import { createTestDatabase } from '../helpers/db.ts';

describe('Test setup', () => {
  it('vitest runs correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('creates an in-memory database with full schema', () => {
    const db = createTestDatabase();

    // Verify all expected tables exist
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('notebook_stacks');
    expect(tableNames).toContain('notebooks');
    expect(tableNames).toContain('notes');
    expect(tableNames).toContain('tags');
    expect(tableNames).toContain('note_tags');
    expect(tableNames).toContain('note_images');
    expect(tableNames).toContain('settings');
    expect(tableNames).toContain('plugins');

    // Verify FTS5 virtual table exists
    const vtables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'"
      )
      .all() as { name: string }[];
    expect(vtables).toHaveLength(1);

    // Verify foreign keys are enabled
    const fkResult = db.pragma('foreign_keys') as { foreign_keys: number }[];
    expect(fkResult[0].foreign_keys).toBe(1);

    // Verify triggers exist
    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")
      .all() as { name: string }[];
    const triggerNames = triggers.map((t) => t.name);

    expect(triggerNames).toContain('notes_fts_insert');
    expect(triggerNames).toContain('notes_fts_delete');
    expect(triggerNames).toContain('notes_fts_update');

    db.close();
  });

  it('provides isolated databases per call', () => {
    const db1 = createTestDatabase();
    const db2 = createTestDatabase();

    // Insert into db1
    db1.prepare("INSERT INTO notebook_stacks (id, name) VALUES (?, ?)").run('s1', 'Stack 1');

    // db2 should not see db1's data
    const rows = db2
      .prepare('SELECT * FROM notebook_stacks')
      .all();
    expect(rows).toHaveLength(0);

    db1.close();
    db2.close();
  });

  it('supports transactions', () => {
    const db = createTestDatabase();

    const insertStack = db.transaction((name: string) => {
      db.prepare("INSERT INTO notebook_stacks (id, name) VALUES (?, ?)").run('s1', name);
    });

    insertStack('Test Stack');

    const row = db.prepare("SELECT name FROM notebook_stacks WHERE id = ?").get('s1') as { name: string } | null;
    expect(row).not.toBeNull();
    expect(row!.name).toBe('Test Stack');

    db.close();
  });

  it('enforces foreign key constraints', () => {
    const db = createTestDatabase();

    // Inserting a note with a non-existent notebook_id should fail
    expect(() => {
      db.prepare(
        "INSERT INTO notes (id, title, notebook_id) VALUES (?, ?, ?)"
      ).run('n1', 'Test Note', 'nonexistent');
    }).toThrow();

    db.close();
  });
});
