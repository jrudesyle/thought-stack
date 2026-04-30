import { ipcMain } from 'electron';
import {
  listNotebooks,
  createNotebook,
  renameNotebook,
  deleteNotebook,
  moveNotebook,
} from '../vault/notebooks';

/**
 * Registers IPC handlers for all notebook-related channels.
 * Accepts a getter function so the handler always uses the current vault path.
 */
export function registerNotebookHandlers(getVaultPath: () => string): void {
  ipcMain.handle('notebooks:list', async () => {
    try {
      return listNotebooks(getVaultPath());
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('notebooks:create', async (_event, name: string, stack?: string) => {
    try {
      return createNotebook(getVaultPath(), name, stack);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('notebooks:rename', async (_event, oldPath: string, newName: string) => {
    try {
      return renameNotebook(getVaultPath(), oldPath, newName);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('notebooks:delete', async (_event, notebookPath: string) => {
    try {
      return deleteNotebook(getVaultPath(), notebookPath);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('notebooks:move', async (_event, notebookPath: string, targetStack?: string) => {
    try {
      return moveNotebook(getVaultPath(), notebookPath, targetStack);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
