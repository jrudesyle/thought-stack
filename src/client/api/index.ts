/**
 * API barrel file — auto-detects the runtime environment.
 *
 * Priority:
 *   1. Tauri  — window.__TAURI_INTERNALS__ injected by Tauri runtime
 *   2. Electron — window.electronAPI exposed by preload script
 *   3. FSA (PWA) — File System Access API available (Chrome/Edge desktop/Android)
 *   4. OPFS — Origin Private File System (iOS Safari 15.2+, Firefox, others lacking FSA picker)
 *   5. HTTP — plain browser / HTTP server mode (fallback)
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
export { isVaultReady, hasStoredVault, reconnectVault, invalidateVaultHandle, isOPFSAvailable, initOPFS } from './fsa-client';

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

const isOPFS =
  !isTauri && !isElectron && !isFSA &&
  typeof navigator !== 'undefined' &&
  typeof (navigator.storage as any)?.getDirectory === 'function';

// FSA and OPFS share the same client — OPFS just uses navigator.storage.getDirectory()
// instead of showDirectoryPicker() to obtain the root handle.
const client = isTauri ? tauriClient
  : isElectron ? electronClient
  : isFSA || isOPFS ? fsaClient
  : httpClient;

export const notes = client.notes;
export const notebooks = client.notebooks;
export const tags = client.tags;
export const search = client.search;
export const system = client.system;
export const images = client.images;
export const conflicts = client.conflicts;
