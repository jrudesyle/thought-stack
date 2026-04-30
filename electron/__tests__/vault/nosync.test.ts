import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initializeVault } from '../../vault/index';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nosync-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('initializeVault .nosync handling', () => {
  it('creates cache.db.nosync marker file in .thoughtstack/', () => {
    initializeVault(tmpDir);
    const nosyncPath = path.join(tmpDir, '.thoughtstack', 'cache.db.nosync');
    expect(fs.existsSync(nosyncPath)).toBe(true);
  });

  it('does not overwrite existing cache.db.nosync marker', () => {
    initializeVault(tmpDir);
    const nosyncPath = path.join(tmpDir, '.thoughtstack', 'cache.db.nosync');
    fs.writeFileSync(nosyncPath, 'custom-content', 'utf-8');

    // Re-initialize — should not overwrite
    initializeVault(tmpDir);
    expect(fs.readFileSync(nosyncPath, 'utf-8')).toBe('custom-content');
  });

  it('creates CLOUD_SYNC.md documentation file', () => {
    initializeVault(tmpDir);
    const docsPath = path.join(tmpDir, '.thoughtstack', 'CLOUD_SYNC.md');
    expect(fs.existsSync(docsPath)).toBe(true);
    const content = fs.readFileSync(docsPath, 'utf-8');
    expect(content).toContain('iCloud');
    expect(content).toContain('Google Drive');
    expect(content).toContain('Dropbox');
    expect(content).toContain('OneDrive');
  });

  it('does not overwrite existing CLOUD_SYNC.md', () => {
    initializeVault(tmpDir);
    const docsPath = path.join(tmpDir, '.thoughtstack', 'CLOUD_SYNC.md');
    fs.writeFileSync(docsPath, 'custom docs', 'utf-8');

    initializeVault(tmpDir);
    expect(fs.readFileSync(docsPath, 'utf-8')).toBe('custom docs');
  });
});
