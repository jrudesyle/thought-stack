import type { Database } from '../db/index.ts';

/**
 * Filters that can be applied to search queries.
 */
export interface SearchFilters {
  notebookId?: string;
  tagIds?: string[];
}

/**
 * A single search result with metadata.
 */
export interface SearchResult {
  noteId: string;
  title: string;
  snippet: string;
  notebookName: string;
  tags: string[];
  updatedAt: string;
  rank: number;
}

/**
 * Extracts plain text from a TipTap/ProseMirror JSON document.
 *
 * Walks the document tree recursively, collecting all `text` values
 * from content nodes. Blocks are separated by newlines.
 */
export function extractTextFromTipTap(json: unknown): string {
  if (!json || typeof json !== 'object') {
    return '';
  }

  const doc = json as Record<string, unknown>;

  // If this node has a `text` property, return it directly
  if (typeof doc.text === 'string') {
    return doc.text;
  }

  // If this node has `content`, recurse into children
  if (Array.isArray(doc.content)) {
    const parts: string[] = [];
    for (const child of doc.content) {
      const text = extractTextFromTipTap(child);
      if (text) {
        parts.push(text);
      }
    }
    // Join block-level nodes with newlines
    return parts.join('\n');
  }

  return '';
}

/**
 * Generates a simple text snippet with highlighted matches.
 *
 * Since FTS5 snippet()/highlight() don't work with external content tables
 * where the source table lacks matching columns (our `notes` table doesn't
 * have `body_text`), we generate snippets manually from the note content.
 */
function generateSnippet(
  text: string,
  query: string,
  maxLength = 200
): string {
  if (!text) return '';

  // Normalize whitespace
  const normalized = text.replace(/\s+/g, ' ').trim();

  // Extract individual search terms (strip FTS5 operators)
  const terms = query
    .replace(/['"*+\-(){}[\]^~]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase());

  if (terms.length === 0) {
    return normalized.slice(0, maxLength);
  }

  // Find the first occurrence of any term
  const lowerText = normalized.toLowerCase();
  let bestPos = -1;
  for (const term of terms) {
    const pos = lowerText.indexOf(term);
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
      bestPos = pos;
    }
  }

  // Extract a window around the match
  let start = 0;
  let prefix = '';
  if (bestPos > 40) {
    start = bestPos - 40;
    prefix = '...';
  }

  let slice = normalized.slice(start, start + maxLength);
  if (start + maxLength < normalized.length) {
    slice += '...';
  }
  slice = prefix + slice;

  // Highlight matching terms with <mark> tags
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    slice = slice.replace(regex, '<mark>$1</mark>');
  }

  return slice;
}

/**
 * Creates a Search Data Access Layer bound to the given database instance.
 */
