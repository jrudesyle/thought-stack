/**
 * Mock implementation of window.electronAPI for frontend testing.
 *
 * Each method returns a vi.fn() so tests can configure return values
 * and assert on calls. Use `createMockElectronAPI()` to get a fresh
 * mock, then assign it to `window.electronAPI` in your test setup.
 */
import { vi } from 'vitest';

export function createMockElectronAPI() {
  return {
    notes: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({
        id: 'mock-id',
        title: 'Mock Note',
        content: '',
        path: 'Notebook/Mock Note.md',
        notebook: 'Notebook',
        tags: [],
        created: '2026-01-01T00:00:00Z',
        modified: '2026-01-01T00:00:00Z',
        isTrashed: false,
      }),
      save: vi.fn().mockResolvedValue({
        id: 'mock-id',
        title: 'Mock Note',
        content: '',
        path: 'Notebook/Mock Note.md',
        notebook: 'Notebook',
        tags: [],
        created: '2026-01-01T00:00:00Z',
        modified: '2026-01-01T00:00:00Z',
        isTrashed: false,
      }),
      create: vi.fn().mockResolvedValue({
        id: 'new-id',
        title: 'Untitled',
        content: '',
        path: 'Notebook/Untitled.md',
        notebook: 'Notebook',
        tags: [],
        created: '2026-01-01T00:00:00Z',
        modified: '2026-01-01T00:00:00Z',
        isTrashed: false,
      }),
      delete: vi.fn().mockResolvedValue(true),
      move: vi.fn().mockResolvedValue({
        id: 'mock-id',
        title: 'Mock Note',
        content: '',
        path: 'Other/Mock Note.md',
        notebook: 'Other',
        tags: [],
        created: '2026-01-01T00:00:00Z',
        modified: '2026-01-01T00:00:00Z',
        isTrashed: false,
      }),
      duplicate: vi.fn().mockResolvedValue({
        id: 'dup-id',
        title: 'Copy of Mock Note',
        content: '',
        path: 'Notebook/Copy of Mock Note.md',
        notebook: 'Notebook',
        tags: [],
        created: '2026-01-01T00:00:00Z',
        modified: '2026-01-01T00:00:00Z',
        isTrashed: false,
      }),
      restore: vi.fn().mockResolvedValue({
        id: 'mock-id',
        title: 'Mock Note',
        content: '',
        path: 'Notebook/Mock Note.md',
        notebook: 'Notebook',
        tags: [],
        created: '2026-01-01T00:00:00Z',
        modified: '2026-01-01T00:00:00Z',
        isTrashed: false,
      }),
      permanentDelete: vi.fn().mockResolvedValue(true),
      emptyTrash: vi.fn().mockResolvedValue(0),
    },
    notebooks: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        name: 'New Notebook',
        path: 'New Notebook',
        stack: null,
        noteCount: 0,
      }),
      rename: vi.fn().mockResolvedValue({
        name: 'Renamed',
        path: 'Renamed',
        stack: null,
        noteCount: 0,
      }),
      delete: vi.fn().mockResolvedValue(true),
      move: vi.fn().mockResolvedValue({
        name: 'Moved',
        path: 'Stack/Moved',
        stack: 'Stack',
        noteCount: 0,
      }),
    },
    tags: {
      list: vi.fn().mockResolvedValue([]),
      rename: vi.fn().mockResolvedValue(0),
      autocomplete: vi.fn().mockResolvedValue([]),
    },
    search: {
      query: vi.fn().mockResolvedValue([]),
      rebuildIndex: vi.fn().mockResolvedValue({ count: 0 }),
    },
    system: {
      getVaultPath: vi.fn().mockResolvedValue('/mock/vault'),
      setVaultPath: vi.fn().mockResolvedValue({ success: true }),
      pickVaultFolder: vi.fn().mockResolvedValue(null),
      getSettings: vi.fn().mockResolvedValue({
        vaultPath: '/mock/vault',
        theme: 'system',
        autoSaveDelayMs: 2000,
        recentVaults: [],
      }),
      updateSettings: vi.fn().mockResolvedValue({
        vaultPath: '/mock/vault',
        theme: 'system',
        autoSaveDelayMs: 2000,
        recentVaults: [],
      }),
      exportVault: vi.fn().mockResolvedValue({}),
      importData: vi.fn().mockResolvedValue({ success: true }),
      migrate: vi.fn().mockResolvedValue({
        notebooks: 0,
        notes: 0,
        tags: 0,
        images: 0,
        errors: [],
      }),
      pickDatabaseFile: vi.fn().mockResolvedValue(null),
    },
    images: {
      save: vi.fn().mockResolvedValue({ path: '.images/mock.png' }),
    },
    conflicts: {
      detect: vi.fn().mockResolvedValue([]),
    },
  };
}

/**
 * Installs the mock electronAPI on the global window object.
 * Returns the mock for assertion purposes.
 */
export function installMockElectronAPI() {
  const mock = createMockElectronAPI();
  (globalThis as Record<string, unknown>).window = {
    ...(globalThis as Record<string, unknown>).window as object,
    electronAPI: mock,
  };
  return mock;
}
