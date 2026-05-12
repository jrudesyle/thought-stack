/**
 * Tauri API client for ThoughtStack.
 *
 * Wraps Tauri's `invoke()` with the same typed interface as electron-client.ts
 * so the API barrel can swap transports without touching React components.
 */
import { invoke } from '@tauri-apps/api/core';

// ── Types (identical to electron-client.ts) ────────────────────────────────

export interface NoteData {
  id: string;
  title: string;
  content: string;
  path: string;
  notebook: string;
  tags: string[];
  created: string;
  modified: string;
  isTrashed: boolean;
}

export interface NoteSummary {
  id: string;
  title: string;
  path: string;
  notebook: string;
  tags: string[];
  created: string;
  modified: string;
  snippet: string;
}

export interface NotebookInfo {
  name: string;
  path: string;
  stack: string | null;
  noteCount: number;
}

export interface TagInfo {
  name: string;
  noteCount: number;
}

export interface SearchResult {
  noteId: string;
  title: string;
  snippet: string;
  notebook: string;
  tags: string[];
  modified: string;
  rank: number;
}

export interface AppSettings {
  vaultPath: string;
  theme: 'light' | 'dark' | 'system';
  autoSaveDelayMs: number;
  recentVaults: string[];
}

export interface ConflictFile {
  conflictPath: string;
  originalPath: string;
  provider: 'google-drive' | 'icloud' | 'dropbox' | 'onedrive' | 'unknown';
}

export interface MigrationSummary {
  notebooks: number;
  notes: number;
  tags: number;
  images: number;
  errors: string[];
}

// ── Notes API ──────────────────────────────────────────────────────────────

export const notes = {
  list(params?: { notebook?: string; tag?: string; trash?: boolean }): Promise<NoteSummary[]> {
    return invoke('notes_list', params ?? {});
  },

  get(notePath: string): Promise<NoteData> {
    return invoke('notes_get', { path: notePath });
  },

  create(notebook: string, title?: string): Promise<NoteData> {
    return invoke('notes_create', { notebook, title: title ?? null });
  },

  save(notePath: string, title: string, content: string, tags: string[]): Promise<NoteData> {
    return invoke('notes_save', { path: notePath, title, content, tags });
  },

  delete(notePath: string): Promise<boolean> {
    return invoke('notes_delete', { path: notePath });
  },

  move(fromPath: string, toNotebook: string): Promise<NoteData> {
    return invoke('notes_move', { fromPath, toNotebook });
  },

  duplicate(notePath: string): Promise<NoteData> {
    return invoke('notes_duplicate', { path: notePath });
  },

  restore(trashPath: string, targetNotebook?: string): Promise<NoteData> {
    return invoke('notes_restore', { trashPath, targetNotebook: targetNotebook ?? null });
  },

  permanentDelete(trashPath: string): Promise<boolean> {
    return invoke('notes_permanent_delete', { trashPath });
  },

  emptyTrash(): Promise<number> {
    return invoke('notes_empty_trash');
  },
};

// ── Notebooks API ──────────────────────────────────────────────────────────

export const notebooks = {
  list(): Promise<NotebookInfo[]> {
    return invoke('notebooks_list');
  },

  create(name: string, stack?: string): Promise<NotebookInfo> {
    return invoke('notebooks_create', { name, stack: stack ?? null });
  },

  rename(oldPath: string, newName: string): Promise<NotebookInfo> {
    return invoke('notebooks_rename', { oldPath, newName });
  },

  delete(notebookPath: string): Promise<boolean> {
    return invoke('notebooks_delete', { path: notebookPath });
  },

  move(notebookPath: string, targetStack?: string): Promise<NotebookInfo> {
    return invoke('notebooks_move', { path: notebookPath, targetStack: targetStack ?? null });
  },
};

// ── Tags API ───────────────────────────────────────────────────────────────

export const tags = {
  list(): Promise<TagInfo[]> {
    return invoke('tags_list');
  },

  rename(oldName: string, newName: string): Promise<number> {
    return invoke('tags_rename', { oldName, newName });
  },

  autocomplete(prefix: string): Promise<TagInfo[]> {
    return invoke('tags_autocomplete', { prefix });
  },
};

// ── Search API ─────────────────────────────────────────────────────────────

export const search = {
  query(q: string, filters?: { notebook?: string; tag?: string }): Promise<SearchResult[]> {
    return invoke('search_query', { q, ...(filters ?? {}) });
  },

  rebuildIndex(): Promise<{ count: number }> {
    return invoke<number>('search_rebuild_index').then((count) => ({ count }));
  },
};

// ── System API ─────────────────────────────────────────────────────────────

export const system = {
  getVaultPath(): Promise<string> {
    return invoke('system_get_vault_path');
  },

  setVaultPath(path: string): Promise<{ success: boolean }> {
    return invoke('system_set_vault_path', { path });
  },

  pickVaultFolder(): Promise<string | null> {
    return invoke('system_pick_vault_folder');
  },

  getVaultOptions(): Promise<{ internal: string; external: string | null }> {
    return invoke('system_get_vault_options');
  },

  getSettings(): Promise<AppSettings> {
    return invoke('system_get_settings');
  },

  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    return invoke('system_update_settings', { updates: settings });
  },

  // Deferred — not yet implemented in Rust
  exportVault(): Promise<unknown> {
    return Promise.reject(new Error('exportVault not yet implemented in Tauri'));
  },

  importData(_data: unknown): Promise<{ success: boolean }> {
    return Promise.reject(new Error('importData not yet implemented in Tauri'));
  },

  migrate(_dbPath: string, _vaultPath: string): Promise<MigrationSummary> {
    return Promise.reject(new Error('migrate not yet implemented in Tauri'));
  },

  pickDatabaseFile(): Promise<string | null> {
    return Promise.reject(new Error('pickDatabaseFile not yet implemented in Tauri'));
  },
};

// ── Images API ─────────────────────────────────────────────────────────────

export const images = {
  async save(
    notebook: string,
    imageData: ArrayBuffer,
    mimeType: string,
  ): Promise<{ path: string }> {
    // Convert ArrayBuffer to number array for Tauri serialization
    const bytes = Array.from(new Uint8Array(imageData));
    return invoke('images_save', { notebook, imageData: bytes, mimeType });
  },
};

// ── Conflicts API ──────────────────────────────────────────────────────────

export const conflicts = {
  detect(): Promise<ConflictFile[]> {
    return invoke('conflicts_detect');
  },
};