export function createSearchDAL(db: Database) {
  return {
    /**
     * Full-text search using FTS5 with bm25 ranking.
     *
     * Queries the `notes_fts` virtual table and joins with `notes` to get
     * metadata. Supports optional filtering by notebookId and tagIds.
     * Trashed notes are always excluded.
     *
     * Returns results ordered by FTS5 bm25 relevance score.
     */
    search(query: string, filters?: SearchFilters): SearchResult[] {
      if (!query || query.trim().length === 0) {
        return [];
      }

      const trimmedQuery = query.trim();

      // Build the query using rank (built-in FTS5 column) instead of
      // snippet()/bm25() which don't work with external content tables
      // where the source table lacks matching columns.
      let sql = `
        SELECT
          n.id AS noteId,
          n.title,
          n.content,
          nb.name AS notebookName,
          n.updated_at AS updatedAt,
          notes_fts.rank AS rank
        FROM notes_fts
        INNER JOIN notes n ON n.rowid = notes_fts.rowid
        INNER JOIN notebooks nb ON nb.id = n.notebook_id
        WHERE notes_fts MATCH ?
          AND n.is_trashed = 0
      `;

      const params: unknown[] = [trimmedQuery];

      // Apply notebook filter
      if (filters?.notebookId) {
        sql += ' AND n.notebook_id = ?';
        params.push(filters.notebookId);
      }

      // Apply tag filter — note must have ALL specified tags
      if (filters?.tagIds && filters.tagIds.length > 0) {
        for (const tagId of filters.tagIds) {
          sql += `
            AND EXISTS (
              SELECT 1 FROM note_tags nt
              WHERE nt.note_id = n.id AND nt.tag_id = ?
            )
          `;
          params.push(tagId);
        }
      }

      // Order by relevance (rank is negative; lower = more relevant)
      sql += ' ORDER BY rank';

      const rows = db.prepare(sql).all(...params) as Array<{
        noteId: string;
        title: string;
        content: string;
        notebookName: string;
        updatedAt: string;
        rank: number;
      }>;

      // Attach tags and generate snippets for each result
      const tagStmt = db.prepare(
        `SELECT t.name
         FROM tags t
         INNER JOIN note_tags nt ON nt.tag_id = t.id
         WHERE nt.note_id = ?
         ORDER BY t.name`
      );

      return rows.map((row) => {
        // Extract body text for snippet generation
        let bodyText = '';
        try {
          const parsed = JSON.parse(row.content);
          bodyText = extractTextFromTipTap(parsed);
        } catch {
          bodyText = '';
        }

        // Generate snippet from body text, falling back to title
        const snippetSource = bodyText || row.title;
        const snippet = generateSnippet(snippetSource, trimmedQuery);

        return {
          noteId: row.noteId,
          title: row.title,
          snippet,
          notebookName: row.notebookName,
          tags: (tagStmt.all(row.noteId) as Array<{ name: string }>).map(
            (t) => t.name
          ),
          updatedAt: row.updatedAt,
          rank: row.rank,
        };
      });
    },

    /**
     * Reindex a single note in the FTS5 index.
     *
     * Extracts plain text from the note's TipTap JSON content and updates
     * the FTS5 index. Uses the FTS5 'delete-all' command to wipe the index
     * and then repopulates all entries, since we can't reliably track the
     * old body_text value for per-row deletes.
     */
    reindex(noteId: string): void {
      // Verify the note exists
      const note = db.prepare(
        'SELECT rowid, title, content FROM notes WHERE id = ?'
      ).get(noteId) as { rowid: number; title: string; content: string } | null;

      if (!note) return;

      // Wipe the entire FTS index and repopulate
      this._rebuildFtsIndex();
    },

    /**
     * Rebuild the entire FTS5 index from scratch.
     *
     * Clears the FTS index using the 'delete-all' command and repopulates
     * it by extracting plain text from every note's TipTap JSON content.
     */
    rebuildIndex(): void {
      this._rebuildFtsIndex();
    },

    /**
     * Internal: wipe and repopulate the FTS5 index.
     *
     * The FTS5 'delete-all' command removes all entries from the index
     * without needing to know the previously indexed values. We then
     * re-insert every note with its current title and extracted body text.
     */
    _rebuildFtsIndex(): void {
      // Clear the entire FTS index
      db.prepare(
        "INSERT INTO notes_fts(notes_fts) VALUES('delete-all')"
      ).run();

      // Get all notes with their rowids and re-insert into FTS
      const notes = db.prepare(
        'SELECT rowid, title, content FROM notes'
      ).all() as Array<{
        rowid: number;
        title: string;
        content: string;
      }>;

      for (const note of notes) {
        let bodyText = '';
        try {
          const parsed = JSON.parse(note.content);
          bodyText = extractTextFromTipTap(parsed);
        } catch {
          bodyText = '';
        }

        db.prepare(
          'INSERT INTO notes_fts(rowid, title, body_text) VALUES(?, ?, ?)'
        ).run(note.rowid, note.title, bodyText);
      }
    },
  };
}
