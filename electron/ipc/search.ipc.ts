import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';
import { searchNotes, rebuildIndexFull } from '../index/index';

/**
 * Registers IPC handlers for search-related channels.
 * Accepts getter functions for lazy access to the current db and vault path.
 */
export function registerSearchHandlers(
  getDb: () => Database.Database,
  getVaultPath: () => string
): void {
  ipcMain.handle('search:query', async (_event, query: string, filters?: { notebook?: string; tag?: string }) => {
    try {
      return searchNotes(getDb(), query, filters);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('search:rebuildIndex', async () => {
    try {
      const count = rebuildIndexFull(getDb(), getVaultPath());
      return { count };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
