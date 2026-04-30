import { ipcMain, dialog } from 'electron';
import fs from 'node:fs';
import { loadAppConfig, saveAppConfig } from '../config';
import type { AppSettings } from '../config';
import { migrateDatabase } from '../migration/migrate';
import { exportVault } from '../vault/export';
import { importVault } from '../vault/import';
import type { VaultExport } from '../vault/export';

/**
 * Registers IPC handlers for system-related channels.
 * Uses getter/setter functions for vault path so the main process
 * can react to vault path changes.
 */
export function registerSystemHandlers(
  getVaultPath: () => string,
  setVaultPath: (p: string) => void
): void {
  ipcMain.handle('system:getVaultPath', async () => {
    try {
      return getVaultPath();
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('system:setVaultPath', async (_event, vaultPath: string) => {
    try {
      setVaultPath(vaultPath);
      const config = loadAppConfig();
      config.vaultPath = vaultPath;
      // Add to recent vaults if not already present
      if (!config.recentVaults.includes(vaultPath)) {
        config.recentVaults.unshift(vaultPath);
        // Keep only the last 10 recent vaults
        config.recentVaults = config.recentVaults.slice(0, 10);
      }
      saveAppConfig(config);
      return { success: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('system:pickVaultFolder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Vault Folder',
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('system:getSettings', async () => {
    try {
      return loadAppConfig();
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('system:updateSettings', async (_event, settings: Partial<AppSettings>) => {
    try {
      const current = loadAppConfig();
      const updated: AppSettings = {
        vaultPath: typeof settings.vaultPath === 'string' ? settings.vaultPath : current.vaultPath,
        theme: isValidTheme(settings.theme) ? settings.theme : current.theme,
        autoSaveDelayMs: typeof settings.autoSaveDelayMs === 'number' ? settings.autoSaveDelayMs : current.autoSaveDelayMs,
        recentVaults: Array.isArray(settings.recentVaults) ? settings.recentVaults : current.recentVaults,
      };
      saveAppConfig(updated);
      // If vault path changed, update the in-memory reference
      if (settings.vaultPath && settings.vaultPath !== current.vaultPath) {
        setVaultPath(settings.vaultPath);
      }
      return updated;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('system:exportVault', async () => {
    try {
      const vaultPath = getVaultPath();
      const data = exportVault(vaultPath);

      // Show native save dialog
      const result = await dialog.showSaveDialog({
        title: 'Export Vault',
        defaultPath: `thoughtstack-export-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { success: true, path: result.filePath };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('system:importData', async () => {
    try {
      const vaultPath = getVaultPath();

      // Show native open dialog to pick a JSON file
      const result = await dialog.showOpenDialog({
        title: 'Import Vault Data',
        properties: ['openFile'],
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }

      const filePath = result.filePaths[0];
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const data: VaultExport = JSON.parse(fileContent);

      const importResult = importVault(vaultPath, data);
      return {
        success: importResult.errors.length === 0,
        ...importResult,
      };
    } catch (err) {
      return {
        success: false,
        notebooks: 0,
        notes: 0,
        images: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  });

  ipcMain.handle('system:migrate', async (_event, dbPath: string, vaultPath: string) => {
    try {
      const summary = migrateDatabase(dbPath, vaultPath);
      return summary;
    } catch (err) {
      return {
        notebooks: 0,
        notes: 0,
        tags: 0,
        images: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  });

  ipcMain.handle('system:pickDatabaseFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: 'Select ThoughtStack Database',
        filters: [
          { name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}

function isValidTheme(value: unknown): value is 'light' | 'dark' | 'system' {
  return value === 'light' || value === 'dark' || value === 'system';
}
