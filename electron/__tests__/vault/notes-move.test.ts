import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createNote, moveNote, getNote } from '../../vault/notes';
import { saveImage } from '../../vault/images';
import { initializeVault } from '../../vault/index';
import { serializeNote } from '../../vault/markdown';

describe('moveNote with image migration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-move-test-'));
    initializeVault(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves images when moving a note to a different notebook', () => {
    // Create source notebook and note with an image reference
    fs.mkdirSync(path.join(tmpDir, 'Source'), { recursive: true });

    // Save an image to the source notebook
    const imgData = Buffer.from('fake-png-data');
    const imgRelPath = saveImage(tmpDir, 'Source', imgData, 'image/png');
    const imgFilename = imgRelPath.replace('.images/', '');

    // Create a note that references the image
    const noteContent = `# Test Note\n\nHere is an image:\n\n![diagram](${imgRelPath})`;
    const markdown = serializeNote({
      id: 'abc123',
      title: 'Test Note',
      tags: [],
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      content: noteContent,
    });

    const notePath = path.join(tmpDir, 'Source', 'Test Note.md');
    fs.writeFileSync(notePath, markdown, 'utf-8');

    // Create target notebook
    fs.mkdirSync(path.join(tmpDir, 'Target'), { recursive: true });

    // Move the note
    const result = moveNote(tmpDir, 'Source/Test Note.md', 'Target');

    // Verify note was moved
    expect(result.notebook).toBe('Target');
    expect(fs.existsSync(path.join(tmpDir, 'Target', 'Test Note.md'))).toBe(true);
    expect(fs.existsSync(notePath)).toBe(false);

    // Verify image was moved to target notebook's .images/
    expect(fs.existsSync(path.join(tmpDir, 'Target', '.images', imgFilename))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'Source', '.images', imgFilename))).toBe(false);
  });

  it('does not move images when source and target notebook are the same', () => {
    // Create notebook with an image
    fs.mkdirSync(path.join(tmpDir, 'Same'), { recursive: true });
    const imgData = Buffer.from('fake-data');
    const imgRelPath = saveImage(tmpDir, 'Same', imgData, 'image/png');
    const imgFilename = imgRelPath.replace('.images/', '');

    const noteContent = `![img](${imgRelPath})`;
    const markdown = serializeNote({
      id: 'def456',
      title: 'Stay Put',
      tags: [],
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      content: noteContent,
    });

    fs.writeFileSync(path.join(tmpDir, 'Same', 'Stay Put.md'), markdown, 'utf-8');

    // Move to the same notebook (e.g., conflict resolution scenario)
    moveNote(tmpDir, 'Same/Stay Put.md', 'Same');

    // Image should still be in the same location
    expect(fs.existsSync(path.join(tmpDir, 'Same', '.images', imgFilename))).toBe(true);
  });

  it('moves note without images when note has no image references', () => {
    fs.mkdirSync(path.join(tmpDir, 'From'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'To'), { recursive: true });

    const markdown = serializeNote({
      id: 'noimg123',
      title: 'No Images',
      tags: ['test'],
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      content: '# Just text\n\nNo images here.',
    });

    fs.writeFileSync(path.join(tmpDir, 'From', 'No Images.md'), markdown, 'utf-8');

    const result = moveNote(tmpDir, 'From/No Images.md', 'To');

    expect(result.notebook).toBe('To');
    expect(result.content).toContain('No images here.');
    expect(fs.existsSync(path.join(tmpDir, 'To', 'No Images.md'))).toBe(true);
  });

  it('handles multiple image references in a single note', () => {
    fs.mkdirSync(path.join(tmpDir, 'Multi'), { recursive: true });

    // Save multiple images
    const img1Path = saveImage(tmpDir, 'Multi', Buffer.from('img1'), 'image/png');
    const img2Path = saveImage(tmpDir, 'Multi', Buffer.from('img2'), 'image/jpeg');
    const img1Name = img1Path.replace('.images/', '');
    const img2Name = img2Path.replace('.images/', '');

    const noteContent = `![first](${img1Path})\n\nSome text\n\n![second](${img2Path})`;
    const markdown = serializeNote({
      id: 'multi123',
      title: 'Multi Images',
      tags: [],
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      content: noteContent,
    });

    fs.writeFileSync(path.join(tmpDir, 'Multi', 'Multi Images.md'), markdown, 'utf-8');
    fs.mkdirSync(path.join(tmpDir, 'Dest'), { recursive: true });

    moveNote(tmpDir, 'Multi/Multi Images.md', 'Dest');

    // Both images should be moved
    expect(fs.existsSync(path.join(tmpDir, 'Dest', '.images', img1Name))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'Dest', '.images', img2Name))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'Multi', '.images', img1Name))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'Multi', '.images', img2Name))).toBe(false);
  });
});
