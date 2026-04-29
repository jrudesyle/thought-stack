import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { initDatabase } from './db/index.ts';
import { createApp } from './app.ts';

/**
 * Server configuration loaded from config.json.
 */
interface ServerConfig {
  port: number;
  dbPath: string;
  pluginsDir: string;
}

/**
 * Loads and validates configuration from config.json.
 * Falls back to sensible defaults if fields are missing.
 */
function loadConfig(configPath: string): ServerConfig {
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ServerConfig>;

    return {
      port: typeof parsed.port === 'number' ? parsed.port : 3000,
      dbPath: typeof parsed.dbPath === 'string' ? parsed.dbPath : './data/notes.db',
      pluginsDir: typeof parsed.pluginsDir === 'string' ? parsed.pluginsDir : './plugins',
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn('config.json not found, using defaults');
      return { port: 3000, dbPath: './data/notes.db', pluginsDir: './plugins' };
    }
    console.error(`Failed to load config.json: ${(err as Error).message}`);
    process.exit(1);
  }
}

/**
 * Main entry point. Loads configuration, initializes the database,
 * creates the Hono app, and starts the HTTP server.
 */
function main(): void {
  const configPath = resolve('config.json');
  const config = loadConfig(configPath);

  // Initialize database
  const db = initDatabase(config.dbPath);

  // Create the Hono app with all routes and middleware
  const app = createApp(db);

  // Log configuration summary (Requirement 13.3)
  console.log('Starting ThoughtRepo...');
  console.log(`  Database: ${resolve(config.dbPath)}`);
  console.log(`  Plugins:  ${resolve(config.pluginsDir)}`);
  console.log(`  Port:     ${config.port}`);

  // Start the HTTP server
  try {
    serve(
      {
        fetch: app.fetch,
        port: config.port,
      },
      (info) => {
        console.log(`\nServer running at http://localhost:${info.port}`);
      }
    );
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'EADDRINUSE') {
      console.error(`Error: Port ${config.port} is already in use. Choose a different port in config.json.`);
      process.exit(1);
    }
    throw err;
  }
}

main();
