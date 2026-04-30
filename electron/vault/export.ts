import fs from 'node:fs';
import path from 'node:path';
import { resolveVaultPath } from './index';
import { parseFrontmatter } from './markdown';
import { titleFromFilename } from './sanitize';

// ── Types ──────────────────────────────────────────────────────────

export interface VaultExport {
  version: 1;
  exportedAt: string; // ISO 8601
  notebooks: Array<{
    name: string;
    stack: string | null;
    notes: Array<{
      id: string;
      title: string;
      content: string; // Markdown body
      tags: string[];
      created: string;
      modified: string;
    }>;
    images: Array<{
      filename: string;
      mimeType: string;
      data: string; // base64
    }>;
  }>;
}

// ── MIME type lookup ───────────────────────────────────────────────

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function mimeFromExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

// ── Excluded directories ──────────────────────────────────────────

const EXCLUDED_DIRS = new Set(['.thoughtstack', '.trash', '.images']);

// ── Export implementation ─────────────────────────────────────────

/**
 * Exports the entire vault to a JSON-serializable object.
 *
 * Walks all notebook directories (excluding .thoughtstack, .trash, .images),
 * reads all .md files and parses frontmatter, reads all images and base64-encodes them.
 */
export function exportVault(vaultPath: string): VaultExport {
  const resolved = resolveVaultPath(vaultPath);

  const notebooks: VaultExport['notebooks'] = [];

  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;

    const dirPath = path.join(resolved, entry.name);
    const subEntries = fs.readdirSync(dirPath, { withFileTypes: true });
    const hasMdFiles = subEntries.some((e) => e.isFile() && e.name.endsWith('.md'));
    const hasSubDirs = subEntries.some(
      (e) => e.isDirectory() && !e.name.startsWith('.')
    );

    // If this directory has .md files, it's a notebook at the root level
    if (hasMdFiles || !hasSubDirs) {
      notebooks.push(exportNotebook(resolved, dirPath, entry.name, null));
    }

    // If it has subdirectories, those are notebooks in a stack
    if (hasSubDirs) {
      for (const subEntry of subEntries) {
        if (!subEntry.isDirectory()) continue;
        if (subEntry.name.startsWith('.')) continue;

        const subDirPath = path.join(dirPath, subEntry.name);
        notebooks.push(exportNotebook(resolved, subDirPath, subEntry.name, entry.name));
      }
    }
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    notebooks,
  };
}

/**
 * Exports a single notebook directory: reads all .md notes and .images/ files.
 */
function exportNotebook(
  _vaultRoot: string,
  notebookDir: string,
  name: string,
  stack: string | null
): VaultExport['notebooks'][number] {
  const notes: VaultExport['notebooks'][number]['notes'] = [];
  const images: VaultExport['notebooks'][number]['images'] = [];

  // Read all .md files
  const entries = fs.readdirSync(notebookDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    try {
      const filePath = path.join(notebookDir, entry.name);
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const { data, content } = parseFrontmatter(fileContent);
      const title = titleFromFilename(entry.name);

      notes.push({
        id: data.id,
        title,
        content,
        tags: data.tags,
        created: data.created,
        modified: data.modified,
      });
    } catch {
      // Skip files that can't be parsed
    }
  }

  // Read all images from .images/ subdirectory
  const imagesDir = path.join(notebookDir, '.images');
  if (fs.existsSync(imagesDir)) {
    try {
      const imageEntries = fs.readdirSync(imagesDir, { withFileTypes: true });
      for (const imgEntry of imageEntries) {
        if (!imgEntry.isFile()) continue;

        try {
          const imgPath = path.join(imagesDir, imgEntry.name);
          const imgData = fs.readFileSync(imgPath);
          images.push({
            filename: imgEntry.name,
            mimeType: mimeFromExtension(imgEntry.name),
            data: imgData.toString('base64'),
          });
        } catch {
          // Skip images that can't be read
        }
      }
    } catch {
      // Skip if .images/ can't be read
    }
  }

  return { name, stack, notes, images };
}
