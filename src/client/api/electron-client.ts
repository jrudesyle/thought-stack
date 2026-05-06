/**
 * Electron API client for ThoughtStack.
 *
 * Wraps the preload-exposed `window.electronAPI` with typed functions.
 * Replaces the HTTP-based client.ts for the Electron desktop app.
 *
 * Key differences from the HTTP client:
 * - Notes use `path` as identifier instead of `id`
 * - `notes.save()` replaces `notes.update()` — takes path, title, content, tags
 * - `notes.create()` takes notebook name instead of notebookId
 * - `notebooks.list()` returns NotebookInfo (with path, stack, noteCount)
 * - Tags are simpler — no addToNote/removeFromNote (tags managed via note save)
 * - No stacks API (stacks are just parent directories)
 * - Search returns SearchResult[] directly instead of SearchResponse wrapper
 */

// ── Types ──────────────────────────────────────────────────────────

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

// ── Global type declaration for the preload-exposed API ────────────

declare global {
  interface Window {
    electronAPI: {
      notes: {
        list: (params?: Record<string, unknown>) => Promise<NoteSummary[]>;
        get: (path: string) => Promise<NoteData>;
        save: (path: string, title: string, content: string, tags: string[]) => Promise<NoteData>;
        create: (notebook: string, title: string) => Promise<NoteData>;
        delete: (path: string) => Promise<boolean>;
        move: (fromPath: string, toNotebook: string) => Promise<NoteData>;
        duplicate: (path: string) => Promise<NoteData>;
        restore: (trashPath: string, targetNotebook?: string) => Promise<NoteData>;
        permanentDelete: (trashPath: string) => Promise<boolean>;
        emptyTrash: () => Promise<number>;
      };
      notebooks: {
        list: () => Promise<NotebookInfo[]>;
        create: (name: string, stack?: string) => Promise<NotebookInfo>;
        rename: (oldPath: string, newName: string) => Promise<NotebookInfo>;
        delete: (path: string) => Promise<boolean>;
        move: (path: string, targetStack?: string) => Promise<NotebookInfo>;
      };
      tags: {
        list: () => Promise<TagInfo[]>;
        rename: (oldName: string, newName: string) => Promise<number>;
        autocomplete: (prefix: string) => Promise<TagInfo[]>;
      };
      search: {
        query: (q: string, filters?: Record<string, unknown>) => Promise<SearchResult[]>;
        rebuildIndex: () => Promise<{ count: number }>;
      };
      system: {
        getVaultPath: () => Promise<string>;
        setVaultPath: (path: string) => Promise<{ success: boolean }>;
        pickVaultFolder: () => Promise<string | null>;
        getSettings: () => Promise<AppSettings>;
        updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
        exportVault: () => Promise<unknown>;
        importData: (data: unknown) => Promise<{ success: boolean }>;
        migrate: (dbPath: string, vaultPath: string) => Promise<MigrationSummary>;
        pickDatabaseFile: () => Promise<string | null>;
      };
      images: {
        save: (notebook: string, imageData: ArrayBuffer, mimeType: string) => Promise<{ path: string }>;
      };
      conflicts: {
        detect: () => Promise<ConflictFile[]>;
      };
    };
  }
}

// ── API access ─────────────────────────────────────────────────────

// Lazy access — only evaluated when a method is actually called.
// This prevents crashes when the barrel imports this module in browser mode
// where window.electronAPI is undefined.
function getApi() {
  return window.electronAPI;
}
const api = new Proxy({} as Window['electronAPI'], {
  get(_target, prop) {
    return getApi()[prop as keyof Window['electronAPI']];
  },
});

// ── Notes API ──────────────────────────────────────────────────────

