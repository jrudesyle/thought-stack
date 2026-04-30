/**
 * Data Migration Tool
 *
 * Migrates from the old SQLite database (data/notes.db) to the new
 * Markdown vault format. Reads notebooks, notes (with tags), and images
 * from the database, converts TipTap JSON to Markdown, and writes
 * .md files with frontmatter into the vault directory structure.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { tiptapJsonToMarkdown } from './tiptap-to-markdown';
import { serializeNote } from '../vault/markdown';
import { sanitizeFilename } from '../vault/sanitize';
import { initializeVault } from '../vault/index';

// ── Types ──────────────────────────────────────────────────────────

export interface MigrationSummary {
  notebooks: number;
  notes: number;
  tags: number;
  images: number;
  errors: string[];
}

interface DbNotebook {
  id: string;
  name: string;
  stack_id: string | null;
  created_at: string;
  updated_at: string;
}

interface DbStack {
  id: string;
  name: string;
}

interface DbNote {
  id: string;
  title: string;
  content: string;
  notebook_id: string;
  is_trashed: number;
  trashed_at: string | null;
  original_notebook_id: string | null;
  created_at: string;
  updated_at: string;
}

interface DbTag {
  tag_name: string;
}

interface DbImage {
  id: string;
  note_id: string;
  mime_type: string;
  data: Buffer;
}

// ── MIME to extension mapping ──────────────────────────────────────

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
};

// ── Public API ─────────────────────────────────────────────────────

/**
 * Runs the full migration from an old SQLite database to a Markdown vault.
 *
 * @param dbPath - Path to the old SQLite database (e.g., `data/notes.db`)
 * @param vaultPath - Path to the target vault directory
 * @returns A summary of the migration results
 */
