/**
 * API barrel file — auto-detects the runtime environment.
 *
 * Priority:
 *   1. Tauri  — window.__TAURI_INTERNALS__ injected by Tauri runtime
 *   2. Electron — window.electronAPI exposed by preload script
 *   3. FSA (PWA) — File System Access API available (Chrome/Edge desktop/Android)
 *   4. HTTP — plain browser / HTTP server mode (fallback)
 */

// Re-export types from electron-client (identical across all clients)
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

// Export the isVaultReady helper for the PWA setup screen
export { isVaultReady, hasStoredVault, reconnectVault } from './fsa-client';

import * as tauriClient from './tauri-client';
import * as electronClient from './electron-client';
import * as fsaClient from './fsa-client';
import * as httpClient from './http-client';

const isTauri =
  typeof window !== 'undefined' &&
  typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';

const isElectron =
  typeof window !== 'undefined' &&
  typeof (window as any).electronAPI !== 'undefined';

const isFSA =
  typeof window !== 'undefined' &&
  typeof (window as any).showDirectoryPicker === 'function';

const client = isTauri ? tauriClient
  : isElectron ? electronClient
  : isFSA ? fsaClient
  : httpClient;

export const notes = client.notes;
export const notebooks = client.notebooks;
export const tags = client.tags;
export const search = client.search;
export const system = client.system;
export const images = client.images;
export const conflicts = client.conflicts;
