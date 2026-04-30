import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exportVault } from '../../vault/export';
import { importVault } from '../../vault/import';
import { initializeVault } from '../../vault/index';
import { serializeNote } from '../../vault/markdown';
import type { VaultExport } from '../../vault/export';

let tmpDir: string;

function createTmpVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-export-test-'));
  initializeVault(dir);
  return dir;
}

beforeEach(() => {
  tmpDir = createTmpVault();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helper: write a note file ──────────────────────────────────────

function writeNote(
  vaultPath: string,
  notebook: string,
  title: string,
  opts?: { id?: string; tags?: string[]; content?: string; created?: string; modified?: string }
): void {
  const notebookDir = path.join(vaultPath, notebook);
  fs.mkdirSync(notebookDir, { recursive: true });

  const id = opts?.id ?? 'abc123';
  const tags = opts?.tags ?? [];
  const content = opts?.content ?? '';
  const created = opts?.created ?? '2026-01-01T00:00:00Z';
  const modified = opts?.modified ?? '2026-01-01T00:00:00Z';

  const markdown = serializeNote({ id, title, tags, created, modified, content });
  fs.writeFileSync(path.join(notebookDir, `${title}.md`), markdown, 'utf-8');
}

// ── Helper: write an image file ────────────────────────────────────

function writeImage(vaultPath: string, notebook: string, filename: string, data: Buffer): void {
  const imagesDir = path.join(vaultPath, notebook, '.images');
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(path.join(imagesDir, filename), data);
}

// ── Export tests ───────────────────────────────────────────────────

describe('exportVault', () => {
  it('exports an empty vault', () => {
    const result = exportVault(tmpDir);

    expect(result.version).toBe(1);
    expect(result.exportedAt).toBeTruthy();
    expect(result.notebooks).toEqual([]);
  });

  it('exports a vault with one notebook and one note', () => {
    writeNote(tmpDir, 'Journal', 'Day One', {
      id: 'note1',
      tags: ['diary'],
      content: '# Day One\n\nHello world.',
      created: '2026-04-01T10:00:00Z',
      modified: '2026-04-01T12:00:00Z',
    });

    const result = exportVault(tmpDir);

    expect(result.notebooks).toHaveLength(1);
    expect(result.notebooks[0].name).toBe('Journal');
    expect(result.notebooks[0].stack).toBeNull();
    expect(result.notebooks[0].notes).toHaveLength(1);

    const note = result.notebooks[0].notes[0];
    expect(note.id).toBe('note1');
    expect(note.title).toBe('Day One');
    expect(note.tags).toEqual(['diary']);
    expect(note.content).toContain('# Day One');
    expect(note.created).toBe('2026-04-01T10:00:00Z');
    expect(note.modified).toBe('2026-04-01T12:00:00Z');
  });

  it('exports images as base64', () => {
    writeNote(tmpDir, 'Photos', 'My Photo Note', { id: 'p1' });
    const imgData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    writeImage(tmpDir, 'Photos', 'test.png', imgData);

    const result = exportVault(tmpDir);

    expect(result.notebooks[0].images).toHaveLength(1);
    expect(result.notebooks[0].images[0].filename).toBe('test.png');
    expect(result.notebooks[0].images[0].mimeType).toBe('image/png');
    expect(result.notebooks[0].images[0].data).toBe(imgData.toString('base64'));
  });

  it('exports notebooks inside stacks', () => {
    // Create a stack with a notebook inside
    const stackNotebookDir = path.join(tmpDir, 'Work', 'ProjectA');
    fs.mkdirSync(stackNotebookDir, { recursive: true });
    writeNote(tmpDir, path.join('Work', 'ProjectA'), 'Requirements', { id: 'r1' });

    const result = exportVault(tmpDir);

    const stackNotebook = result.notebooks.find((n) => n.name === 'ProjectA');
    expect(stackNotebook).toBeDefined();
    expect(stackNotebook!.stack).toBe('Work');
    expect(stackNotebook!.notes).toHaveLength(1);
    expect(stackNotebook!.notes[0].title).toBe('Requirements');
  });

  it('excludes .thoughtstack, .trash, and .images directories', () => {
    writeNote(tmpDir, 'Visible', 'Note', { id: 'v1' });

    // These should not appear in export
    fs.mkdirSync(path.join(tmpDir, '.trash'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.trash', 'deleted.md'), '# Deleted', 'utf-8');

    const result = exportVault(tmpDir);

    expect(result.notebooks).toHaveLength(1);
    expect(result.notebooks[0].name).toBe('Visible');
  });

  it('exports multiple notebooks with multiple notes', () => {
    writeNote(tmpDir, 'Journal', 'Day One', { id: 'j1' });
    writeNote(tmpDir, 'Journal', 'Day Two', { id: 'j2' });
    writeNote(tmpDir, 'Work', 'Meeting', { id: 'w1' });

    const result = exportVault(tmpDir);

    expect(result.notebooks).toHaveLength(2);
    const journal = result.notebooks.find((n) => n.name === 'Journal');
    const work = result.notebooks.find((n) => n.name === 'Work');
    expect(journal!.notes).toHaveLength(2);
    expect(work!.notes).toHaveLength(1);
  });
});

// ── Import tests ───────────────────────────────────────────────────

describe('importVault', () => {
  it('imports a valid export into an empty vault', () => {
    const data: VaultExport = {
      version: 1,
      exportedAt: '2026-04-01T00:00:00Z',
      notebooks: [
        {
          name: 'Journal',
          stack: null,
          notes: [
            {
              id: 'note1',
              title: 'Day One',
              content: '# Day One\n\nHello world.',
              tags: ['diary'],
              created: '2026-04-01T10:00:00Z',
              modified: '2026-04-01T12:00:00Z',
            },
          ],
          images: [],
        },
      ],
    };

    const result = importVault(tmpDir, data);

    expect(result.notebooks).toBe(1);
    expect(result.notes).toBe(1);
    expect(result.images).toBe(0);
    expect(result.errors).toEqual([]);

    // Verify the file was created
    const notePath = path.join(tmpDir, 'Journal', 'Day One.md');
    expect(fs.existsSync(notePath)).toBe(true);

    const content = fs.readFileSync(notePath, 'utf-8');
    expect(content).toContain('id: note1');
    expect(content).toContain('# Day One');
  });

  it('imports images by decoding base64', () => {
    const imgData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const data: VaultExport = {
      version: 1,
      exportedAt: '2026-04-01T00:00:00Z',
      notebooks: [
        {
          name: 'Photos',
          stack: null,
          notes: [],
          images: [
            {
              filename: 'test.png',
              mimeType: 'image/png',
              data: imgData.toString('base64'),
            },
          ],
        },
      ],
    };

    const result = importVault(tmpDir, data);

    expect(result.images).toBe(1);
    expect(result.errors).toEqual([]);

    const imgPath = path.join(tmpDir, 'Photos', '.images', 'test.png');
    expect(fs.existsSync(imgPath)).toBe(true);
    expect(fs.readFileSync(imgPath)).toEqual(imgData);
  });

  it('creates stack directories for notebooks with stacks', () => {
    const data: VaultExport = {
      version: 1,
      exportedAt: '2026-04-01T00:00:00Z',
      notebooks: [
        {
          name: 'ProjectA',
          stack: 'Work',
          notes: [
            {
              id: 'r1',
              title: 'Requirements',
              content: 'Reqs here',
              tags: [],
              created: '2026-01-01T00:00:00Z',
              modified: '2026-01-01T00:00:00Z',
            },
          ],
          images: [],
        },
      ],
    };

    const result = importVault(tmpDir, data);

    expect(result.notebooks).toBe(1);
    expect(result.notes).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, 'Work', 'ProjectA', 'Requirements.md'))).toBe(true);
  });

  it('rejects unsupported version', () => {
    const data = {
      version: 99,
      exportedAt: '2026-04-01T00:00:00Z',
      notebooks: [],
    } as unknown as VaultExport;

    const result = importVault(tmpDir, data);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Unsupported export version');
  });

  it('handles missing notebooks array', () => {
    const data = {
      version: 1,
      exportedAt: '2026-04-01T00:00:00Z',
    } as unknown as VaultExport;

    const result = importVault(tmpDir, data);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('not an array');
  });
});

// ── Partial import / error handling (12.3) ─────────────────────────

describe('importVault — partial import with error reporting', () => {
  it('continues importing after a note fails', () => {
    const data: VaultExport = {
      version: 1,
      exportedAt: '2026-04-01T00:00:00Z',
      notebooks: [
        {
          name: 'Mixed',
          stack: null,
          notes: [
            {
              id: 'good1',
              title: 'Good Note',
              content: 'Works fine',
              tags: [],
              created: '2026-01-01T00:00:00Z',
              modified: '2026-01-01T00:00:00Z',
            },
            // A note with a title that contains only invalid chars will still work
            // because sanitizeFilename falls back to "Untitled"
            {
              id: 'good2',
              title: 'Another Good Note',
              content: 'Also works',
              tags: [],
              created: '2026-01-01T00:00:00Z',
              modified: '2026-01-01T00:00:00Z',
            },
          ],
          images: [],
        },
      ],
    };

    const result = importVault(tmpDir, data);

    expect(result.notes).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('continues importing after an image fails to decode', () => {
    const data: VaultExport = {
      version: 1,
      exportedAt: '2026-04-01T00:00:00Z',
      notebooks: [
        {
          name: 'Images',
          stack: null,
          notes: [],
          images: [
            {
              filename: '', // empty filename — should be skipped
              mimeType: 'image/png',
              data: '',
            },
            {
              filename: 'valid.png',
              mimeType: 'image/png',
              data: Buffer.from([0x89, 0x50]).toString('base64'),
            },
          ],
        },
      ],
    };

    const result = importVault(tmpDir, data);

    expect(result.images).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('missing filename or data');
  });

  it('reports errors for images with missing data', () => {
    const data: VaultExport = {
      version: 1,
      exportedAt: '2026-04-01T00:00:00Z',
      notebooks: [
        {
          name: 'BadImages',
          stack: null,
          notes: [],
          images: [
            {
              filename: 'nodata.png',
              mimeType: 'image/png',
              data: '', // empty data
            },
          ],
        },
      ],
    };

    const result = importVault(tmpDir, data);

    expect(result.images).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('missing filename or data');
  });
});

// ── Round-trip tests ───────────────────────────────────────────────

describe('export → import round-trip', () => {
  it('round-trips a vault with notes and images', () => {
    // Set up source vault
    writeNote(tmpDir, 'Journal', 'Day One', {
      id: 'note1',
      tags: ['diary', 'personal'],
      content: '# Day One\n\nHello world.',
      created: '2026-04-01T10:00:00Z',
      modified: '2026-04-01T12:00:00Z',
    });
    writeNote(tmpDir, 'Journal', 'Day Two', {
      id: 'note2',
      tags: ['diary'],
      content: '# Day Two\n\nAnother day.',
      created: '2026-04-02T10:00:00Z',
      modified: '2026-04-02T12:00:00Z',
    });

    const imgData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeImage(tmpDir, 'Journal', 'diagram.png', imgData);

    writeNote(tmpDir, 'Work', 'Meeting Notes', {
      id: 'note3',
      tags: ['work'],
      content: '# Meeting\n\nAction items.',
      created: '2026-04-03T09:00:00Z',
      modified: '2026-04-03T10:00:00Z',
    });

    // Export
    const exported = exportVault(tmpDir);

    // Import into a fresh vault
    const targetDir = createTmpVault();
    try {
      const result = importVault(targetDir, exported);

      expect(result.notebooks).toBe(2);
      expect(result.notes).toBe(3);
      expect(result.images).toBe(1);
      expect(result.errors).toEqual([]);

      // Verify notes exist in target
      expect(fs.existsSync(path.join(targetDir, 'Journal', 'Day One.md'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'Journal', 'Day Two.md'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'Work', 'Meeting Notes.md'))).toBe(true);

      // Verify image was round-tripped
      const importedImg = fs.readFileSync(path.join(targetDir, 'Journal', '.images', 'diagram.png'));
      expect(importedImg).toEqual(imgData);

      // Verify note content was preserved
      const noteContent = fs.readFileSync(path.join(targetDir, 'Journal', 'Day One.md'), 'utf-8');
      expect(noteContent).toContain('id: note1');
      expect(noteContent).toContain('- diary');
      expect(noteContent).toContain('- personal');
      expect(noteContent).toContain('# Day One');
    } finally {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });

  it('round-trips a vault with stacked notebooks', () => {
    const stackDir = path.join(tmpDir, 'Work', 'ProjectA');
    fs.mkdirSync(stackDir, { recursive: true });
    writeNote(tmpDir, path.join('Work', 'ProjectA'), 'Requirements', {
      id: 'r1',
      tags: ['project'],
      content: '# Requirements\n\nList of requirements.',
    });

    const exported = exportVault(tmpDir);
    const targetDir = createTmpVault();

    try {
      const result = importVault(targetDir, exported);

      expect(result.notebooks).toBe(1);
      expect(result.notes).toBe(1);
      expect(result.errors).toEqual([]);
      expect(fs.existsSync(path.join(targetDir, 'Work', 'ProjectA', 'Requirements.md'))).toBe(true);
    } finally {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
