import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  sanitizeFilename,
  resolveFilenameConflict,
  titleFromFilename,
} from '../../vault/sanitize';

describe('sanitizeFilename', () => {
  it('returns the title unchanged when no invalid characters', () => {
    expect(sanitizeFilename('My Note')).toBe('My Note');
  });

  it('strips forward slashes', () => {
    expect(sanitizeFilename('path/to/note')).toBe('pathtonote');
  });

  it('strips backslashes', () => {
    expect(sanitizeFilename('path\\to\\note')).toBe('pathtonote');
  });

  it('strips colons', () => {
    expect(sanitizeFilename('Meeting: Monday')).toBe('Meeting Monday');
  });

  it('strips asterisks', () => {
    expect(sanitizeFilename('Important*Note')).toBe('ImportantNote');
  });

  it('strips question marks', () => {
    expect(sanitizeFilename('What is this?')).toBe('What is this');
  });

  it('strips double quotes', () => {
    expect(sanitizeFilename('The "Best" Note')).toBe('The Best Note');
  });

  it('strips angle brackets', () => {
    expect(sanitizeFilename('<html>tag</html>')).toBe('htmltaghtml');
  });

  it('strips pipe characters', () => {
    expect(sanitizeFilename('Option A | Option B')).toBe('Option A  Option B');
  });

  it('strips multiple invalid characters at once', () => {
    expect(sanitizeFilename('A/B\\C:D*E?F"G<H>I|J')).toBe('ABCDEFGHIJ');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeFilename('  My Note  ')).toBe('My Note');
  });

  it('returns "Untitled" for empty string', () => {
    expect(sanitizeFilename('')).toBe('Untitled');
  });

  it('returns "Untitled" for whitespace-only string', () => {
    expect(sanitizeFilename('   ')).toBe('Untitled');
  });

  it('returns "Untitled" when all characters are invalid', () => {
    expect(sanitizeFilename('/:*?"<>|')).toBe('Untitled');
  });
});

describe('resolveFilenameConflict', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanitize-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the original filename when no conflict', () => {
    const result = resolveFilenameConflict(tmpDir, 'Note.md');
    expect(result).toBe('Note.md');
  });

  it('appends " 2" when the file already exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'Note.md'), '');
    const result = resolveFilenameConflict(tmpDir, 'Note.md');
    expect(result).toBe('Note 2.md');
  });

  it('appends " 3" when both original and " 2" exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'Note.md'), '');
    fs.writeFileSync(path.join(tmpDir, 'Note 2.md'), '');
    const result = resolveFilenameConflict(tmpDir, 'Note.md');
    expect(result).toBe('Note 3.md');
  });

  it('handles filenames without extension', () => {
    fs.writeFileSync(path.join(tmpDir, 'README'), '');
    const result = resolveFilenameConflict(tmpDir, 'README');
    expect(result).toBe('README 2');
  });
});

describe('titleFromFilename', () => {
  it('strips .md extension', () => {
    expect(titleFromFilename('My Note.md')).toBe('My Note');
  });

  it('returns filename unchanged if no .md extension', () => {
    expect(titleFromFilename('My Note.txt')).toBe('My Note.txt');
  });

  it('handles filename that is just .md', () => {
    expect(titleFromFilename('.md')).toBe('');
  });

  it('handles filename with multiple dots', () => {
    expect(titleFromFilename('v2.0.Release.md')).toBe('v2.0.Release');
  });
});
