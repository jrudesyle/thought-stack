import fs from 'node:fs';
import path from 'node:path';
import { resolveVaultPath } from './index';

/**
 * Represents a conflict file created by a cloud sync provider.
 */
export interface ConflictFile {
  /** Absolute-ish relative path from vault root to the conflict file */
  conflictPath: string;
  /** Best-guess path to the original (non-conflict) file */
  originalPath: string;
  /** Which cloud provider likely created this conflict */
  provider: 'google-drive' | 'icloud' | 'dropbox' | 'onedrive' | 'unknown';
}

/**
 * Cloud provider conflict filename patterns.
 *
 * Google Drive:  "filename (1).md", "filename (2).md"
 * iCloud:        "filename 2.md", "filename (conflict).md"
 * Dropbox:       "filename (conflicted copy).md",
 *                "filename (user's conflicted copy 2026-04-30).md"
 * OneDrive:      "filename-DESKTOP-ABC.md" (machine name suffix)
 */
const CONFLICT_PATTERNS: Array<{
  regex: RegExp;
  provider: ConflictFile['provider'];
  /** Given the match groups, reconstruct the original filename */
  toOriginal: (match: RegExpMatchArray) => string;
}> = [
  // Dropbox: "name (conflicted copy).ext" or "name (Someone's conflicted copy 2026-04-30).ext"
  {
    regex: /^(.+?)\s+\([^)]*conflicted copy[^)]*\)(\.\w+)$/i,
    provider: 'dropbox',
    toOriginal: (m) => `${m[1]}${m[2]}`,
  },
  // iCloud: "name (conflict).ext"
  {
    regex: /^(.+?)\s+\(conflict\)(\.\w+)$/i,
    provider: 'icloud',
    toOriginal: (m) => `${m[1]}${m[2]}`,
  },
  // Google Drive: "name (1).ext", "name (2).ext" etc.
  {
    regex: /^(.+?)\s+\(\d+\)(\.\w+)$/,
    provider: 'google-drive',
    toOriginal: (m) => `${m[1]}${m[2]}`,
  },
  // iCloud: "name 2.ext", "name 3.ext" (space + single digit before extension)
  {
    regex: /^(.+?)\s+(\d)(\.\w+)$/,
    provider: 'icloud',
    toOriginal: (m) => `${m[1]}${m[3]}`,
  },
  // OneDrive: "name-DESKTOP-ABCDEF.ext" or "name-MACHINENAME.ext"
  // Machine names are typically uppercase alphanumeric, 5+ chars
  {
    regex: /^(.+?)-([A-Z][A-Z0-9_-]{4,})(\.\w+)$/,
    provider: 'onedrive',
    toOriginal: (m) => `${m[1]}${m[3]}`,
  },
];

/**
 * Scans all notebook directories in the vault for files matching
 * cloud provider conflict patterns.
 *
 * Only scans .md files (notes). Skips .thoughtstack/, .trash/, and hidden dirs.
 */
export function detectConflicts(vaultPath: string): ConflictFile[] {
  const resolved = resolveVaultPath(vaultPath);
  const conflicts: ConflictFile[] = [];

  scanDirectory(resolved, resolved, conflicts);

  return conflicts;
}

/**
 * Recursively scans a directory for conflict files.
 * Skips hidden directories, .thoughtstack, .trash.
 */
function scanDirectory(
  vaultRoot: string,
  directory: string,
  results: ConflictFile[]
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Skip hidden dirs and metadata dirs
      if (entry.name.startsWith('.')) continue;
      scanDirectory(vaultRoot, path.join(directory, entry.name), results);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const match = matchConflictPattern(entry.name);
    if (match) {
      const conflictPath = path.relative(vaultRoot, path.join(directory, entry.name));
      const originalPath = path.relative(
        vaultRoot,
        path.join(directory, match.originalFilename)
      );
      results.push({
        conflictPath,
        originalPath,
        provider: match.provider,
      });
    }
  }
}

/**
 * Tests a filename against all known conflict patterns.
 * Returns the first match, or null if the filename is not a conflict file.
 */
function matchConflictPattern(
  filename: string
): { provider: ConflictFile['provider']; originalFilename: string } | null {
  for (const pattern of CONFLICT_PATTERNS) {
    const match = filename.match(pattern.regex);
    if (match) {
      return {
        provider: pattern.provider,
        originalFilename: pattern.toOriginal(match),
      };
    }
  }
  return null;
}
