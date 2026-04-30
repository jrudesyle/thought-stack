import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';
import { createNote, getNote, saveNote, listNotes, deleteNote, moveNote, duplicateNote } from '../vault/notes';
import { restore, permanentDelete, emptyTrash } from '../vault/trash';
import { updateNoteIndex } from '../index/index';

/**
 * Registers IPC handlers for all note-related channels.
 * Accepts getter functions so handlers always use the current vault path and db,
 * even if the vault is changed after registration (e.g., first-run flow).
 */
export function registerNoteHandlers(
  getVaultPath: () => string,
  getDb: () => Database.Database
): void {
  ipcMain.handle('notes:list', async (_event, params?: { notebook?: string; tag?: string; trash?: boolean }) => {
    try {
      return listNotes(getVaultPath(), params);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('notes:get', async (_event, notePath: string) => {
    try {
      return getNote(getVaultPath(), notePath);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('notes:save', async (_event, notePath: string, title: string, content: string, tags: string[]) => {
    try {
      const vaultPath = getVaultPath();
      const db = getDb();
      const result = saveNote(vaultPath, notePath, title, content, tags);
      updateNoteIndex(db, vaultPath, result.path);
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('notes:create', async (_event, notebook: string, title: string) => {
    try {
      const vaultPath = getVaultPath();
      const db = getDb();
      const result = createNote(vaultPath, notebook, title);
      updateNoteIndex(db, vaultPath, result.path);
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('notes:delete', async (_event, notePath: string) => {
    try {
      return deleteNote(getVaultPath(), notePath);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('notes:move', async (_event, fromPath: string, toNotebook: string) => {
    try {
      const vaultPath = getVaultPath();
      const db = getDb();
      const result = moveNote(vaultPath, fromPath, toNotebook);
      updateNoteIndex(db, vaultPath, result.path);
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('notes:duplicate', async (_event, notePath: string) => {
    try {
      const vaultPath = getVaultPath();
      const db = getDb();
      const result = duplicateNote(vaultPath, notePath);
      updateNoteIndex(db, vaultPath, result.path);
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('notes:restore', async (_event, trashFilename: string, targetNotebook?: string) => {
    try {
      const vaultPath = getVaultPath();
      const db = getDb();
      const result = restore(vaultPath, trashFilename, targetNotebook);
      updateNoteIndex(db, vaultPath, result.path);
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('notes:permanentDelete', async (_event, trashFilename: string) => {
    try {
      return permanentDelete(getVaultPath(), trashFilename);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('notes:emptyTrash', async () => {
    try {
      return emptyTrash(getVaultPath());
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
