import { ipcMain } from 'electron';
import { detectConflicts } from '../vault/conflicts';

/**
 * Registers IPC handlers for conflict detection.
 */
export function registerConflictHandlers(getVaultPath: () => string): void {
  ipcMain.handle('conflicts:detect', async () => {
    try {
      const vaultPath = getVaultPath();
      return detectConflicts(vaultPath);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
