import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveVaultPath } from './index';
import { parseFrontmatter, serializeNote } from './markdown';
import { sanitizeFilename, resolveFilenameConflict, titleFromFilename } from './sanitize';
import { softDelete } from './trash';
import { extractImageReferences, moveImages } from './images';
import { withRetrySync } from './retry';
import { readIgnorePatterns, isIgnored } from './ignore';

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

/**
 * Creates a new note in the specified notebook directory.
 * Generates a hex id, creates the .md file with frontmatter, returns NoteData.
 */
export function createNote(vaultPath: string, notebook: string, title?: string): NoteData {
  const resolved = resolveVaultPath(vaultPath);
  const noteTitle = title && title.trim().length > 0 ? title.trim() : 'Untitled';
  const id = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();

  // Ensure notebook directory exists
  const notebookDir = path.join(resolved, notebook);
  fs.mkdirSync(notebookDir, { recursive: true });

  // Sanitize and resolve filename conflicts
  const sanitized = sanitizeFilename(noteTitle);
  const filename = resolveFilenameConflict(notebookDir, `${sanitized}.md`);

  const content = '';
  const markdown = serializeNote({
    id,
    title: noteTitle,
    tags: [],
    created: now,
    modified: now,
    content,
  });

  const filePath = path.join(notebookDir, filename);
  withRetrySync(() => fs.writeFileSync(filePath, markdown, 'utf-8'));

  const relativePath = path.relative(resolved, filePath);

  return {
    id,
    title: noteTitle,
    content,
    path: relativePath,
    notebook,
    tags: [],
    created: now,
    modified: now,
    isTrashed: false,
  };
}

/**
 * Reads a .md file, parses frontmatter, and returns NoteData.
 */
export function getNote(vaultPath: string, notePath: string): NoteData {
  const resolved = resolveVaultPath(vaultPath);
  const fullPath = path.join(resolved, notePath);

  const fileContent = fs.readFileSync(fullPath, 'utf-8');
  const { data, content } = parseFrontmatter(fileContent);

  const filename = path.basename(notePath);
  const title = titleFromFilename(filename);
  const notebook = path.dirname(notePath).split(path.sep)[0];
  const isTrashed = notePath.startsWith('.trash' + path.sep) || notePath.startsWith('.trash/');

  return {
    id: data.id,
    title,
    content,
    path: notePath,
    notebook: isTrashed ? '.trash' : notebook,
    tags: data.tags,
    created: data.created,
    modified: data.modified,
    isTrashed,
  };
}

/**
 * Writes an updated .md file. Handles title rename (file rename) and updates modified timestamp.
 */
export function saveNote(
  vaultPath: string,
  notePath: string,
  title: string,
  content: string,
  tags: string[]
): NoteData {
  const resolved = resolveVaultPath(vaultPath);
  const fullPath = path.join(resolved, notePath);

  // Read existing frontmatter to preserve id, created, and extra fields
  const existingContent = fs.readFileSync(fullPath, 'utf-8');
  const { data: existingData } = parseFrontmatter(existingContent);

  const now = new Date().toISOString();

  // Build note data preserving extra frontmatter fields
  const noteForSerialization: Record<string, unknown> = {
    id: existingData.id,
    title,
    tags,
    created: existingData.created,
    modified: now,
    content,
  };

  // Preserve extra unknown fields
  const knownKeys = new Set(['id', 'tags', 'created', 'modified']);
  for (const key of Object.keys(existingData)) {
    if (!knownKeys.has(key)) {
      noteForSerialization[key] = existingData[key];
    }
  }

  const markdown = serializeNote(noteForSerialization as {
    id: string;
    title: string;
    tags: string[];
    created: string;
    modified: string;
    content: string;
  });

  // Check if title changed — need to rename file
  const currentFilename = path.basename(notePath);
  const currentTitle = titleFromFilename(currentFilename);
  const notebookDir = path.join(resolved, path.dirname(notePath));

  let finalPath = notePath;

  if (title !== currentTitle) {
    const sanitized = sanitizeFilename(title);
    const newFilename = resolveFilenameConflict(notebookDir, `${sanitized}.md`);
    const newFullPath = path.join(notebookDir, newFilename);

    // Write to new path, remove old file
    withRetrySync(() => fs.writeFileSync(newFullPath, markdown, 'utf-8'));
    fs.unlinkSync(fullPath);

    finalPath = path.relative(resolved, newFullPath);
  } else {
    withRetrySync(() => fs.writeFileSync(fullPath, markdown, 'utf-8'));
  }

  const notebook = path.dirname(finalPath).split(path.sep)[0];

  return {
    id: existingData.id,
    title,
    content,
    path: finalPath,
    notebook,
    tags,
    created: existingData.created,
    modified: now,
    isTrashed: false,
  };
}

/**
 * Scans directories for .md files, parses frontmatter, returns sorted by modified desc.
 */
