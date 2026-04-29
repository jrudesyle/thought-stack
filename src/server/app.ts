import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Database } from './db/index.ts';
import { createNotebooksRoutes } from './routes/notebooks.routes.ts';
import { createNotesRoutes } from './routes/notes.routes.ts';
import { createTagsRoutes } from './routes/tags.routes.ts';
import { createSearchRoutes } from './routes/search.routes.ts';
import { createPluginsRoutes } from './routes/plugins.routes.ts';
import { createSystemRoutes } from './routes/system.routes.ts';
import { createImagesRoutes } from './routes/images.routes.ts';
import type { PluginRegistry } from './plugins/registry.ts';
import { createPluginRegistry } from './plugins/registry.ts';

/**
 * Creates and configures the Hono application with all middleware and routes.
 *
 * Separated from the server entry point so integration tests can import
 * the app without starting an HTTP server.
 *
 * @param db - Database instance
 * @param registry - Optional PluginRegistry. If not provided, a new one is created.
 */
export function createApp(db: Database, registry?: PluginRegistry): Hono {
  const app = new Hono();

  // Create a default registry if none provided
  const pluginRegistry = registry ?? createPluginRegistry(db);

  // --- Middleware ---
  app.use('*', cors());

  // --- API Routes ---
  const notebooksRoutes = createNotebooksRoutes(db);
  const notesRoutes = createNotesRoutes(db);
  const tagsRoutes = createTagsRoutes(db);
  const searchRoutes = createSearchRoutes(db);
  const pluginsRoutes = createPluginsRoutes(db, pluginRegistry);
  const systemRoutes = createSystemRoutes(db);
  const imagesRoutes = createImagesRoutes(db);

  app.route('/api', notebooksRoutes);
  app.route('/api', notesRoutes);
  app.route('/api', tagsRoutes);
  app.route('/api', searchRoutes);
  app.route('/api', pluginsRoutes);
  app.route('/api', systemRoutes);
  app.route('/api', imagesRoutes);

  // --- Static File Serving ---
  // Serve built React SPA assets from dist/client
  app.use(
    '/*',
    serveStatic({ root: './dist/client' })
  );

  // SPA fallback: serve index.html for any non-API path that doesn't match a static file
  app.get('*', serveStatic({ root: './dist/client', path: 'index.html' }));

  return app;
}