export const notes = {
  list(params?: { notebook?: string; tag?: string; trash?: boolean }): Promise<NoteSummary[]> {
    return api.notes.list(params ?? {});
  },

  get(notePath: string): Promise<NoteData> {
    return api.notes.get(notePath);
  },

  create(notebook: string, title?: string): Promise<NoteData> {
    return api.notes.create(notebook, title ?? '');
  },

  save(notePath: string, title: string, content: string, tags: string[]): Promise<NoteData> {
    return api.notes.save(notePath, title, content, tags);
  },

  delete(notePath: string): Promise<boolean> {
    return api.notes.delete(notePath);
  },

  move(fromPath: string, toNotebook: string): Promise<NoteData> {
    return api.notes.move(fromPath, toNotebook);
  },

  duplicate(notePath: string): Promise<NoteData> {
    return api.notes.duplicate(notePath);
  },

  restore(trashPath: string, targetNotebook?: string): Promise<NoteData> {
    return api.notes.restore(trashPath, targetNotebook);
  },

  permanentDelete(trashPath: string): Promise<boolean> {
    return api.notes.permanentDelete(trashPath);
  },

  emptyTrash(): Promise<number> {
    return api.notes.emptyTrash();
  },
};

// ── Notebooks API ──────────────────────────────────────────────────

export const notebooks = {
  list(): Promise<NotebookInfo[]> {
    return api.notebooks.list();
  },

  create(name: string, stack?: string): Promise<NotebookInfo> {
    return api.notebooks.create(name, stack);
  },

  rename(oldPath: string, newName: string): Promise<NotebookInfo> {
    return api.notebooks.rename(oldPath, newName);
  },

  delete(notebookPath: string): Promise<boolean> {
    return api.notebooks.delete(notebookPath);
  },

  move(notebookPath: string, targetStack?: string): Promise<NotebookInfo> {
    return api.notebooks.move(notebookPath, targetStack);
  },

  ignore(notebookPath: string): Promise<boolean> {
    return api.notebooks.ignore(notebookPath);
  },
};

// ── Tags API ───────────────────────────────────────────────────────

export const tags = {
  list(): Promise<TagInfo[]> {
    return api.tags.list();
  },

  rename(oldName: string, newName: string): Promise<number> {
    return api.tags.rename(oldName, newName);
  },

  autocomplete(prefix: string): Promise<TagInfo[]> {
    return api.tags.autocomplete(prefix);
  },
};

// ── Search API ─────────────────────────────────────────────────────

export const search = {
  query(q: string, filters?: { notebook?: string; tag?: string }): Promise<SearchResult[]> {
    return api.search.query(q, filters);
  },

  rebuildIndex(): Promise<{ count: number }> {
    return api.search.rebuildIndex();
  },
};

// ── System API ─────────────────────────────────────────────────────

export const system = {
  getVaultPath(): Promise<string> {
    return api.system.getVaultPath();
  },

  setVaultPath(vaultPath: string): Promise<{ success: boolean }> {
    return api.system.setVaultPath(vaultPath);
  },

  pickVaultFolder(): Promise<string | null> {
    return api.system.pickVaultFolder();
  },

  getSettings(): Promise<AppSettings> {
    return api.system.getSettings();
  },

  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    return api.system.updateSettings(settings);
  },

  exportVault(): Promise<unknown> {
    return api.system.exportVault();
  },

  importData(data: unknown): Promise<{ success: boolean }> {
    return api.system.importData(data);
  },

  migrate(dbPath: string, vaultPath: string): Promise<MigrationSummary> {
    return api.system.migrate(dbPath, vaultPath);
  },

  pickDatabaseFile(): Promise<string | null> {
    return api.system.pickDatabaseFile();
  },
};

// ── Images API ─────────────────────────────────────────────────────

export const images = {
  save(notebook: string, imageData: ArrayBuffer, mimeType: string): Promise<{ path: string }> {
    return api.images.save(notebook, imageData, mimeType);
  },
};

// ── Conflicts API ──────────────────────────────────────────────────

export const conflicts = {
  detect(): Promise<ConflictFile[]> {
    return api.conflicts.detect();
  },
};
