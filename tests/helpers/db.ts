import { DatabaseSync } from 'node:sqlite';

/**
 * Wrapper around node:sqlite DatabaseSync that provides a better-sqlite3
 * compatible API surface. This allows tests to run without native modules
 * while the production code uses better-sqlite3.
 *
 * The wrapper covers the API surface used by the DAL:
 * - db.prepare(sql) returning statements with .run(), .get(), .all()
 * - db.exec(sql)
 * - db.pragma(key)
 * - db.transaction(fn)
 * - db.close()
 */
export interface TestDatabase {
  prepare(sql: string): TestStatement;
  exec(sql: string): void;
  pragma(pragma: string, options?: { simple?: boolean }): unknown;
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
  close(): void;
}

export interface TestStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/**
 * Creates a fresh in-memory SQLite database with the full application schema applied.
 * Each call returns an isolated database instance — no shared state between tests.
 *
 * Uses node:sqlite (built-in) with a better-sqlite3 compatible wrapper,
 * avoiding native module loading issues in the test environment.
 */
export function createTestDatabase(): TestDatabase {
  const db = new DatabaseSync(':memory:');

  // Enable WAL mode and foreign keys
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  // Apply full schema
  db.exec(SCHEMA);

  return wrapDatabase(db);
}

function wrapDatabase(db: DatabaseSync): TestDatabase {
  return {
    prepare(sql: string): TestStatement {
      const stmt = db.prepare(sql);
      return {
        run(...params: unknown[]) {
          const result = stmt.run(...params);
          return {
            changes: result.changes as number,
            lastInsertRowid: result.lastInsertRowid,
          };
        },
        get(...params: unknown[]) {
          return stmt.get(...params) ?? null;
        },
        all(...params: unknown[]) {
          return stmt.all(...params);
        },
      };
    },

    exec(sql: string): void {
      db.exec(sql);
    },

    pragma(pragma: string, options?: { simple?: boolean }): unknown {
      const stmt = db.prepare(`PRAGMA ${pragma}`);
      const rows = stmt.all() as Record<string, unknown>[];
      if (options?.simple) {
        if (rows.length === 0) return undefined;
        const firstRow = rows[0];
        const keys = Object.keys(firstRow);
        return firstRow[keys[0]];
      }
      return rows;
    },

    transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
      const wrapped = ((...args: unknown[]) => {
        db.exec('BEGIN');
        try {
          const result = fn(...args);
          db.exec('COMMIT');
          return result;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      }) as T;
      return wrapped;
    },

    close(): void {
      db.close();
    },
  };
}

const SCHEMA = `
-- Notebook Stacks
CREATE TABLE notebook_stacks (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Notebooks
CREATE TABLE notebooks (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL,
    stack_id    TEXT REFERENCES notebook_stacks(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name, stack_id)
);

-- Notes
CREATE TABLE notes (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    title           TEXT NOT NULL DEFAULT '',
    content         TEXT NOT NULL DEFAULT '{}',
    notebook_id     TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    is_trashed      INTEGER NOT NULL DEFAULT 0,
    trashed_at      TEXT,
    original_notebook_id TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_notes_notebook ON notes(notebook_id) WHERE is_trashed = 0;
CREATE INDEX idx_notes_trashed ON notes(is_trashed) WHERE is_trashed = 1;
CREATE INDEX idx_notes_updated ON notes(updated_at DESC);

-- Tags
CREATE TABLE tags (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Note-Tag junction table
CREATE TABLE note_tags (
    note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX idx_note_tags_tag ON note_tags(tag_id);

-- Full-Text Search index (FTS5)
CREATE VIRTUAL TABLE notes_fts USING fts5(
    title,
    body_text,
    content=notes,
    content_rowid=rowid,
    tokenize='porter unicode61'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, body_text)
    VALUES (new.rowid, new.title, '');
END;

CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body_text)
    VALUES ('delete', old.rowid, old.title, '');
END;

CREATE TRIGGER notes_fts_update AFTER UPDATE OF title ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body_text)
    VALUES ('delete', old.rowid, old.title, '');
    INSERT INTO notes_fts(rowid, title, body_text)
    VALUES (new.rowid, new.title, '');
END;

-- Note images (stored as blobs for data ownership)
CREATE TABLE note_images (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    mime_type   TEXT NOT NULL,
    data        BLOB NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_note_images_note ON note_images(note_id);

-- App settings (key-value store)
CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);

-- Plugin state
CREATE TABLE plugins (
    name        TEXT PRIMARY KEY,
    enabled     INTEGER NOT NULL DEFAULT 1,
    config      TEXT DEFAULT '{}',
    loaded_at   TEXT
);
`;
