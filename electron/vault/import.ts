import fs from 'node:fs';
import path from 'node:path';
import { resolveVaultPath } from './index';
import { serializeNote } from './markdown';
import { sanitizeFilename, resolveFilenameConflict } from './sanitize';
import type { VaultExport } from './export';

// ── Types ──────────────────────────────────────────────────────────

export interface ImportResult {
  notebooks: number;
  notes: number;
  images: number;
  errors: string[];
}

// ── Import implementation ─────────────────────────────────────────

/**
 * Imports a vault export JSON into the given vault directory.
 *
 * - Validates the version field
 * - For each notebook, creates the directory (with stack parent if specified)
 * - For each note, writes a .md file with frontmatter
 * - For each image, decodes base64 and saves to .images/
 * - If a note or image fails, logs the error and continues (partial import)
 * - Returns counts and any errors encountered
 */
export function importVault(vaultPath: string, data: VaultExport): ImportResult {
  const resolved = resolveVaultPath(vaultPath);
  const errors: string[] = [];
  let notebookCount = 0;
  let noteCount = 0;
  let imageCount = 0;

  // Validate version
  if (data.version !== 1) {
    return {
      notebooks: 0,
      notes: 0,
      images: 0,
      errors: [`Unsupported export version: ${data.version}. Expected version 1.`],
    };
  }

  if (!Array.isArray(data.notebooks)) {
    return {
      notebooks: 0,
      notes: 0,
      images: 0,
      errors: ['Invalid export data: notebooks field is not an array.'],
    };
  }

  for (const notebook of data.notebooks) {
    try {
      // Determine notebook directory path
      let notebookRelPath: string;
      if (notebook.stack) {
        notebookRelPath = path.join(notebook.stack, notebook.name);
      } else {
        notebookRelPath = notebook.name;
      }

      const notebookDir = path.join(resolved, notebookRelPath);
      fs.mkdirSync(notebookDir, { recursive: true });
      notebookCount++;

      // Import notes
      if (Array.isArray(notebook.notes)) {
        for (const note of notebook.notes) {
          try {
            const markdown = serializeNote({
              id: note.id ?? '',
              title: note.title ?? 'Untitled',
              tags: Array.isArray(note.tags) ? note.tags : [],
              created: note.created ?? new Date().toISOString(),
              modified: note.modified ?? new Date().toISOString(),
              content: note.content ?? '',
            });

            const sanitized = sanitizeFilename(note.title ?? 'Untitled');
            const filename = resolveFilenameConflict(notebookDir, `${sanitized}.md`);
            const filePath = path.join(notebookDir, filename);
            fs.writeFileSync(filePath, markdown, 'utf-8');
            noteCount++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`Failed to import note "${note.title ?? 'unknown'}" in notebook "${notebook.name}": ${msg}`);
          }
        }
      }

      // Import images
      if (Array.isArray(notebook.images)) {
        const imagesDir = path.join(notebookDir, '.images');

        for (const image of notebook.images) {
          try {
            if (!image.filename || !image.data) {
              errors.push(`Skipped image with missing filename or data in notebook "${notebook.name}"`);
              continue;
            }

            // Ensure .images/ directory exists (create only when we have images)
            fs.mkdirSync(imagesDir, { recursive: true });

            const imgBuffer = Buffer.from(image.data, 'base64');
            const imgPath = path.join(imagesDir, image.filename);
            fs.writeFileSync(imgPath, imgBuffer);
            imageCount++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`Failed to import image "${image.filename ?? 'unknown'}" in notebook "${notebook.name}": ${msg}`);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to create notebook "${notebook.name}": ${msg}`);
    }
  }

  return {
    notebooks: notebookCount,
    notes: noteCount,
    images: imageCount,
    errors,
  };
}
