import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  extractImageReferences,
  moveImages,
  saveImage,
  generateImageFilename,
} from '../../vault/images';
import { initializeVault } from '../../vault/index';

// ── extractImageReferences ─────────────────────────────────────────

describe('extractImageReferences', () => {
  it('extracts a single image reference', () => {
    const md = 'Some text\n\n![diagram](.images/abc123.png)\n\nMore text';
    expect(extractImageReferences(md)).toEqual(['abc123.png']);
  });

  it('extracts multiple image references', () => {
    const md = [
      '![photo](.images/img1.jpg)',
      'Some text',
      '![screenshot](.images/img2.png)',
      '![gif](.images/anim.gif)',
    ].join('\n');
    expect(extractImageReferences(md)).toEqual(['img1.jpg', 'img2.png', 'anim.gif']);
  });

  it('returns empty array when no images', () => {
    const md = '# Hello\n\nJust text, no images.';
    expect(extractImageReferences(md)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(extractImageReferences('')).toEqual([]);
  });

  it('does not match non-.images paths', () => {
    const md = '![photo](other/path.png)\n![link](https://example.com/img.png)';
    expect(extractImageReferences(md)).toEqual([]);
  });

  it('handles image references with empty alt text', () => {
    const md = '![](.images/noalt.png)';
    expect(extractImageReferences(md)).toEqual(['noalt.png']);
  });

  it('handles filenames with special characters', () => {
    const md = '![img](.images/my-image_2024.webp)';
    expect(extractImageReferences(md)).toEqual(['my-image_2024.webp']);
  });
});

// ── moveImages ─────────────────────────────────────────────────────

describe('moveImages', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-img-test-'));
    initializeVault(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves image files from source to target notebook', () => {
    // Setup: create source notebook with .images/
    const srcImagesDir = path.join(tmpDir, 'NotebookA', '.images');
    fs.mkdirSync(srcImagesDir, { recursive: true });
    fs.writeFileSync(path.join(srcImagesDir, 'img1.png'), 'fake-png-data');
    fs.writeFileSync(path.join(srcImagesDir, 'img2.jpg'), 'fake-jpg-data');

    // Create target notebook
    fs.mkdirSync(path.join(tmpDir, 'NotebookB'), { recursive: true });

    const moved = moveImages(tmpDir, 'NotebookA', 'NotebookB', ['img1.png', 'img2.jpg']);

    expect(moved).toEqual(['img1.png', 'img2.jpg']);

    // Verify files moved to target
    expect(fs.existsSync(path.join(tmpDir, 'NotebookB', '.images', 'img1.png'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'NotebookB', '.images', 'img2.jpg'))).toBe(true);

    // Verify files removed from source
    expect(fs.existsSync(path.join(srcImagesDir, 'img1.png'))).toBe(false);
    expect(fs.existsSync(path.join(srcImagesDir, 'img2.jpg'))).toBe(false);
  });

  it('creates target .images/ directory if it does not exist', () => {
    const srcImagesDir = path.join(tmpDir, 'Src', '.images');
    fs.mkdirSync(srcImagesDir, { recursive: true });
    fs.writeFileSync(path.join(srcImagesDir, 'test.png'), 'data');

    fs.mkdirSync(path.join(tmpDir, 'Dest'), { recursive: true });

    moveImages(tmpDir, 'Src', 'Dest', ['test.png']);

    expect(fs.existsSync(path.join(tmpDir, 'Dest', '.images', 'test.png'))).toBe(true);
  });

  it('skips files that do not exist in source', () => {
    const srcImagesDir = path.join(tmpDir, 'Src', '.images');
    fs.mkdirSync(srcImagesDir, { recursive: true });
    fs.writeFileSync(path.join(srcImagesDir, 'exists.png'), 'data');

    fs.mkdirSync(path.join(tmpDir, 'Dest'), { recursive: true });

    const moved = moveImages(tmpDir, 'Src', 'Dest', ['exists.png', 'missing.png']);

    expect(moved).toEqual(['exists.png']);
    expect(fs.existsSync(path.join(tmpDir, 'Dest', '.images', 'exists.png'))).toBe(true);
  });

  it('returns empty array when no filenames provided', () => {
    const moved = moveImages(tmpDir, 'Src', 'Dest', []);
    expect(moved).toEqual([]);
  });

  it('handles case where file already exists at destination', () => {
    const srcImagesDir = path.join(tmpDir, 'Src', '.images');
    const destImagesDir = path.join(tmpDir, 'Dest', '.images');
    fs.mkdirSync(srcImagesDir, { recursive: true });
    fs.mkdirSync(destImagesDir, { recursive: true });

    fs.writeFileSync(path.join(srcImagesDir, 'dup.png'), 'source-data');
    fs.writeFileSync(path.join(destImagesDir, 'dup.png'), 'dest-data');

    const moved = moveImages(tmpDir, 'Src', 'Dest', ['dup.png']);

    // Should report as moved (already exists at destination)
    expect(moved).toEqual(['dup.png']);
    // Destination file should be unchanged
    expect(fs.readFileSync(path.join(destImagesDir, 'dup.png'), 'utf-8')).toBe('dest-data');
  });
});

// ── generateImageFilename ──────────────────────────────────────────

describe('generateImageFilename', () => {
  it('generates .png extension for image/png', () => {
    const name = generateImageFilename('image/png');
    expect(name).toMatch(/^[a-f0-9]{12}\.png$/);
  });

  it('generates .jpg extension for image/jpeg', () => {
    const name = generateImageFilename('image/jpeg');
    expect(name).toMatch(/^[a-f0-9]{12}\.jpg$/);
  });

  it('generates .gif extension for image/gif', () => {
    const name = generateImageFilename('image/gif');
    expect(name).toMatch(/^[a-f0-9]{12}\.gif$/);
  });

  it('generates .webp extension for image/webp', () => {
    const name = generateImageFilename('image/webp');
    expect(name).toMatch(/^[a-f0-9]{12}\.webp$/);
  });

  it('defaults to .png for unknown MIME types', () => {
    const name = generateImageFilename('image/bmp');
    expect(name).toMatch(/^[a-f0-9]{12}\.png$/);
  });

  it('generates unique filenames', () => {
    const names = new Set<string>();
    for (let i = 0; i < 20; i++) {
      names.add(generateImageFilename('image/png'));
    }
    expect(names.size).toBe(20);
  });
});
