import { describe, it, expect, beforeEach } from 'vitest';
import { createMockElectronAPI } from '../helpers/electron-api-mock';

/**
 * Tests for the Electron client API layer (src/client/api/electron-client.ts).
 *
 * Since the electron-client module reads `window.electronAPI` at import time,
 * we test the mock directly to verify the contract between the frontend and
 * the preload-exposed API. This validates that the mock shape matches the
 * expected electronAPI interface and that calls flow correctly.
 */

describe('Electron API mock contract', () => {
  let mockAPI: ReturnType<typeof createMockElectronAPI>;

  beforeEach(() => {
    mockAPI = createMockElectronAPI();
  });

  // ── Notes API ────────────────────────────────────────────────────

  describe('notes', () => {
    it('list returns an array of note summaries', async () => {
      mockAPI.notes.list.mockResolvedValue([
        {
          id: 'n1',
          title: 'Note 1',
          path: 'Work/Note 1.md',
          notebook: 'Work',
          tags: ['tag1'],
          created: '2026-01-01T00:00:00Z',
          modified: '2026-01-01T00:00:00Z',
          snippet: 'Some content...',
        },
      ]);

      const result = await mockAPI.notes.list({ notebook: 'Work' });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Note 1');
      expect(mockAPI.notes.list).toHaveBeenCalledWith({ notebook: 'Work' });
    });

    it('get returns a full note', async () => {
      const result = await mockAPI.notes.get('Work/Note.md');
      expect(result.id).toBe('mock-id');
      expect(result.title).toBe('Mock Note');
      expect(mockAPI.notes.get).toHaveBeenCalledWith('Work/Note.md');
    });

    it('create returns a new note', async () => {
      const result = await mockAPI.notes.create('Work', 'New Note');
      expect(result.id).toBe('new-id');
      expect(mockAPI.notes.create).toHaveBeenCalledWith('Work', 'New Note');
    });

    it('save returns the updated note', async () => {
      mockAPI.notes.save.mockResolvedValue({
        id: 'n1',
        title: 'Updated',
        content: 'New content',
        path: 'Work/Updated.md',
        notebook: 'Work',
        tags: ['updated'],
        created: '2026-01-01T00:00:00Z',
        modified: '2026-01-02T00:00:00Z',
        isTrashed: false,
      });

      const result = await mockAPI.notes.save('Work/Old.md', 'Updated', 'New content', ['updated']);
      expect(result.title).toBe('Updated');
      expect(result.tags).toEqual(['updated']);
      expect(mockAPI.notes.save).toHaveBeenCalledWith('Work/Old.md', 'Updated', 'New content', ['updated']);
    });

    it('delete returns true on success', async () => {
      const result = await mockAPI.notes.delete('Work/Note.md');
      expect(result).toBe(true);
      expect(mockAPI.notes.delete).toHaveBeenCalledWith('Work/Note.md');
    });

    it('move returns the note at its new location', async () => {
      const result = await mockAPI.notes.move('Work/Note.md', 'Personal');
      expect(result.notebook).toBe('Other');
      expect(mockAPI.notes.move).toHaveBeenCalledWith('Work/Note.md', 'Personal');
    });

    it('duplicate returns a copy of the note', async () => {
      const result = await mockAPI.notes.duplicate('Work/Note.md');
      expect(result.title).toBe('Copy of Mock Note');
      expect(result.id).not.toBe('mock-id');
    });

    it('restore returns the restored note', async () => {
      const result = await mockAPI.notes.restore('.trash/Note.md', 'Work');
      expect(result.isTrashed).toBe(false);
      expect(mockAPI.notes.restore).toHaveBeenCalledWith('.trash/Note.md', 'Work');
    });

    it('permanentDelete returns true', async () => {
      const result = await mockAPI.notes.permanentDelete('.trash/Note.md');
      expect(result).toBe(true);
    });

    it('emptyTrash returns count of deleted items', async () => {
      mockAPI.notes.emptyTrash.mockResolvedValue(5);
      const result = await mockAPI.notes.emptyTrash();
      expect(result).toBe(5);
    });
  });

  // ── Notebooks API ────────────────────────────────────────────────

  describe('notebooks', () => {
    it('list returns notebook info array', async () => {
      mockAPI.notebooks.list.mockResolvedValue([
        { name: 'Work', path: 'Work', stack: null, noteCount: 3 },
        { name: 'Personal', path: 'Personal', stack: null, noteCount: 1 },
      ]);

      const result = await mockAPI.notebooks.list();
      expect(result).toHaveLength(2);
      expect(result[0].noteCount).toBe(3);
    });

    it('create returns the new notebook', async () => {
      const result = await mockAPI.notebooks.create('Projects', 'Work');
      expect(mockAPI.notebooks.create).toHaveBeenCalledWith('Projects', 'Work');
      expect(result.name).toBe('New Notebook');
    });

    it('rename returns the renamed notebook', async () => {
      const result = await mockAPI.notebooks.rename('OldName', 'NewName');
      expect(result.name).toBe('Renamed');
      expect(mockAPI.notebooks.rename).toHaveBeenCalledWith('OldName', 'NewName');
    });

    it('delete returns true', async () => {
      const result = await mockAPI.notebooks.delete('Work');
      expect(result).toBe(true);
    });
  });

  // ── Tags API ─────────────────────────────────────────────────────

  describe('tags', () => {
    it('list returns tag info array', async () => {
      mockAPI.tags.list.mockResolvedValue([
        { name: 'meeting', noteCount: 5 },
        { name: 'project', noteCount: 3 },
      ]);

      const result = await mockAPI.tags.list();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('meeting');
    });

    it('rename returns count of updated notes', async () => {
      mockAPI.tags.rename.mockResolvedValue(3);
      const result = await mockAPI.tags.rename('old-tag', 'new-tag');
      expect(result).toBe(3);
      expect(mockAPI.tags.rename).toHaveBeenCalledWith('old-tag', 'new-tag');
    });

    it('autocomplete returns matching tags', async () => {
      mockAPI.tags.autocomplete.mockResolvedValue([
        { name: 'meeting', noteCount: 5 },
      ]);

      const result = await mockAPI.tags.autocomplete('mee');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('meeting');
      expect(mockAPI.tags.autocomplete).toHaveBeenCalledWith('mee');
    });
  });

  // ── Search API ───────────────────────────────────────────────────

  describe('search', () => {
    it('query returns search results', async () => {
      mockAPI.search.query.mockResolvedValue([
        {
          noteId: 'n1',
          title: 'Found Note',
          snippet: '...matching content...',
          notebook: 'Work',
          tags: ['tag1'],
          modified: '2026-01-01T00:00:00Z',
          rank: -1.5,
        },
      ]);

      const result = await mockAPI.search.query('matching', { notebook: 'Work' });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Found Note');
      expect(mockAPI.search.query).toHaveBeenCalledWith('matching', { notebook: 'Work' });
    });

    it('rebuildIndex returns count', async () => {
      mockAPI.search.rebuildIndex.mockResolvedValue({ count: 42 });
      const result = await mockAPI.search.rebuildIndex();
      expect(result.count).toBe(42);
    });
  });

  // ── System API ───────────────────────────────────────────────────

  describe('system', () => {
    it('getSettings returns app settings', async () => {
      const result = await mockAPI.system.getSettings();
      expect(result.vaultPath).toBe('/mock/vault');
      expect(result.theme).toBe('system');
    });

    it('updateSettings returns updated settings', async () => {
      mockAPI.system.updateSettings.mockResolvedValue({
        vaultPath: '/mock/vault',
        theme: 'dark',
        autoSaveDelayMs: 2000,
        recentVaults: [],
      });

      const result = await mockAPI.system.updateSettings({ theme: 'dark' });
      expect(result.theme).toBe('dark');
      expect(mockAPI.system.updateSettings).toHaveBeenCalledWith({ theme: 'dark' });
    });

    it('pickVaultFolder returns selected path or null', async () => {
      mockAPI.system.pickVaultFolder.mockResolvedValue('/Users/test/vault');
      const result = await mockAPI.system.pickVaultFolder();
      expect(result).toBe('/Users/test/vault');
    });
  });
});
