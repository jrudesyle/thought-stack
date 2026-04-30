import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { detectConflicts } from '../../vault/conflicts';
import { initializeVault } from '../../vault/index';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conflicts-test-'));
  initializeVault(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content = '---\nid: abc\n---\ntest'): void {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

describe('detectConflicts', () => {
  it('returns empty array when no conflicts exist', () => {
    writeFile('Notes/Meeting.md');
    writeFile('Notes/Ideas.md');
    const result = detectConflicts(tmpDir);
    expect(result).toEqual([]);
  });

  it('detects Google Drive conflict pattern: "name (1).md"', () => {
    writeFile('Notes/Meeting.md');
    writeFile('Notes/Meeting (1).md');
    const result = detectConflicts(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      conflictPath: path.join('Notes', 'Meeting (1).md'),
      originalPath: path.join('Notes', 'Meeting.md'),
      provider: 'google-drive',
    });
  });

  it('detects Google Drive conflict pattern: "name (2).md"', () => {
    writeFile('Notes/Sprint Planning.md');
    writeFile('Notes/Sprint Planning (2).md');
    const result = detectConflicts(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe('google-drive');
  });

  it('detects iCloud conflict pattern: "name (conflict).md"', () => {
    writeFile('Notes/Ideas.md');
    writeFile('Notes/Ideas (conflict).md');
    const result = detectConflicts(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      conflictPath: path.join('Notes', 'Ideas (conflict).md'),
      originalPath: path.join('Notes', 'Ideas.md'),
      provider: 'icloud',
    });
  });

  it('detects iCloud conflict pattern: "name 2.md"', () => {
    writeFile('Notes/Ideas.md');
    writeFile('Notes/Ideas 2.md');
    const result = detectConflicts(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe('icloud');
    expect(result[0].originalPath).toBe(path.join('Notes', 'Ideas.md'));
  });

  it('detects Dropbox conflict pattern: "name (conflicted copy).md"', () => {
    writeFile('Notes/Todo.md');
    writeFile('Notes/Todo (conflicted copy).md');
    const result = detectConflicts(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      conflictPath: path.join('Notes', 'Todo (conflicted copy).md'),
      originalPath: path.join('Notes', 'Todo.md'),
      provider: 'dropbox',
    });
  });

  it('detects Dropbox conflict with user and date: "name (John\'s conflicted copy 2026-04-30).md"', () => {
    writeFile('Notes/Report.md');
    writeFile("Notes/Report (John's conflicted copy 2026-04-30).md");
    const result = detectConflicts(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe('dropbox');
    expect(result[0].originalPath).toBe(path.join('Notes', 'Report.md'));
  });

  it('detects OneDrive conflict pattern: "name-DESKTOP-ABC.md"', () => {
    writeFile('Notes/Meeting.md');
    writeFile('Notes/Meeting-DESKTOP-ABCDEF.md');
    const result = detectConflicts(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      conflictPath: path.join('Notes', 'Meeting-DESKTOP-ABCDEF.md'),
      originalPath: path.join('Notes', 'Meeting.md'),
      provider: 'onedrive',
    });
  });

  it('detects conflicts in nested notebook directories (stacks)', () => {
    writeFile('Work/Project/Notes.md');
    writeFile('Work/Project/Notes (1).md');
    const result = detectConflicts(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].conflictPath).toBe(path.join('Work', 'Project', 'Notes (1).md'));
  });

  it('detects multiple conflicts across notebooks', () => {
    writeFile('Notes/A.md');
    writeFile('Notes/A (1).md');
    writeFile('Work/B.md');
    writeFile('Work/B (conflict).md');
    const result = detectConflicts(tmpDir);
    expect(result).toHaveLength(2);
    const providers = result.map((c) => c.provider).sort();
    expect(providers).toEqual(['google-drive', 'icloud']);
  });

  it('skips .thoughtstack and .trash directories', () => {
    writeFile('.thoughtstack/config (1).md');
    writeFile('.trash/Old Note (1).md');
    const result = detectConflicts(tmpDir);
    expect(result).toEqual([]);
  });

  it('only scans .md files', () => {
    // Create a non-md conflict file — should be ignored
    const fullPath = path.join(tmpDir, 'Notes', 'image (1).png');
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, 'binary', 'utf-8');
    const result = detectConflicts(tmpDir);
    expect(result).toEqual([]);
  });
});
