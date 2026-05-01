/**
 * API barrel file — auto-detects the runtime environment.
 *
 * When running inside Electron, window.electronAPI is available and we use
 * the IPC-based client. In a browser (HTTP server mode), we fall back to
 * the fetch-based HTTP client.
 */

// Re-export types from electron-client (they're identical in both clients)
export type {
  NoteData,
  NoteSummary,
  NotebookInfo,
  TagInfo,
  SearchResult,
  AppSettings,
  ConflictFile,
  MigrationSummary,
} from './electron-client';

// Detect environment and re-export the appropriate client
const isElectron =
  typeof window !== 'undefined' &&
  typeof (window as any).electronAPI !== 'undefined';

// We use dynamic re-exports via a conditional barrel.
// Both modules are statically importable — the bundler tree-shakes the unused one
// in production builds. At runtime we pick the right one.

import * as electronClient from './electron-client';
import * as httpClient from './http-client';

const client = isElectron ? electronClient : httpClient;

export const notes = client.notes;
export const notebooks = client.notebooks;
export const tags = client.tags;
export const search = client.search;
export const system = client.system;
export const images = client.images;
export const conflicts = client.conflicts;
