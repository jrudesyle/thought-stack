/**
 * HTTP API client for ThoughtStack.
 *
 * Drop-in replacement for electron-client.ts that uses fetch() instead of
 * window.electronAPI. Exports the same interface so components can import
 * from the barrel `../api` without caring which transport is active.
 */

// ── Types (re-exported so consumers don't need to know the source) ─

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

// ── Core fetch wrapper ─────────────────────────────────────────────

const BASE = ''; // Vite proxy handles /api → localhost:3000

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    let message: string;
    try {
      const parsed = JSON.parse(body);
      message = parsed.error ?? body;
    } catch {
      message = body;
    }
    throw new Error(`HTTP ${res.status}: ${message}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function encodePath(p: string): string {
  // Encode each segment so slashes in note paths are preserved
  return p.split('/').map(encodeURIComponent).join('/');
}

// ── Notes API ──────────────────────────────────────────────────────

export const notes = {
  list(params?: { notebook?: string; tag?: string; trash?: boolean }): Promise<NoteSummary[]> {
    const sp = new URLSearchParams();
    if (params?.notebook) sp.set('notebook', params.notebook);
    if (params?.tag) sp.set('tag', params.tag);
    if (params?.trash) sp.set('trash', 'true');
    const qs = sp.toString();
    return request<NoteSummary[]>(`/api/notes${qs ? `?${qs}` : ''}`);
  },

  get(notePath: string): Promise<NoteData> {
    return request<NoteData>(`/api/notes/${encodePath(notePath)}`);
  },

  create(notebook: string, title?: string): Promise<NoteData> {
    return request<NoteData>('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ notebook, title: title ?? '' }),
    });
  },

  save(notePath: string, title: string, content: string, tags: string[]): Promise<NoteData> {
    return request<NoteData>(`/api/notes/${encodePath(notePath)}`, {
      method: 'PUT',
      body: JSON.stringify({ title, content, tags }),
    });
  },

  delete(notePath: string): Promise<boolean> {
    return request<{ success: boolean }>(`/api/notes/${encodePath(notePath)}`, {
      method: 'DELETE',
    }).then(r => r.success);
  },

  move(fromPath: string, toNotebook: string): Promise<NoteData> {
    return request<NoteData>(`/api/notes/${encodePath(fromPath)}/move`, {
      method: 'POST',
      body: JSON.stringify({ toNotebook }),
    });
  },

  duplicate(notePath: string): Promise<NoteData> {
    return request<NoteData>(`/api/notes/${encodePath(notePath)}/duplicate`, {
      method: 'POST',
    });
  },

  restore(trashPath: string, targetNotebook?: string): Promise<NoteData> {
    return request<NoteData>(`/api/notes/${encodePath(trashPath)}/restore`, {
      method: 'POST',
      body: JSON.stringify({ targetNotebook }),
    });
  },

  permanentDelete(trashPath: string): Promise<boolean> {
    return request<{ success: boolean }>(`/api/notes/${encodePath(trashPath)}/permanent`, {
      method: 'DELETE',
    }).then(r => r.success);
  },

  emptyTrash(): Promise<number> {
    return request<{ count: number }>('/api/notes/empty-trash', {
      method: 'POST',
    }).then(r => r.count);
  },
};

// ── Notebooks API ──────────────────────────────────────────────────

export const notebooks = {
  list(): Promise<NotebookInfo[]> {
    return request<NotebookInfo[]>('/api/notebooks');
  },

  create(name: string, stack?: string): Promise<NotebookInfo> {
    return request<NotebookInfo>('/api/notebooks', {
      method: 'POST',
      body: JSON.stringify({ name, stack }),
    });
  },

  rename(oldPath: string, newName: string): Promise<NotebookInfo> {
    return request<NotebookInfo>(`/api/notebooks/${encodePath(oldPath)}`, {
      method: 'PUT',
      body: JSON.stringify({ newName }),
    });
  },

  delete(notebookPath: string): Promise<boolean> {
    return request<{ success: boolean }>(`/api/notebooks/${encodePath(notebookPath)}`, {
      method: 'DELETE',
    }).then(r => r.success);
  },

  move(notebookPath: string, targetStack?: string): Promise<NotebookInfo> {
    // Not exposed via HTTP server yet — stub for interface compatibility
    throw new Error('notebooks.move() is not available in HTTP mode');
  },

  ignore(notebookPath: string): Promise<boolean> {
    return request<{ success: boolean }>('/api/notebooks/ignore', {
      method: 'POST',
      body: JSON.stringify({ notebookPath }),
    }).then(r => r.success);
  },
};

// ── Tags API ───────────────────────────────────────────────────────

export const tags = {
  list(): Promise<TagInfo[]> {
    return request<TagInfo[]>('/api/tags');
  },

  rename(oldName: string, newName: string): Promise<number> {
    return request<{ count: number }>(`/api/tags/${encodeURIComponent(oldName)}`, {
      method: 'PUT',
      body: JSON.stringify({ newName }),
    }).then(r => r.count);
  },

  autocomplete(prefix: string): Promise<TagInfo[]> {
    return request<TagInfo[]>(`/api/tags/autocomplete?prefix=${encodeURIComponent(prefix)}`);
  },
};

// ── Search API ─────────────────────────────────────────────────────

export const search = {
  query(q: string, filters?: { notebook?: string; tag?: string }): Promise<SearchResult[]> {
    const sp = new URLSearchParams({ q });
    if (filters?.notebook) sp.set('notebook', filters.notebook);
    if (filters?.tag) sp.set('tag', filters.tag);
    return request<SearchResult[]>(`/api/search?${sp.toString()}`);
  },

  rebuildIndex(): Promise<{ count: number }> {
    return request<{ count: number }>('/api/search/rebuild', { method: 'POST' });
  },
};

// ── System API ─────────────────────────────────────────────────────

export const system = {
  getVaultPath(): Promise<string> {
    return request<AppSettings>('/api/system/settings').then(s => s.vaultPath);
  },

  setVaultPath(_vaultPath: string): Promise<{ success: boolean }> {
    // In HTTP mode, vault path is set server-side via env var
    return Promise.resolve({ success: true });
  },

  pickVaultFolder(): Promise<string | null> {
    // No native dialog in browser mode
    return Promise.resolve(null);
  },

  getSettings(): Promise<AppSettings> {
    return request<AppSettings>('/api/system/settings');
  },

  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    return request<AppSettings>('/api/system/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  exportVault(): Promise<unknown> {
    // In HTTP mode, export isn't supported via native dialog
    return Promise.resolve({ error: 'Export not available in browser mode' });
  },

  importData(_data: unknown): Promise<{ success: boolean }> {
    // In HTTP mode, import isn't supported via native dialog
    return Promise.resolve({ success: false });
  },

  migrate(_dbPath: string, _vaultPath: string): Promise<MigrationSummary> {
    return Promise.resolve({ notebooks: 0, notes: 0, tags: 0, images: 0, errors: ['Migration not available in browser mode'] });
  },

  pickDatabaseFile(): Promise<string | null> {
    return Promise.resolve(null);
  },
};

// ── Images API ─────────────────────────────────────────────────────

export const images = {
  async save(notebook: string, imageData: ArrayBuffer, mimeType: string): Promise<{ path: string }> {
    // Convert ArrayBuffer to base64 for JSON transport
    const bytes = new Uint8Array(imageData);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    return request<{ path: string }>('/api/images', {
      method: 'POST',
      body: JSON.stringify({ notebook, imageData: base64, mimeType }),
    });
  },
};

// ── Conflicts API ──────────────────────────────────────────────────

export const conflicts = {
  detect(): Promise<ConflictFile[]> {
    return request<ConflictFile[]>('/api/conflicts');
  },
};
