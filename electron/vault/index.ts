import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const VAULT_META_DIR = '.thoughtstack';
const TRASH_DIR = '.trash';

/**
 * Resolves ~ (home directory) and relative paths to an absolute path.
 */
export function resolveVaultPath(vaultPath: string): string {
  if (vaultPath.startsWith('~')) {
    vaultPath = path.join(os.homedir(), vaultPath.slice(1));
  }
  return path.resolve(vaultPath);
}

/**
 * Checks if a directory exists and contains a .thoughtstack/ metadata directory.
 */
export function validateVault(vaultPath: string): boolean {
  const resolved = resolveVaultPath(vaultPath);
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return false;
    const metaDir = path.join(resolved, VAULT_META_DIR);
    const metaStat = fs.statSync(metaDir);
    return metaStat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Creates the .thoughtstack/ metadata directory, config.json, and .trash/ directory
 * inside the vault. Creates the vault directory itself if it doesn't exist.
 *
 * Also creates a `.nosync` marker file next to `cache.db` so that iCloud Drive
 * will skip syncing the search index. Other cloud providers (Google Drive,
 * Dropbox, OneDrive) require manual exclusion — see CLOUD_SYNC.md at the vault root.
 */
export function initializeVault(vaultPath: string): void {
  const resolved = resolveVaultPath(vaultPath);

  // Create vault root if needed
  fs.mkdirSync(resolved, { recursive: true });

  // Create .thoughtstack/ metadata directory
  const metaDir = path.join(resolved, VAULT_META_DIR);
  fs.mkdirSync(metaDir, { recursive: true });

  // Create vault config
  const configPath = path.join(metaDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    const config = {
      version: 1,
      created: new Date().toISOString(),
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  // Create .nosync marker for cache.db (iCloud respects this convention).
  // The marker tells iCloud Drive not to sync cache.db — each machine
  // rebuilds its own search index from the Markdown files.
  const nosyncPath = path.join(metaDir, 'cache.db.nosync');
  if (!fs.existsSync(nosyncPath)) {
    fs.writeFileSync(nosyncPath, '', 'utf-8');
  }

  // Create .trash/ directory
  const trashDir = path.join(resolved, TRASH_DIR);
  fs.mkdirSync(trashDir, { recursive: true });

  // Write cloud sync documentation if it doesn't exist
  writeSyncExclusionDocs(resolved);
}

/**
 * Checks if a vault has been initialized (has .thoughtstack/ directory).
 */
export function isVaultInitialized(vaultPath: string): boolean {
  return validateVault(vaultPath);
}


/**
 * Writes a CLOUD_SYNC.md documentation file inside .thoughtstack/ explaining
 * how to exclude cache.db from cloud sync for each provider.
 */
function writeSyncExclusionDocs(resolvedVaultPath: string): void {
  const docsPath = path.join(resolvedVaultPath, VAULT_META_DIR, 'CLOUD_SYNC.md');
  if (fs.existsSync(docsPath)) return;

  const content = `# Cloud Sync — Excluding cache.db

The file \`.thoughtstack/cache.db\` is a local search index that each machine
rebuilds automatically from your Markdown files. It should **not** be synced
between devices.

## iCloud Drive
A \`.nosync\` marker file has been created automatically. iCloud will skip
\`cache.db.nosync\` files. No manual action needed.

## Google Drive
1. Right-click the \`.thoughtstack\` folder in Finder / Explorer.
2. Select **"Available offline"** → uncheck it, or use Google Drive's
   selective sync settings to exclude \`.thoughtstack/cache.db\`.

## Dropbox
1. Open Dropbox Preferences → Sync → Selective Sync.
2. Uncheck \`.thoughtstack/cache.db\` (or the entire \`.thoughtstack\` folder).
Alternatively, use Dropbox's "Smart Sync" to set the file to "Online Only".

## OneDrive
1. Right-click \`.thoughtstack/cache.db\` in Explorer.
2. Select **"Free up space"** to keep it online-only.
Or use OneDrive Settings → Account → Choose folders to exclude it.

## Why?
Each device builds its own search index from the Markdown note files on startup.
Syncing the index can cause SQLite corruption when two machines write to it
simultaneously. If the index is ever missing or corrupt, ThoughtStack rebuilds
it automatically.
`;

  fs.writeFileSync(docsPath, content, 'utf-8');
}
