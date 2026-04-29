import { Hono } from 'hono';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { Database } from '../db/index.ts';
import type { PluginRegistry } from '../plugins/registry.ts';

/**
 * MIME type lookup for common static asset extensions.
 */
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

/**
 * Creates plugin API routes.
 *
 * Endpoints:
 *   GET    /plugins                    — list all plugins with enabled/disabled status
 *   PUT    /plugins/:name/enable       — enable a plugin
 *   PUT    /plugins/:name/disable      — disable a plugin
 *   GET    /plugins/:name/assets/*     — serve plugin static assets
 */
export function createPluginsRoutes(db: Database, registry: PluginRegistry): Hono {
  const app = new Hono();

  /**
   * GET /plugins — list all plugins with their status.
   */
  app.get('/plugins', (c) => {
    const plugins = registry.getLoadedPlugins().map((p) => ({
      name: p.name,
      version: p.version,
      description: p.description ?? null,
      enabled: p.enabled,
      extensionPoints: p.extensions,
    }));
    return c.json(plugins);
  });

  /**
   * PUT /plugins/:name/enable — enable a plugin.
   */
  app.put('/plugins/:name/enable', (c) => {
    const { name } = c.req.param();
    const success = registry.enablePlugin(name);

    if (!success) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Plugin '${name}' not found`,
          },
        },
        404,
      );
    }

    return c.json({ success: true });
  });

  /**
   * PUT /plugins/:name/disable — disable a plugin.
   */
  app.put('/plugins/:name/disable', (c) => {
    const { name } = c.req.param();
    const success = registry.disablePlugin(name);

    if (!success) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Plugin '${name}' not found`,
          },
        },
        404,
      );
    }

    return c.json({ success: true });
  });

  /**
   * GET /plugins/:name/assets/* — serve plugin static assets.
   *
   * The asset path is resolved relative to the plugin's directory.
   * Path traversal is prevented by checking the resolved path stays
   * within the plugin directory.
   */
  app.get('/plugins/:name/assets/*', (c) => {
    const { name } = c.req.param();
    const pluginDir = registry.getPluginDir(name);

    if (!pluginDir) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Plugin '${name}' not found`,
          },
        },
        404,
      );
    }

    // Extract the asset path from the URL after /assets/
    const url = new URL(c.req.url);
    const prefix = `/plugins/${name}/assets/`;
    // Also check with /api prefix since routes are mounted under /api
    const apiPrefix = `/api/plugins/${name}/assets/`;
    let assetPath: string;
    if (url.pathname.startsWith(apiPrefix)) {
      assetPath = decodeURIComponent(url.pathname.slice(apiPrefix.length));
    } else if (url.pathname.startsWith(prefix)) {
      assetPath = decodeURIComponent(url.pathname.slice(prefix.length));
    } else {
      assetPath = '';
    }

    if (!assetPath) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Asset path is required',
          },
        },
        400,
      );
    }

    // Resolve and check for path traversal
    const fullPath = join(pluginDir, assetPath);
    if (!fullPath.startsWith(pluginDir)) {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Path traversal is not allowed',
          },
        },
        403,
      );
    }

    if (!existsSync(fullPath)) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Asset '${assetPath}' not found in plugin '${name}'`,
          },
        },
        404,
      );
    }

    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) {
        return c.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: `Asset '${assetPath}' not found in plugin '${name}'`,
            },
          },
          404,
        );
      }

      const ext = extname(fullPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const data = readFileSync(fullPath);

      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': contentType },
      });
    } catch {
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to read asset',
          },
        },
        500,
      );
    }
  });

  return app;
}
