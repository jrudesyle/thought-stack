import { app, BrowserWindow, protocol, net } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadAppConfig, saveAppConfig } from './config';
import { initializeVault } from './vault/index';
import { ensureSearchIndex } from './index/index';
import { registerNoteHandlers } from './ipc/notes.ipc';
import { registerNotebookHandlers } from './ipc/notebooks.ipc';
import { registerTagHandlers } from './ipc/tags.ipc';
import { registerSearchHandlers } from './ipc/search.ipc';
import { registerSystemHandlers } from './ipc/system.ipc';
import { registerImageHandlers } from './ipc/images.ipc';
import { registerConflictHandlers } from './ipc/conflicts.ipc';
import type Database from 'better-sqlite3';

// Determine if we're running in development mode
const isDev = !app.isPackaged;

// Register the vault:// protocol scheme as privileged before app is ready.
// This must happen synchronously at module load time (before app.whenReady()).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vault',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  },
]);

// In-memory vault path and database reference
let currentVaultPath = '';
let searchDb: Database.Database | null = null;

function getVaultPath(): string {
  if (!currentVaultPath) {
    throw new Error('Vault path not configured. Please select a vault folder first.');
  }
  return currentVaultPath;
}

function getDb(): Database.Database {
  if (!searchDb) {
    throw new Error('Search index not initialized. Please set a vault path first.');
  }
  return searchDb;
}

function setVaultPath(newPath: string): void {
  currentVaultPath = newPath;
  try {
    initializeVault(newPath);
    searchDb = ensureSearchIndex(newPath);
  } catch (err) {
    console.error('Failed to switch vault:', err);
  }
}

/**
 * Registers the vault:// custom protocol handler.
 *
 * The protocol resolves URLs of the form:
 *   vault://<notebook>/.images/<filename>
 *
 * to the corresponding file on disk within the current vault directory.
 * This allows the renderer to display local images referenced in Markdown
 * notes (e.g., `![alt](.images/abc123.png)`) without disabling web security.
 *
 * The handler validates that the resolved path is within the vault directory
 * to prevent path traversal attacks.
 */
function registerVaultProtocol(): void {
  protocol.handle('vault', (request) => {
    // Parse the URL: vault://notebook/.images/filename
    // The URL format is vault://<path-within-vault>
    const url = new URL(request.url);

    // Combine host + pathname to get the full relative path.
    // For vault://Meeting Notes/.images/abc.png:
    //   host = "meeting notes" (lowercased by URL parser)
    //   pathname = "/.images/abc.png"
    // Instead, we strip the scheme and reconstruct from the raw URL.
    const relativePath = decodeURIComponent(
      request.url.replace(/^vault:\/\//, '')
    );

    if (!currentVaultPath) {
      return new Response('Vault not configured', { status: 503 });
    }

    const resolvedVault = path.resolve(currentVaultPath);
    const filePath = path.resolve(resolvedVault, relativePath);

    // Security: ensure the resolved path is within the vault directory
    if (!filePath.startsWith(resolvedVault + path.sep) && filePath !== resolvedVault) {
      return new Response('Forbidden: path traversal detected', { status: 403 });
    }

    // Check file exists
    if (!fs.existsSync(filePath)) {
      return new Response('File not found', { status: 404 });
    }

    // Use net.fetch with file:// URL to serve the file
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, 'preload.js');

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Show window when ready to avoid visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    // In dev mode, load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // In production, load the built frontend from disk
    const indexPath = path.join(__dirname, '..', 'dist', 'client', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  return mainWindow;
}

app.whenReady().then(() => {
  // Load persisted config
  const config = loadAppConfig();
  currentVaultPath = config.vaultPath;

  // Initialize vault and search index if a vault path is configured
  if (currentVaultPath) {
    try {
      initializeVault(currentVaultPath);
      searchDb = ensureSearchIndex(currentVaultPath);
    } catch (err) {
      console.error('Failed to initialize vault or search index:', err);
    }
  }

  // Register the vault:// protocol handler.
  // Maps vault://images/<notebook>/.images/<filename> to the actual file on disk.
  // This allows the renderer to load local image files from the vault directory
  // without disabling web security or context isolation.
  registerVaultProtocol();

  // Register all IPC handlers with getter functions.
  // Handlers lazily access the current vault path and db, so they work
  // even when the vault is configured after app launch (first-run flow).
  registerNoteHandlers(getVaultPath, getDb);
  registerNotebookHandlers(getVaultPath);
  registerTagHandlers(getVaultPath);
  registerSearchHandlers(getDb, getVaultPath);
  registerSystemHandlers(() => currentVaultPath, setVaultPath);
  registerImageHandlers(getVaultPath);
  registerConflictHandlers(getVaultPath);

  createWindow();

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
