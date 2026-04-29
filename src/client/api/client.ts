/**
 * Typed API client for ThoughtRepo.
 *
 * Handles error responses, parses the ApiError format, logs errors to console,
 * and provides retry with exponential backoff for auto-save failures.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface ApiError {
  error: {
    code: string;
    message: string;
    field?: string;
    details?: unknown;
  };
}

export interface Notebook {
  id: string;
  name: string;
  stack_id: string | null;
  stack_name?: string | null;
  note_count?: number;
  created_at: string;
  updated_at: string;
}

export interface NotebookStack {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  notebook_id: string;
  is_trashed: number;
  trashed_at: string | null;
  original_notebook_id: string | null;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
}

export interface Tag {
  id: string;
  name: string;
  note_count?: number;
  created_at: string;
}

export interface SearchResult {
  noteId: string;
  title: string;
  snippet: string;
  notebookName: string;
  tags: string[];
  updatedAt: string;
  rank: number;
}

export interface SearchResponse {
  results: SearchResult[];
  message: string | null;
}

export interface ExportData {
  version: number;
  exportedAt: string;
  stacks: Array<{ id: string; name: string }>;
  notebooks: Array<{ id: string; name: string; stackId: string | null }>;
  notes: Array<{
    id: string;
    title: string;
    content: object;
    notebookId: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  tags: Array<{ id: string; name: string }>;
}

export interface ImportResult {
  imported: { stacks: number; notebooks: number; notes: number; tags: number; total: number };
  errors: Array<{ index: number; type: string; message: string }>;
  message: string;
}

export interface Plugin {
  name: string;
  version: string;
  description: string | null;
  enabled: boolean;
  extensionPoints: Array<{ type: string }>;
}

// ── Error handling ─────────────────────────────────────────────────

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public apiError: ApiError['error'],
  ) {
    super(apiError.message);
    this.name = 'ApiRequestError';
  }
}

// ── Core fetch wrapper ─────────────────────────────────────────────

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path.startsWith('/') ? path : `/${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Handle no-content responses
  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json();

  if (!response.ok && response.status !== 207) {
    const apiError = data as ApiError;
    if (apiError?.error) {
      console.error(
        `[API ${response.status}] ${apiError.error.code}: ${apiError.error.message}`,
      );
      throw new ApiRequestError(response.status, apiError.error);
    }
    // Fallback for non-standard error responses
    const fallbackError = { code: 'UNKNOWN_ERROR', message: `Request failed with status ${response.status}` };
    console.error(`[API ${response.status}] ${fallbackError.message}`);
    throw new ApiRequestError(response.status, fallbackError);
  }

  return data as T;
}

// ── Retry with exponential backoff ─────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

async function requestWithRetry<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await request<T>(path, options);
    } catch (err) {
      lastError = err;

      // Don't retry client errors (4xx) — only retry network/server errors
      if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500) {
        throw err;
      }

      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// ── Notebooks API ──────────────────────────────────────────────────

export const notebooks = {
  list(): Promise<Notebook[]> {
    return request<Notebook[]>('/api/notebooks');
  },

  create(name: string, stackId?: string | null): Promise<Notebook> {
    return request<Notebook>('/api/notebooks', {
      method: 'POST',
      body: JSON.stringify({ name, stackId }),
    });
  },

  update(id: string, updates: { name?: string; stackId?: string | null }): Promise<Notebook> {
    return request<Notebook>(`/api/notebooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  delete(id: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/notebooks/${id}`, {
      method: 'DELETE',
    });
  },
};

// ── Notebook Stacks API ────────────────────────────────────────────

export const stacks = {
  create(name: string): Promise<NotebookStack> {
    return request<NotebookStack>('/api/notebook-stacks', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  update(id: string, name: string): Promise<NotebookStack> {
    return request<NotebookStack>(`/api/notebook-stacks/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  },

  delete(id: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/notebook-stacks/${id}`, {
      method: 'DELETE',
    });
  },
};

// ── Notes API ──────────────────────────────────────────────────────

export const notes = {
  list(params?: { notebookId?: string; tagId?: string; trash?: boolean }): Promise<Note[]> {
    const searchParams = new URLSearchParams();
    if (params?.notebookId) searchParams.set('notebookId', params.notebookId);
    if (params?.tagId) searchParams.set('tagId', params.tagId);
    if (params?.trash) searchParams.set('trash', 'true');
    const qs = searchParams.toString();
    return request<Note[]>(`/api/notes${qs ? `?${qs}` : ''}`);
  },

  get(id: string): Promise<Note> {
    return request<Note>(`/api/notes/${id}`);
  },

  create(notebookId: string, title?: string, content?: string): Promise<Note> {
    return request<Note>('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ notebookId, title, content }),
    });
  },

  /** Update with retry + exponential backoff for auto-save resilience. */
  update(id: string, updates: { title?: string; content?: string }): Promise<Note> {
    return requestWithRetry<Note>(`/api/notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  delete(id: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/notes/${id}`, {
      method: 'DELETE',
    });
  },

  duplicate(id: string): Promise<Note> {
    return request<Note>(`/api/notes/${id}/duplicate`, {
      method: 'POST',
    });
  },

  move(id: string, notebookId: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/notes/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ notebookId }),
    });
  },

  restore(id: string, notebookId?: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/notes/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ notebookId }),
    });
  },

  permanentDelete(id: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/notes/${id}/permanent`, {
      method: 'DELETE',
    });
  },

  emptyTrash(): Promise<{ success: boolean; deleted: number }> {
    return request<{ success: boolean; deleted: number }>('/api/notes/trash', {
      method: 'DELETE',
    });
  },
};

// ── Tags API ───────────────────────────────────────────────────────

export const tags = {
  list(): Promise<Tag[]> {
    return request<Tag[]>('/api/tags');
  },

  create(name: string): Promise<Tag> {
    return request<Tag>('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  rename(id: string, name: string): Promise<Tag> {
    return request<Tag>(`/api/tags/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  },

  delete(id: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/tags/${id}`, {
      method: 'DELETE',
    });
  },

  addToNote(noteId: string, tagName: string): Promise<Tag> {
    return request<Tag>(`/api/notes/${noteId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ name: tagName }),
    });
  },

  removeFromNote(noteId: string, tagId: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/notes/${noteId}/tags/${tagId}`, {
      method: 'DELETE',
    });
  },

  autocomplete(query: string): Promise<Tag[]> {
    return request<Tag[]>(`/api/tags/autocomplete?q=${encodeURIComponent(query)}`);
  },
};

// ── Search API ─────────────────────────────────────────────────────

export const search = {
  query(
    q: string,
    filters?: { notebookId?: string; tagId?: string },
  ): Promise<SearchResponse> {
    const searchParams = new URLSearchParams({ q });
    if (filters?.notebookId) searchParams.set('notebookId', filters.notebookId);
    if (filters?.tagId) searchParams.set('tagId', filters.tagId);
    return request<SearchResponse>(`/api/search?${searchParams.toString()}`);
  },
};

// ── System API ─────────────────────────────────────────────────────

export const system = {
  health(): Promise<{ status: string }> {
    return request<{ status: string }>('/api/system/health');
  },

  exportData(): Promise<ExportData> {
    return request<ExportData>('/api/system/export', { method: 'POST' });
  },

  importData(data: ExportData): Promise<ImportResult> {
    return request<ImportResult>('/api/system/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getSettings(): Promise<Record<string, string>> {
    return request<Record<string, string>>('/api/system/settings');
  },

  updateSettings(settings: Record<string, string>): Promise<Record<string, string>> {
    return request<Record<string, string>>('/api/system/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },
};

// ── Plugins API ────────────────────────────────────────────────────

export const plugins = {
  list(): Promise<Plugin[]> {
    return request<Plugin[]>('/api/plugins');
  },

  enable(name: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/plugins/${name}/enable`, {
      method: 'PUT',
    });
  },

  disable(name: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/plugins/${name}/disable`, {
      method: 'PUT',
    });
  },
};
