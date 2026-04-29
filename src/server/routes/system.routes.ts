import { Hono } from 'hono';
import type { Database } from '../db/index.ts';
import { createExportService, type ExportData } from '../services/export.service.ts';
import { createImportService } from '../services/import.service.ts';

/**
 * Creates system API routes.
 *
 * Endpoints:
 *   GET  /system/health    — health check
 *   POST /system/export    — export all data as JSON
 *   POST /system/import    — import data from JSON with validation
 *   GET  /system/settings  — get app settings
 *   PUT  /system/settings  — update app settings
 */
export function createSystemRoutes(db: Database): Hono {
  const app = new Hono();
  const exportService = createExportService(db);
  const importService = createImportService(db);

  // ── Health check ─────────────────────────────────────────────────

  app.get('/system/health', (c) => c.json({ status: 'ok' }));

  // ── Export ───────────────────────────────────────────────────────

  /**
   * POST /system/export — export all data as JSON.
   *
   * Returns the full database contents following the ExportData interface:
   * stacks, notebooks, notes (with content and tag names), and tags.
   */
  app.post('/system/export', (c) => {
    const exportData = exportService.exportAll();
    return c.json(exportData);
  });

  // ── Import ───────────────────────────────────────────────────────

  /**
   * POST /system/import — import data from JSON with validation.
   *
   * Accepts JSON in the ExportData format. Validates entries, imports valid
   * ones in a transaction, skips malformed entries, and returns a summary.
   * Returns 207 Multi-Status when there are partial errors.
   */
  app.post('/system/import', async (c) => {
    let data: ExportData;
    try {
      data = await c.req.json<ExportData>();
    } catch {
      return c.json(
        {
          error: {
            code: 'INVALID_JSON',
            message: 'Request body is not valid JSON',
          },
        },
        400,
      );
    }

    if (!data || typeof data !== 'object') {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Import data must be a JSON object',
          },
        },
        400,
      );
    }

    let result;
    try {
      result = importService.importData(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          error: {
            code: 'IMPORT_FAILED',
            message: `Import transaction failed: ${msg}`,
          },
        },
        500,
      );
    }

    const { imported, errors } = result;

    if (errors.length > 0) {
      // 207 Multi-Status for partial success
      return c.json(
        {
          imported,
          errors,
          message: `Imported ${imported.total} entries. ${errors.length} entries had errors.`,
        },
        207,
      );
    }

    return c.json({
      imported,
      errors: [],
      message: `Successfully imported ${imported.total} entries.`,
    });
  });

  // ── Settings ─────────────────────────────────────────────────────

  /**
   * GET /system/settings — get all app settings.
   *
   * Returns a key-value object of all settings from the settings table.
   */
  app.get('/system/settings', (c) => {
    const rows = db
      .prepare('SELECT key, value FROM settings')
      .all() as Array<{ key: string; value: string }>;

    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    return c.json(settings);
  });

  /**
   * PUT /system/settings — update app settings.
   *
   * Accepts a JSON object of key-value pairs. Each key is upserted
   * into the settings table.
   */
  app.put('/system/settings', async (c) => {
    let body: Record<string, string>;
    try {
      body = await c.req.json<Record<string, string>>();
    } catch {
      return c.json(
        {
          error: {
            code: 'INVALID_JSON',
            message: 'Request body is not valid JSON',
          },
        },
        400,
      );
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Settings must be a JSON object of key-value pairs',
          },
        },
        400,
      );
    }

    const upsert = db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );

    for (const [key, value] of Object.entries(body)) {
      if (typeof key !== 'string' || key.trim().length === 0) continue;
      upsert.run(key, String(value));
    }

    // Return the full settings after update
    const rows = db
      .prepare('SELECT key, value FROM settings')
      .all() as Array<{ key: string; value: string }>;

    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    return c.json(settings);
  });

  return app;
}
