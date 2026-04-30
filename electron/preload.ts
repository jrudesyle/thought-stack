import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script — runs in an isolated context before the renderer loads.
 * Uses contextBridge to expose a typed electronAPI to the renderer process.
 *
 * Placeholder methods for now — real IPC handlers are registered in later tasks.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  notes: {
    list: (params?: Record<string, unknown>) => ipcRenderer.invoke('notes:list', params),
    get: (notePath: string) => ipcRenderer.invoke('notes:get', notePath),
    save: (notePath: string, title: string, content: string, tags: string[]) =>
      ipcRenderer.invoke('notes:save', notePath, title, content, tags),
    create: (notebook: string, title: string) =>
      ipcRenderer.invoke('notes:create', notebook, title),
    delete: (notePath: string) => ipcRenderer.invoke('notes:delete', notePath),
    move: (fromPath: string, toNotebook: string) =>
      ipcRenderer.invoke('notes:move', fromPath, toNotebook),
    duplicate: (notePath: string) => ipcRenderer.invoke('notes:duplicate', notePath),
    restore: (trashPath: string, targetNotebook?: string) =>
      ipcRenderer.invoke('notes:restore', trashPath, targetNotebook),
    permanentDelete: (trashPath: string) =>
      ipcRenderer.invoke('notes:permanentDelete', trashPath),
    emptyTrash: () => ipcRenderer.invoke('notes:emptyTrash'),
  },
  notebooks: {
    list: () => ipcRenderer.invoke('notebooks:list'),
    create: (name: string, stack?: string) =>
      ipcRenderer.invoke('notebooks:create', name, stack),
    rename: (oldPath: string, newName: string) =>
      ipcRenderer.invoke('notebooks:rename', oldPath, newName),
    delete: (notebookPath: string) => ipcRenderer.invoke('notebooks:delete', notebookPath),
    move: (notebookPath: string, targetStack?: string) =>
      ipcRenderer.invoke('notebooks:move', notebookPath, targetStack),
  },
  tags: {
    list: () => ipcRenderer.invoke('tags:list'),
    rename: (oldName: string, newName: string) =>
      ipcRenderer.invoke('tags:rename', oldName, newName),
    autocomplete: (prefix: string) => ipcRenderer.invoke('tags:autocomplete', prefix),
  },
  search: {
    query: (q: string, filters?: Record<string, unknown>) =>
      ipcRenderer.invoke('search:query', q, filters),
    rebuildIndex: () => ipcRenderer.invoke('search:rebuildIndex'),
  },
  system: {
    getVaultPath: () => ipcRenderer.invoke('system:getVaultPath'),
    setVaultPath: (vaultPath: string) =>
      ipcRenderer.invoke('system:setVaultPath', vaultPath),
    pickVaultFolder: () => ipcRenderer.invoke('system:pickVaultFolder'),
    getSettings: () => ipcRenderer.invoke('system:getSettings'),
    updateSettings: (settings: Record<string, unknown>) =>
      ipcRenderer.invoke('system:updateSettings', settings),
    exportVault: () => ipcRenderer.invoke('system:exportVault'),
    importData: (data: unknown) => ipcRenderer.invoke('system:importData', data),
    migrate: (dbPath: string, vaultPath: string) =>
      ipcRenderer.invoke('system:migrate', dbPath, vaultPath),
    pickDatabaseFile: () => ipcRenderer.invoke('system:pickDatabaseFile'),
  },
  images: {
    save: (notebook: string, imageData: ArrayBuffer, mimeType: string) =>
      ipcRenderer.invoke('images:save', notebook, imageData, mimeType),
  },
  conflicts: {
    detect: () => ipcRenderer.invoke('conflicts:detect'),
  },
});
