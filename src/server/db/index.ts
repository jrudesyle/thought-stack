import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Wrapper around node:sqlite DatabaseSync that provides a better-sqlite3
 * compatible API surface. This allows DAL code to work uniformly with
 * both production and test database instances.
 *
 * The wrapper covers the API surface used by the DAL:
 * - db.prepare(sql) returning statements with .run(), .get(), .all()
 * - db.exec(sql)
 * - db.pragma(key)
 * - db.transaction(fn)
 * - db.close()
 */
export interface Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface Database {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma(pragma: string, options?: { simple?: boolean }): unknown;
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
  close(): void;
}

/**
 * Wraps a node:sqlite DatabaseSync instance with a better-sqlite3 compatible API.
 */
function wrapDatabase(db: DatabaseSync): Database {
  return {
    prepare(sql: string): Statement {
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

/**
 * Full application schema. Uses IF NOT EXISTS so it's safe to run
 * against an existing database.
 */
const SCHEMA = `
-- Notebook Stacks
CREATE TABLE IF NOT EXISTS notebook_stacks (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Notebooks
CREATE TABLE IF NOT EXISTS notebooks (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL,
    stack_id    TEXT REFERENCES notebook_stacks(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name, stack_id)
);

-- Notes
CREATE TABLE IF NOT EXISTS notes (
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

CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id) WHERE is_trashed = 0;
CREATE INDEX IF NOT EXISTS idx_notes_trashed ON notes(is_trashed) WHERE is_trashed = 1;
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Note-Tag junction table
CREATE TABLE IF NOT EXISTS note_tags (
    note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);

-- Note images (stored as blobs for data ownership)
CREATE TABLE IF NOT EXISTS note_images (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    mime_type   TEXT NOT NULL,
    data        BLOB NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_note_images_note ON note_images(note_id);

-- App settings (key-value store)
CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);

-- Plugin state
CREATE TABLE IF NOT EXISTS plugins (
    name        TEXT PRIMARY KEY,
    enabled     INTEGER NOT NULL DEFAULT 1,
    config      TEXT DEFAULT '{}',
    loaded_at   TEXT
);
`;

/**
 * FTS5 virtual table and sync triggers.
 * These are created separately because FTS5 virtual tables don't support
 * IF NOT EXISTS. We check for existence before creating.
 */
const FTS_SCHEMA = `
CREATE VIRTUAL TABLE notes_fts USING fts5(
    title,
    body_text,
    content=notes,
    content_rowid=rowid,
    tokenize='porter unicode61'
);
`;

const FTS_TRIGGERS = `
-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, body_text)
    VALUES (new.rowid, new.title, '');
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body_text)
    VALUES ('delete', old.rowid, old.title, '');
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE OF title ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body_text)
    VALUES ('delete', old.rowid, old.title, '');
    INSERT INTO notes_fts(rowid, title, body_text)
    VALUES (new.rowid, new.title, '');
END;
`;

/**
 * Check if the FTS5 virtual table already exists.
 */
function ftsTableExists(db: DatabaseSync): boolean {
  const stmt = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'"
  );
  const row = stmt.get();
  return row != null;
}

/**
 * Initializes (or opens) a SQLite database at the given path with the full
 * application schema applied. Creates the parent directory if it doesn't exist.
 *
 * Safe to call on an existing database — all CREATE statements use IF NOT EXISTS,
 * and the FTS5 table is only created if it doesn't already exist.
 *
 * Enables WAL mode and foreign keys for performance and data integrity.
 *
 * @param dbPath - Path to the SQLite database file
 * @returns A Database instance with a better-sqlite3 compatible API
 */
export function initDatabase(dbPath: string): Database {
  // Ensure the parent directory exists
  const dir = dirname(dbPath);
  mkdirSync(dir, { recursive: true });

  // Open or create the database
  const db = new DatabaseSync(dbPath);

  // Enable WAL mode and foreign keys
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  // Apply the main schema (all IF NOT EXISTS)
  db.exec(SCHEMA);

  // Create FTS5 virtual table if it doesn't exist
  if (!ftsTableExists(db)) {
    db.exec(FTS_SCHEMA);
  }

  // Create FTS sync triggers (IF NOT EXISTS)
  db.exec(FTS_TRIGGERS);

  return wrapDatabase(db);
}
