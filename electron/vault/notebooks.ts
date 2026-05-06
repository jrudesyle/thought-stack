import fs from 'node:fs';
import path from 'node:path';
import { resolveVaultPath } from './index';
import { softDelete } from './trash';
import { readIgnorePatterns, addIgnorePattern, isIgnored } from './ignore';

export interface NotebookInfo {
  name: string;
  path: string;
  stack: string | null;
  noteCount: number;
}

export { addIgnorePattern };

const EXCLUDED_DIRS = new Set(['.thoughtstack', '.trash', '.images']);

/**
 * Creates a notebook directory. If stack is provided, creates inside the stack directory.
 */
export function createNotebook(vaultPath: string, name: string, stack?: string): NotebookInfo {
  const resolved = resolveVaultPath(vaultPath);

  let notebookRelPath: string;
  if (stack) {
    notebookRelPath = path.join(stack, name);
  } else {
    notebookRelPath = name;
  }

  const fullPath = path.join(resolved, notebookRelPath);
  fs.mkdirSync(fullPath, { recursive: true });

  return {
    name,
    path: notebookRelPath,
    stack: stack ?? null,
    noteCount: 0,
  };
}

/**
 * Renames a notebook directory.
 */
export function renameNotebook(
  vaultPath: string,
  oldPath: string,
  newName: string
): NotebookInfo {
  const resolved = resolveVaultPath(vaultPath);
  const oldFullPath = path.join(resolved, oldPath);
  const parentDir = path.dirname(oldFullPath);
  const newFullPath = path.join(parentDir, newName);

  fs.renameSync(oldFullPath, newFullPath);

  const newRelPath = path.relative(resolved, newFullPath);
  const stack = path.dirname(newRelPath);

  // Count .md files
  const noteCount = countMdFiles(newFullPath);

  return {
    name: newName,
    path: newRelPath,
    stack: stack === '.' ? null : stack,
    noteCount,
  };
}

/**
 * Deletes a notebook directory. Moves all notes to .trash/ first, then removes the directory.
 */
export function deleteNotebook(vaultPath: string, notebookPath: string): boolean {
  const resolved = resolveVaultPath(vaultPath);
  const fullPath = path.join(resolved, notebookPath);

  if (!fs.existsSync(fullPath)) return false;

  // Move all .md files to trash first
  const entries = fs.readdirSync(fullPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const notePath = path.join(notebookPath, entry.name);
      softDelete(vaultPath, notePath);
    }
  }

  // Remove the directory (and any remaining non-md files like .images/)
  fs.rmSync(fullPath, { recursive: true, force: true });

  return true;
}

/**
 * Moves a notebook directory to a different stack (or to vault root if targetStack is undefined).
 */
export function moveNotebook(
  vaultPath: string,
  notebookPath: string,
  targetStack?: string
): NotebookInfo {
  const resolved = resolveVaultPath(vaultPath);
  const oldFullPath = path.join(resolved, notebookPath);
  const name = path.basename(notebookPath);

  let newRelPath: string;
  if (targetStack) {
    newRelPath = path.join(targetStack, name);
  } else {
    newRelPath = name;
  }

  const newFullPath = path.join(resolved, newRelPath);

  // Ensure target parent exists
  fs.mkdirSync(path.dirname(newFullPath), { recursive: true });

  fs.renameSync(oldFullPath, newFullPath);

  const noteCount = countMdFiles(newFullPath);

  return {
    name,
    path: newRelPath,
    stack: targetStack ?? null,
    noteCount,
  };
}

/**
 * Lists directories in the vault, excluding .thoughtstack, .trash, .images.
 * Handles both top-level notebooks and notebooks inside stacks.
 */
export function listNotebooks(vaultPath: string): NotebookInfo[] {
  const resolved = resolveVaultPath(vaultPath);
  const ignorePatterns = readIgnorePatterns(resolved);
  const results: NotebookInfo[] = [];

  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;
    if (isIgnored(ignorePatterns, entry.name)) continue;

    const dirPath = path.join(resolved, entry.name);

    // Check if this directory contains .md files (it's a notebook)
    // or only subdirectories (it's a stack)
    const subEntries = fs.readdirSync(dirPath, { withFileTypes: true });
    const hasMdFiles = subEntries.some((e) => e.isFile() && e.name.endsWith('.md'));
    const hasSubDirs = subEntries.some(
      (e) => e.isDirectory() && !e.name.startsWith('.')
    );

    if (hasMdFiles || !hasSubDirs) {
      results.push({
        name: entry.name,
        path: entry.name,
        stack: null,
        noteCount: countMdFiles(dirPath),
      });
    }

    // If it has subdirectories, those are notebooks in a stack
    if (hasSubDirs) {
      for (const subEntry of subEntries) {
        if (!subEntry.isDirectory()) continue;
        if (subEntry.name.startsWith('.')) continue;

        const relPath = path.join(entry.name, subEntry.name).replace(/\\/g, '/');
        if (isIgnored(ignorePatterns, relPath)) continue;

        const subDirPath = path.join(dirPath, subEntry.name);
        results.push({
          name: subEntry.name,
          path: relPath,
          stack: entry.name,
          noteCount: countMdFiles(subDirPath),
        });
      }
    }
  }

  return results;
}

function countMdFiles(directory: string): number {
  try {
    const entries = fs.readdirSync(directory);
    return entries.filter((e) => e.endsWith('.md')).length;
  } catch {
    return 0;
  }
}
