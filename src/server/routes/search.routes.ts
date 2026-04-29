import { Hono } from 'hono';
import type { Database } from '../db/index.ts';
import { createSearchDAL } from '../dal/search.dal.ts';

/**
 * Creates search API routes.
 *
 * Endpoints:
 *   GET /search?q=&notebookId=&tagId= — full-text search with optional filters
 *
 * Returns results with highlighted snippets, notebook name, tags, and rank.
 * Returns empty array with message when no results found.
 */
export function createSearchRoutes(db: Database): Hono {
  const app = new Hono();
  const searchDAL = createSearchDAL(db);

  /**
   * GET /search — full-text search with optional filters.
   *
   * Query params:
   *   - q: search query string (required for results)
   *   - notebookId: filter results to a specific notebook
   *   - tagId: filter results to notes with a specific tag
   */
  app.get('/search', (c) => {
    const q = c.req.query('q');
    const notebookId = c.req.query('notebookId');
    const tagId = c.req.query('tagId');

    // No query provided — return empty results with message
    if (!q || q.trim().length === 0) {
      return c.json({
        results: [],
        message: 'Enter a search query to find notes',
      });
    }

    try {
      const filters: { notebookId?: string; tagIds?: string[] } = {};

      if (notebookId) {
        filters.notebookId = notebookId;
      }

      if (tagId) {
        filters.tagIds = [tagId];
      }

      const results = searchDAL.search(q, filters);

      if (results.length === 0) {
        return c.json({
          results: [],
          message: 'No notes found matching your search',
        });
      }

      return c.json({
        results,
        message: null,
      });
    } catch (err: unknown) {
      // FTS5 can throw on malformed queries (e.g. unbalanced quotes)
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('fts5') ||
        message.includes('syntax error') ||
        message.includes('parse error')
      ) {
        return c.json(
          {
            error: {
              code: 'INVALID_QUERY',
              message: 'Invalid search query syntax',
            },
          },
          400,
        );
      }
      throw err;
    }
  });

  return app;
}