export function listNotes(
  vaultPath: string,
  options?: { notebook?: string; tag?: string; trash?: boolean }
): NoteSummary[] {
  const resolved = resolveVaultPath(vaultPath);
  const results: NoteSummary[] = [];

  if (options?.trash) {
    // List notes in .trash/
    const trashDir = path.join(resolved, '.trash');
    if (fs.existsSync(trashDir)) {
      collectNotes(resolved, trashDir, results);
    }
    results.sort((a, b) => b.modified.localeCompare(a.modified));
    return results;
  }

  if (options?.notebook) {
    // List notes in a specific notebook
    const notebookDir = path.join(resolved, options.notebook);
    if (fs.existsSync(notebookDir)) {
      collectNotes(resolved, notebookDir, results);
    }
  } else {
    // List notes across all notebooks
    const ignorePatterns = readIgnorePatterns(resolved);
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (['.thoughtstack', '.trash', '.images'].includes(entry.name)) continue;
      if (isIgnored(ignorePatterns, entry.name)) continue;

      const notebookDir = path.join(resolved, entry.name);
      collectNotes(resolved, notebookDir, results);

      // Check for stacks (nested notebook directories)
      const subEntries = fs.readdirSync(notebookDir, { withFileTypes: true });
      for (const subEntry of subEntries) {
        if (!subEntry.isDirectory()) continue;
        if (subEntry.name.startsWith('.')) continue;
        const relPath = (entry.name + '/' + subEntry.name);
        if (isIgnored(ignorePatterns, relPath)) continue;
        const subDir = path.join(notebookDir, subEntry.name);
        collectNotes(resolved, subDir, results);
      }
    }
  }

  // Filter by tag if specified
  let filtered = results;
  if (options?.tag) {
    filtered = results.filter((n) => n.tags.includes(options.tag!));
  }

  // Sort by modified descending
  filtered.sort((a, b) => b.modified.localeCompare(a.modified));
  return filtered;
}

function collectNotes(vaultRoot: string, directory: string, results: NoteSummary[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(vaultRoot, fullPath);

    try {
      const fileContent = fs.readFileSync(fullPath, 'utf-8');
      const { data, content } = parseFrontmatter(fileContent);
      const title = titleFromFilename(entry.name);
      const notebook = path.dirname(relativePath).split(path.sep)[0];

      results.push({
        id: data.id,
        title,
        path: relativePath,
        notebook,
        tags: data.tags,
        created: data.created,
        modified: data.modified,
        snippet: content.slice(0, 200).trim(),
      });
    } catch {
      // Skip files that can't be parsed
    }
  }
}

/**
 * Deletes a note by moving it to .trash/ (soft delete).
 */
export function deleteNote(vaultPath: string, notePath: string): boolean {
  return softDelete(vaultPath, notePath);
}

/**
 * Moves a note file to a different notebook directory.
 * Also moves any images referenced in the note's Markdown content
 * from the source notebook's .images/ to the destination notebook's .images/.
 */
export function moveNote(vaultPath: string, fromPath: string, toNotebook: string): NoteData {
  const resolved = resolveVaultPath(vaultPath);
  const srcFullPath = path.join(resolved, fromPath);
  const filename = path.basename(fromPath);

  // Read the note content to find image references before moving
  const fileContent = fs.readFileSync(srcFullPath, 'utf-8');
  const { content } = parseFrontmatter(fileContent);
  const imageFilenames = extractImageReferences(content);

  // Determine the source notebook from the path
  const sourceNotebook = path.dirname(fromPath).split(path.sep)[0];

  // Ensure target notebook directory exists
  const targetDir = path.join(resolved, toNotebook);
  fs.mkdirSync(targetDir, { recursive: true });

  // Resolve conflicts in target directory
  const targetFilename = resolveFilenameConflict(targetDir, filename);
  const targetFullPath = path.join(targetDir, targetFilename);

  // Move the note file
  fs.renameSync(srcFullPath, targetFullPath);

  // Move associated images from source notebook's .images/ to target notebook's .images/
  // Only move if the source and target notebooks are different
  if (sourceNotebook !== toNotebook && imageFilenames.length > 0) {
    moveImages(vaultPath, sourceNotebook, toNotebook, imageFilenames);
  }

  const newRelativePath = path.relative(resolved, targetFullPath);
  return getNote(vaultPath, newRelativePath);
}

/**
 * Creates a copy of a note with "Copy of" prefix and a new id.
 */
export function duplicateNote(vaultPath: string, notePath: string): NoteData {
  const resolved = resolveVaultPath(vaultPath);
  const original = getNote(vaultPath, notePath);

  const newId = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  const newTitle = `Copy of ${original.title}`;

  const notebookDir = path.join(resolved, original.notebook);
  const sanitized = sanitizeFilename(newTitle);
  const filename = resolveFilenameConflict(notebookDir, `${sanitized}.md`);

  const markdown = serializeNote({
    id: newId,
    title: newTitle,
    tags: [...original.tags],
    created: now,
    modified: now,
    content: original.content,
  });

  const filePath = path.join(notebookDir, filename);
  withRetrySync(() => fs.writeFileSync(filePath, markdown, 'utf-8'));

  const relativePath = path.relative(resolved, filePath);

  return {
    id: newId,
    title: newTitle,
    content: original.content,
    path: relativePath,
    notebook: original.notebook,
    tags: [...original.tags],
    created: now,
    modified: now,
    isTrashed: false,
  };
}
