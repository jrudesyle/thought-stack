import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { resolveVaultPath } from '../vault/index';
import { parseFrontmatter } from '../vault/markdown';
import { titleFromFilename } from '../vault/sanitize';

const VAULT_META_DIR = '.thoughtstack';
const CACHE_DB_NAME = 'cache.db';

/** Directories to skip when walking the vault for .md files. */
const SKIP_DIRS = new Set(['.thoughtstack', '.trash', '.images']);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  noteId: string;
  title: string;
  snippet: string;
  notebook: string;
  tags: string[];
  modified: string;
  rank: number;
}

// ─── 3.1  Index initialisation ───────────────────────────────────────────────

/**
 * Opens (or creates) the search-index database at `.thoughtstack/cache.db`
 * inside the vault.  Creates the `notes_index` table and `notes_fts` FTS5
 * virtual table (with sync triggers) when they don't already exist.
 *
 * If the database file is corrupt and cannot be opened, it is deleted and a
 * fresh one is created (sub-task 3.6).
 */
export function initSearchIndex(vaultPath: string): Database.Database {
  const resolved = resolveVaultPath(vaultPath);
  const metaDir = path.join(resolved, VAULT_META_DIR);
  fs.mkdirSync(metaDir, { recursive: true });

  const dbPath = path.join(metaDir, CACHE_DB_NAME);

  let db: Database.Database;
  try {
    db = new Database(dbPath);
    // Validate the database is usable (catches corrupt files that open but can't be read)
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes_index (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        path        TEXT NOT NULL UNIQUE,
        notebook    TEXT NOT NULL,
        body_text   TEXT NOT NULL DEFAULT '',
        tags        TEXT NOT NULL DEFAULT '',
        created     TEXT NOT NULL,
        modified    TEXT NOT NULL
      );
    `);
  } catch {
    // 3.6 – corrupt / unreadable file → delete and retry
    try {
      db!.close();
    } catch {
      // ignore close errors
    }
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // file may not exist – ignore
    }
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes_index (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        path        TEXT NOT NULL UNIQUE,
        notebook    TEXT NOT NULL,
        body_text   TEXT NOT NULL DEFAULT '',
        tags        TEXT NOT NULL DEFAULT '',
        created     TEXT NOT NULL,
        modified    TEXT NOT NULL
      );
    `);
  }

  // ── FTS5 virtual table (doesn't support IF NOT EXISTS) ─────────────────
  const ftsExists = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='notes_fts'`
    )
    .get();

  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE notes_fts USING fts5(
        title,
        body_text,
        tags,
        content=notes_index,
        content_rowid=rowid,
        tokenize='porter unicode61'
      );
    `);
  }

  // ── FTS sync triggers ──────────────────────────────────────────────────
  // We use IF NOT EXISTS so re-calling initSearchIndex is idempotent.

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_index_ai AFTER INSERT ON notes_index BEGIN
      INSERT INTO notes_fts(rowid, title, body_text, tags)
        VALUES (new.rowid, new.title, new.body_text, new.tags);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_index_ad AFTER DELETE ON notes_index BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, body_text, tags)
        VALUES ('delete', old.rowid, old.title, old.body_text, old.tags);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_index_au AFTER UPDATE ON notes_index BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, body_text, tags)
        VALUES ('delete', old.rowid, old.title, old.body_text, old.tags);
      INSERT INTO notes_fts(rowid, title, body_text, tags)
        VALUES (new.rowid, new.title, new.body_text, new.tags);
    END;
  `);

  return db;
}

// ─── 3.2  Incremental rebuild ────────────────────────────────────────────────

/**
 * Scans every `.md` file in the vault, compares the `modified` frontmatter
 * timestamp with what's stored in the index, and upserts any that changed.
 * Also removes index entries whose files no longer exist on disk.
 * Returns the number of entries that were inserted or updated.
 */
export function rebuildIndexIncremental(
  db: Database.Database,
  vaultPath: string
): number {
  const resolved = resolveVaultPath(vaultPath);
  const mdFiles = walkMdFiles(resolved);
  let updatedCount = 0;

  // Build a set of all relative paths currently on disk
  const diskPaths = new Set<string>();

  const getModified = db.prepare(
    `SELECT modified FROM notes_index WHERE path = ?`
  );

  for (const fullPath of mdFiles) {
    const relativePath = path.relative(resolved, fullPath);
    diskPaths.add(relativePath);

    try {
      const fileContent = fs.readFileSync(fullPath, 'utf-8');
      const { data, content } = parseFrontmatter(fileContent);

      // Compare modified timestamp
      const row = getModified.get(relativePath) as
        | { modified: string }
        | undefined;

      if (!row || row.modified !== data.modified) {
        upsertNote(db, resolved, relativePath, data, content);
        updatedCount++;
      }
    } catch {
      // Skip files that can't be read / parsed
    }
  }

  // Remove index entries for files that no longer exist on disk
  const allIndexed = db
    .prepare(`SELECT path FROM notes_index`)
    .all() as { path: string }[];

  const deleteStmt = db.prepare(`DELETE FROM notes_index WHERE path = ?`);
  for (const row of allIndexed) {
    if (!diskPaths.has(row.path)) {
      deleteStmt.run(row.path);
    }
  }

  return updatedCount;
}

// ─── 3.3  Single-note update ─────────────────────────────────────────────────

/**
 * Reads a single `.md` file, parses its frontmatter and body, and upserts
 * the entry into `notes_index`.  The FTS triggers keep `notes_fts` in sync.
 */
export function updateNoteIndex(
  db: Database.Database,
  vaultPath: string,
  notePath: string
): void {
  const resolved = resolveVaultPath(vaultPath);
  const fullPath = path.join(resolved, notePath);

  const fileContent = fs.readFileSync(fullPath, 'utf-8');
  const { data, content } = parseFrontmatter(fileContent);

  upsertNote(db, resolved, notePath, data, content);
}

// ─── 3.4  Full-text search ───────────────────────────────────────────────────

/**
 * Searches the FTS5 index using MATCH and returns ranked results with
 * snippets.  Optional `notebook` and `tag` filters are applied as additional
 * WHERE clauses on the joined `notes_index` table.
 */
export function searchNotes(
  db: Database.Database,
  query: string,
  filters?: { notebook?: string; tag?: string }
): SearchResult[] {
  if (!query || query.trim().length === 0) {
    return [];
  }

  // Sanitise the query for FTS5 – wrap each token in double-quotes so that
  // special FTS5 characters (*, -, etc.) are treated as literals.
  const sanitised = sanitiseFtsQuery(query);
  if (!sanitised) return [];

  let sql = `
    SELECT
      ni.id        AS noteId,
      ni.title     AS title,
      ni.body_text AS body_text,
      ni.notebook  AS notebook,
      ni.tags      AS tags,
      ni.modified  AS modified,
      nf.rank      AS rank
    FROM notes_fts nf
    JOIN notes_index ni ON ni.rowid = nf.rowid
    WHERE notes_fts MATCH ?
  `;

  const params: unknown[] = [sanitised];

  if (filters?.notebook) {
    sql += ` AND ni.notebook = ?`;
    params.push(filters.notebook);
  }

  if (filters?.tag) {
    sql += ` AND (',' || ni.tags || ',' LIKE '%,' || ? || ',%')`;
    params.push(filters.tag);
  }

  sql += ` ORDER BY nf.rank`;  // rank is negative; lower = more relevant

  const rows = db.prepare(sql).all(...params) as Array<{
    noteId: string;
    title: string;
    body_text: string;
    notebook: string;
    tags: string;
    modified: string;
    rank: number;
  }>;

  return rows.map((row) => ({
    noteId: row.noteId,
    title: row.title,
    snippet: generateSnippet(row.body_text, query),
    notebook: row.notebook,
    tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    modified: row.modified,
    rank: row.rank,
  }));
}

// ─── 3.5  Full rebuild ──────────────────────────────────────────────────────

/**
 * Deletes every entry from `notes_index` (the FTS triggers cascade the
 * deletions to `notes_fts`), then re-scans all `.md` files and inserts them.
 * Returns the count of indexed notes.
 */
export function rebuildIndexFull(
  db: Database.Database,
  vaultPath: string
): number {
  const resolved = resolveVaultPath(vaultPath);

  // Clear existing data – triggers handle FTS cleanup
  db.exec(`DELETE FROM notes_index`);

  const mdFiles = walkMdFiles(resolved);
  let count = 0;

  for (const fullPath of mdFiles) {
    const relativePath = path.relative(resolved, fullPath);
    try {
      const fileContent = fs.readFileSync(fullPath, 'utf-8');
      const { data, content } = parseFrontmatter(fileContent);
      upsertNote(db, resolved, relativePath, data, content);
      count++;
    } catch {
      // Skip unparseable files
    }
  }

  return count;
}

// ─── 3.6  Ensure search index (init + incremental rebuild) ──────────────────

/**
 * Convenience wrapper: initialises the database (handling corrupt files) and
 * performs an incremental rebuild so the index is up-to-date.
 */
export function ensureSearchIndex(vaultPath: string): Database.Database {
  const db = initSearchIndex(vaultPath);
  rebuildIndexIncremental(db, vaultPath);
  return db;
}

// ─── Helpers (private) ───────────────────────────────────────────────────────

/**
 * Recursively walks the vault directory and returns absolute paths to every
 * `.md` file, skipping `.thoughtstack/`, `.trash/`, and `.images/` dirs.
 */
function walkMdFiles(vaultRoot: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(path.join(dir, entry.name));
      }
    }
  }

  walk(vaultRoot);
  return results;
}

/**
 * INSERT OR REPLACE a note into `notes_index`.  The FTS triggers keep
 * `notes_fts` in sync automatically.
 */
function upsertNote(
  db: Database.Database,
  vaultRoot: string,
  relativePath: string,
  data: { id: string; tags: string[]; created: string; modified: string },
  bodyText: string
): void {
  const filename = path.basename(relativePath);
  const title = titleFromFilename(filename);
  const notebook = path.dirname(relativePath).split(path.sep)[0];
  const tagsStr = data.tags.join(',');

  db.prepare(
    `INSERT OR REPLACE INTO notes_index (id, title, path, notebook, body_text, tags, created, modified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(data.id, title, relativePath, notebook, bodyText, tagsStr, data.created, data.modified);
}

/**
 * Generates a short snippet (~200 chars) from the body text.  If the query
 * term appears in the text, centres the snippet around the first occurrence;
 * otherwise returns the beginning of the text.
 */
function generateSnippet(bodyText: string, query: string): string {
  const maxLen = 200;
  const text = bodyText.trim();
  if (text.length === 0) return '';

  // Try to find the first query term in the body
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lowerText = text.toLowerCase();

  for (const term of terms) {
    const idx = lowerText.indexOf(term);
    if (idx !== -1) {
      const start = Math.max(0, idx - 80);
      const end = Math.min(text.length, start + maxLen);
      let snippet = text.slice(start, end).trim();
      if (start > 0) snippet = '...' + snippet;
      if (end < text.length) snippet = snippet + '...';
      return snippet;
    }
  }

  // Fallback: beginning of text
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trim() + '...';
}

/**
 * Sanitises a user query for FTS5 MATCH.  Each whitespace-separated token is
 * double-quoted so special characters are treated as literals, then tokens are
 * joined with spaces (implicit AND).
 */
function sanitiseFtsQuery(raw: string): string {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  return tokens.join(' ');
}
