import fs from 'node:fs';
import path from 'node:path';

/**
 * Strips characters that are invalid in filenames across Windows, macOS, and Linux.
 * Trims whitespace and defaults to "Untitled" if the result is empty.
 */
export function sanitizeFilename(title: string): string {
  // Strip invalid filesystem characters: / \ : * ? " < > |
  let sanitized = title.replace(/[/\\:*?"<>|]/g, '');
  sanitized = sanitized.trim();

  if (sanitized.length === 0) {
    return 'Untitled';
  }

  return sanitized;
}

/**
 * If a file with the given filename already exists in the directory,
 * appends " 2", " 3", etc. until a unique name is found.
 * The filename should include the .md extension.
 */
export function resolveFilenameConflict(directory: string, filename: string): string {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);

  let candidate = filename;
  let counter = 2;

  while (fs.existsSync(path.join(directory, candidate))) {
    candidate = `${base} ${counter}${ext}`;
    counter++;
  }

  return candidate;
}

/**
 * Strips the .md extension from a filename to derive the note title.
 */
export function titleFromFilename(filename: string): string {
  if (filename.endsWith('.md')) {
    return filename.slice(0, -3);
  }
  return filename;
}