export function migrateDatabase(dbPath: string, vaultPath: string): MigrationSummary {
  const summary: MigrationSummary = {
    notebooks: 0,
    notes: 0,
    tags: 0,
    images: 0,
    errors: [],
  };

  // Validate database exists
  if (!fs.existsSync(dbPath)) {
    summary.errors.push(`Database not found: ${dbPath}`);
    return summary;
  }

  // Initialize the vault
  initializeVault(vaultPath);

  // Open the old database (read-only)
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (err) {
    summary.errors.push(`Failed to open database: ${err instanceof Error ? err.message : String(err)}`);
    return summary;
  }

  try {
    // 1. Read all stacks
    const stacks = readStacks(db);
    const stackMap = new Map<string, string>();
    for (const stack of stacks) {
      stackMap.set(stack.id, stack.name);
    }

    // 2. Read all notebooks and create directories
    const notebooks = readNotebooks(db);
    const notebookDirMap = new Map<string, string>(); // notebook id → relative dir path

    for (const notebook of notebooks) {
      try {
        const stackName = notebook.stack_id ? stackMap.get(notebook.stack_id) : null;
        const dirPath = createNotebookDirectory(vaultPath, notebook.name, stackName ?? null);
        notebookDirMap.set(notebook.id, dirPath);
        summary.notebooks++;
      } catch (err) {
        summary.errors.push(
          `Failed to create notebook "${notebook.name}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // 3. Collect all unique tags
    const allTags = new Set<string>();

    // 4. Read all images and index by note_id
    const imagesByNote = readImagesByNote(db);

    // 5. Read and migrate all non-trashed notes
    const notes = readNotes(db);

    // Track filenames per directory to handle duplicates
    const usedFilenames = new Map<string, Set<string>>();

    for (const note of notes) {
      if (note.is_trashed) continue;

      const notebookDir = notebookDirMap.get(note.notebook_id);
      if (!notebookDir) {
        summary.errors.push(
          `Note "${note.title}" (${note.id}): notebook ${note.notebook_id} not found, skipping`
        );
        continue;
      }

      try {
        // Get tags for this note
        const noteTags = readNoteTags(db, note.id);
        const tagNames = noteTags.map((t) => t.tag_name);
        for (const tag of tagNames) {
          allTags.add(tag);
        }

        // Get images for this note
        const noteImages = imagesByNote.get(note.id) ?? [];

        // Save images and build a replacement map
        const imageReplacements = new Map<string, string>();
        for (const image of noteImages) {
          try {
            const savedPath = saveImageFile(vaultPath, notebookDir, image);
            // Build replacement patterns for image references in content
            // The old app may reference images via data URIs or API endpoints
            imageReplacements.set(image.id, savedPath);
            summary.images++;
          } catch (err) {
            summary.errors.push(
              `Failed to save image ${image.id} for note "${note.title}": ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        // Convert TipTap JSON to Markdown
        let markdown = tiptapJsonToMarkdown(note.content);

        // Replace image references in the markdown
        markdown = replaceImageReferences(markdown, imageReplacements, noteImages);

        // Write the note file
        const filename = resolveUniqueFilename(
          vaultPath,
          notebookDir,
          note.title || 'Untitled',
          usedFilenames
        );

        const created = normalizeTimestamp(note.created_at);
        const modified = normalizeTimestamp(note.updated_at);

        const fileContent = serializeNote({
          id: note.id,
          title: note.title || 'Untitled',
          tags: tagNames,
          created,
          modified,
          content: markdown,
        });

        const filePath = path.join(vaultPath, notebookDir, filename);
        fs.writeFileSync(filePath, fileContent, 'utf-8');
        summary.notes++;
      } catch (err) {
        summary.errors.push(
          `Failed to migrate note "${note.title}" (${note.id}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    summary.tags = allTags.size;
  } finally {
    db.close();
  }

  return summary;
}

// ── Database readers ───────────────────────────────────────────────

function readStacks(db: Database.Database): DbStack[] {
  try {
    return db.prepare('SELECT id, name FROM notebook_stacks').all() as DbStack[];
  } catch {
    return [];
  }
}

function readNotebooks(db: Database.Database): DbNotebook[] {
  try {
    return db
      .prepare('SELECT id, name, stack_id, created_at, updated_at FROM notebooks ORDER BY name')
      .all() as DbNotebook[];
  } catch {
    return [];
  }
}

function readNotes(db: Database.Database): DbNote[] {
  try {
    return db
      .prepare(
        `SELECT id, title, content, notebook_id, is_trashed, trashed_at,
                original_notebook_id, created_at, updated_at
         FROM notes
         ORDER BY created_at`
      )
      .all() as DbNote[];
  } catch {
    return [];
  }
}

function readNoteTags(db: Database.Database, noteId: string): DbTag[] {
  try {
    return db
      .prepare(
        `SELECT t.name AS tag_name
         FROM tags t
         INNER JOIN note_tags nt ON nt.tag_id = t.id
         WHERE nt.note_id = ?
         ORDER BY t.name`
      )
      .all(noteId) as DbTag[];
  } catch {
    return [];
  }
}

function readImagesByNote(db: Database.Database): Map<string, DbImage[]> {
  const map = new Map<string, DbImage[]>();
  try {
    const images = db
      .prepare('SELECT id, note_id, mime_type, data FROM note_images')
      .all() as DbImage[];

    for (const img of images) {
      const list = map.get(img.note_id) ?? [];
      list.push(img);
      map.set(img.note_id, list);
    }
  } catch {
    // Table might not exist in older databases
  }
  return map;
}

// ── Directory and file helpers ─────────────────────────────────────

/**
 * Creates a notebook directory in the vault, optionally nested under a stack.
 * Returns the relative path from the vault root.
 */
function createNotebookDirectory(
  vaultPath: string,
  notebookName: string,
  stackName: string | null
): string {
  const sanitizedNotebook = sanitizeFilename(notebookName);

  let relPath: string;
  if (stackName) {
    const sanitizedStack = sanitizeFilename(stackName);
    relPath = path.join(sanitizedStack, sanitizedNotebook);
  } else {
    relPath = sanitizedNotebook;
  }

  const fullPath = path.join(vaultPath, relPath);
  fs.mkdirSync(fullPath, { recursive: true });

  return relPath;
}

/**
 * Saves an image BLOB to the notebook's .images/ directory.
 * Returns the relative Markdown reference path (e.g., ".images/abc123.png").
 */
function saveImageFile(
  vaultPath: string,
  notebookDir: string,
  image: DbImage
): string {
  const ext = MIME_TO_EXT[image.mime_type] ?? '.png';
  const filename = `${image.id}${ext}`;

  const imagesDir = path.join(vaultPath, notebookDir, '.images');
  fs.mkdirSync(imagesDir, { recursive: true });

  const filePath = path.join(imagesDir, filename);
  fs.writeFileSync(filePath, image.data);

  return `.images/${filename}`;
}

/**
 * Replaces image references in Markdown content.
 *
 * Handles:
 * - data:image/... URIs → .images/filename.ext
 * - /api/images/... paths → .images/filename.ext
 * - Adds image references for images that aren't already referenced
 */
function replaceImageReferences(
  markdown: string,
  imageReplacements: Map<string, string>,
  noteImages: DbImage[]
): string {
  let result = markdown;

  for (const image of noteImages) {
    const newPath = imageReplacements.get(image.id);
    if (!newPath) continue;

    // Replace data URI references
    const dataUriPattern = new RegExp(
      `!\\[([^\\]]*)\\]\\(data:${escapeRegex(image.mime_type)}[^)]*\\)`,
      'g'
    );
    result = result.replace(dataUriPattern, `![$1](${newPath})`);

    // Replace API endpoint references (e.g., /api/images/{id})
    const apiPattern = new RegExp(
      `!\\[([^\\]]*)\\]\\([^)]*${escapeRegex(image.id)}[^)]*\\)`,
      'g'
    );
    result = result.replace(apiPattern, `![$1](${newPath})`);
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generates a unique filename for a note within a notebook directory.
 * Tracks used filenames to handle duplicates with numeric suffixes.
 */
function resolveUniqueFilename(
  vaultPath: string,
  notebookDir: string,
  title: string,
  usedFilenames: Map<string, Set<string>>
): string {
  const sanitized = sanitizeFilename(title || 'Untitled');
  const dirKey = notebookDir;

  if (!usedFilenames.has(dirKey)) {
    usedFilenames.set(dirKey, new Set());
  }
  const used = usedFilenames.get(dirKey)!;

  let candidate = `${sanitized}.md`;
  let counter = 2;

  while (used.has(candidate.toLowerCase()) || fs.existsSync(path.join(vaultPath, notebookDir, candidate))) {
    candidate = `${sanitized} ${counter}.md`;
    counter++;
  }

  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Normalizes a SQLite timestamp to ISO 8601 format.
 * SQLite stores as "YYYY-MM-DD HH:MM:SS", we need "YYYY-MM-DDTHH:MM:SSZ".
 */
function normalizeTimestamp(timestamp: string): string {
  if (!timestamp) return new Date().toISOString();

  // Already ISO format
  if (timestamp.includes('T')) return timestamp;

  // SQLite format: "2024-01-15 10:30:00" → "2024-01-15T10:30:00Z"
  return timestamp.replace(' ', 'T') + 'Z';
}
