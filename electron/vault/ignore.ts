import fs from 'node:fs';
import path from 'node:path';

const IGNORE_FILE = '.thoughtstackignore';

/**
 * Reads ignore patterns from <vaultPath>/.thoughtstackignore.
 * Lines starting with # and blank lines are skipped.
 */
export function readIgnorePatterns(vaultPath: string): string[] {
  const filePath = path.join(vaultPath, IGNORE_FILE);
  if (!fs.existsSync(filePath)) return [];

  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

/**
 * Appends a new pattern to .thoughtstackignore.
 * Creates the file if it doesn't exist. Skips duplicates.
 */
export function addIgnorePattern(vaultPath: string, pattern: string): void {
  const filePath = path.join(vaultPath, IGNORE_FILE);
  const existing = readIgnorePatterns(vaultPath);

  if (existing.includes(pattern)) return;

  const line = (fs.existsSync(filePath) ? '\n' : '') + pattern + '\n';
  fs.appendFileSync(filePath, line, 'utf-8');
}

/**
 * Returns true if the given relative path matches any ignore pattern.
 * A pattern matches if the path equals it or starts with it followed by '/'.
 */
export function isIgnored(patterns: string[], relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return patterns.some(
    (p) => normalized === p || normalized.startsWith(p + '/')
  );
}
