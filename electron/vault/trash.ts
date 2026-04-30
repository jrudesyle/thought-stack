import fs from 'node:fs';
import path from 'node:path';
import { resolveVaultPath } from './index';
import { parseFrontmatter } from './markdown';
import { titleFromFilename } from './sanitize';
import type { NoteData, NoteSummary } from './notes';

const TRASH_DIR = '.trash';
const TRASH_META_FILE = '.trash-meta.json';

export interface TrashMeta {
  items: Array<{
    id: string;
    originalPath: string;
    trashedAt: string;
  }>;
}

function readTrashMeta(vaultRoot: string): TrashMeta {
  const metaPath = path.join(vaultRoot, TRASH_DIR, TRASH_META_FILE);
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(raw) as TrashMeta;
  } catch {
    return { items: [] };
  }
}

function writeTrashMeta(vaultRoot: string, meta: TrashMeta): void {
  const trashDir = path.join(vaultRoot, TRASH_DIR);
  fs.mkdirSync(trashDir, { recursive: true });
  const metaPath = path.join(trashDir, TRASH_META_FILE);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

/**
 * Moves a .md file to .trash/, updates .trash-meta.json with original path and timestamp.
 */
export function softDelete(vaultPath: string, notePath: string): boolean {
  const resolved = resolveVaultPath(vaultPath);
  const srcFullPath = path.join(resolved, notePath);

  if (!fs.existsSync(srcFullPath)) return false;

  // Read the note to get its id
  const fileContent = fs.readFileSync(srcFullPath, 'utf-8');
  const { data } = parseFrontmatter(fileContent);

  // Ensure .trash/ exists
  const trashDir = path.join(resolved, TRASH_DIR);
  fs.mkdirSync(trashDir, { recursive: true });

  // Move file to .trash/
  const filename = path.basename(notePath);
  const destPath = path.join(trashDir, filename);

  // Handle filename conflicts in trash
  let finalFilename = filename;
  if (fs.existsSync(destPath)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    let counter = 2;
    while (fs.existsSync(path.join(trashDir, `${base} ${counter}${ext}`))) {
      counter++;
    }
    finalFilename = `${base} ${counter}${ext}`;
  }

  fs.renameSync(srcFullPath, path.join(trashDir, finalFilename));

  // Update trash meta
  const meta = readTrashMeta(resolved);
  meta.items.push({
    id: data.id,
    originalPath: notePath,
    trashedAt: new Date().toISOString(),
  });
  writeTrashMeta(resolved, meta);

  return true;
}

/**
 * Reads original path from meta, moves file back to its original location.
 * If targetNotebook is provided, restores to that notebook instead.
 */
export function restore(
  vaultPath: string,
  trashFilename: string,
  targetNotebook?: string
): NoteData {
  const resolved = resolveVaultPath(vaultPath);
  const trashDir = path.join(resolved, TRASH_DIR);
  const trashFilePath = path.join(trashDir, trashFilename);

  if (!fs.existsSync(trashFilePath)) {
    throw new Error(`Trashed file not found: ${trashFilename}`);
  }

  // Read the file content
  const fileContent = fs.readFileSync(trashFilePath, 'utf-8');
  const { data, content } = parseFrontmatter(fileContent);

  // Find the meta entry
  const meta = readTrashMeta(resolved);
  const metaIndex = meta.items.findIndex(
    (item) => item.id === data.id || path.basename(item.originalPath) === trashFilename
  );

  let restorePath: string;

  if (targetNotebook) {
    // Restore to specified notebook
    const targetDir = path.join(resolved, targetNotebook);
    fs.mkdirSync(targetDir, { recursive: true });
    restorePath = path.join(targetNotebook, trashFilename);
  } else if (metaIndex >= 0) {
    // Restore to original path
    restorePath = meta.items[metaIndex].originalPath;
    const restoreDir = path.join(resolved, path.dirname(restorePath));
    if (!fs.existsSync(restoreDir)) {
      throw new Error(
        `Original notebook directory no longer exists: ${path.dirname(restorePath)}`
      );
    }
  } else {
    throw new Error(`No metadata found for trashed file: ${trashFilename}`);
  }

  const fullRestorePath = path.join(resolved, restorePath);

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(fullRestorePath), { recursive: true });

  // Move file back
  fs.renameSync(trashFilePath, fullRestorePath);

  // Remove meta entry
  if (metaIndex >= 0) {
    meta.items.splice(metaIndex, 1);
    writeTrashMeta(resolved, meta);
  }

  const title = titleFromFilename(path.basename(restorePath));
  const notebook = path.dirname(restorePath).split(path.sep)[0];

  return {
    id: data.id,
    title,
    content,
    path: restorePath,
    notebook,
    tags: data.tags,
    created: data.created,
    modified: data.modified,
    isTrashed: false,
  };
}

/**
 * Permanently removes a file from .trash/ and its meta entry.
 */
export function permanentDelete(vaultPath: string, trashFilename: string): boolean {
  const resolved = resolveVaultPath(vaultPath);
  const trashDir = path.join(resolved, TRASH_DIR);
  const filePath = path.join(trashDir, trashFilename);

  if (!fs.existsSync(filePath)) return false;

  // Read file to get id for meta removal
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const { data } = parseFrontmatter(fileContent);

  // Delete the file
  fs.unlinkSync(filePath);

  // Remove meta entry
  const meta = readTrashMeta(resolved);
  meta.items = meta.items.filter((item) => item.id !== data.id);
  writeTrashMeta(resolved, meta);

  return true;
}

/**
 * Deletes all files in .trash/, clears meta, returns count of deleted files.
 */
export function emptyTrash(vaultPath: string): number {
  const resolved = resolveVaultPath(vaultPath);
  const trashDir = path.join(resolved, TRASH_DIR);

  if (!fs.existsSync(trashDir)) return 0;

  const entries = fs.readdirSync(trashDir);
  let count = 0;

  for (const entry of entries) {
    if (entry === TRASH_META_FILE) continue;
    const filePath = path.join(trashDir, entry);
    try {
      fs.unlinkSync(filePath);
      count++;
    } catch {
      // Skip files that can't be deleted
    }
  }

  // Clear meta
  writeTrashMeta(resolved, { items: [] });

  return count;
}

/**
 * Lists trashed notes with original path info.
 */
export function listTrash(vaultPath: string): NoteSummary[] {
  const resolved = resolveVaultPath(vaultPath);
  const trashDir = path.join(resolved, TRASH_DIR);

  if (!fs.existsSync(trashDir)) return [];

  const meta = readTrashMeta(resolved);
  const results: NoteSummary[] = [];

  const entries = fs.readdirSync(trashDir);
  for (const entry of entries) {
    if (entry === TRASH_META_FILE) continue;
    if (!entry.endsWith('.md')) continue;

    const filePath = path.join(trashDir, entry);
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const { data, content } = parseFrontmatter(fileContent);
      const title = titleFromFilename(entry);

      // Find original path from meta
      const metaItem = meta.items.find((item) => item.id === data.id);
      const originalNotebook = metaItem
        ? path.dirname(metaItem.originalPath).split(path.sep)[0]
        : '.trash';

      results.push({
        id: data.id,
        title,
        path: path.join('.trash', entry),
        notebook: originalNotebook,
        tags: data.tags,
        created: data.created,
        modified: data.modified,
        snippet: content.slice(0, 200).trim(),
      });
    } catch {
      // Skip files that can't be parsed
    }
  }

  results.sort((a, b) => b.modified.localeCompare(a.modified));
  return results;
}
