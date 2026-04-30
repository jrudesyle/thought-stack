import { ipcMain } from 'electron';
import { saveImage } from '../vault/images';

/**
 * Registers IPC handlers for image-related channels.
 * Accepts a getter function for lazy access to the current vault path.
 */
export function registerImageHandlers(getVaultPath: () => string): void {
  ipcMain.handle('images:save', async (_event, notebook: string, imageData: ArrayBuffer, mimeType: string) => {
    try {
      const buffer = Buffer.from(imageData);
      const relativePath = saveImage(getVaultPath(), notebook, buffer, mimeType);
      return { path: relativePath };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
