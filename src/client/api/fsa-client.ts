/**
 * File System Access API client for ThoughtStack PWA.
 *
 * Uses window.showDirectoryPicker() to let the user pick their vault folder.
 * The FileSystemDirectoryHandle is persisted in IndexedDB so the user only
 * needs to pick it once per browser profile.
 *
 * No server required — all reads/writes go directly to the local filesystem.
 */

// ── Types (identical to electron-client.ts) ───────────────────────────────

export interface NoteData {
  id: string;
  title: string;
  content: string;
  path: string;
  notebook: string;
  tags: string[];
  created: string;
  modified: string;
  isTrashed: boolean;
}

export interface NoteSummary {
  id: string;
  title: string;
  path: string;
  notebook: string;
  tags: string[];
  created: string;
  modified: string;
  snippet: string;
}

export interface NotebookInfo {
  name: string;
  path: string;
  stack: string | null;
  noteCount: number;
}

export interface TagInfo {
  name: string;
  noteCount: number;
}

export interface SearchResult {
  noteId: string;
  title: string;
  snippet: string;
  notebook: string;
  tags: string[];
  modified: string;
  rank: number;
}

export interface AppSettings {
  vaultPath: string;
  theme: 'light' | 'dark' | 'system';
  autoSaveDelayMs: number;
  recentVaults: string[];
}

export interface ConflictFile {
  conflictPath: string;
  originalPath: string;
  provider: 'google-drive' | 'icloud' | 'dropbox' | 'onedrive' | 'unknown';
}

export interface MigrationSummary {
  notebooks: number;
  notes: number;
  tags: number;
  images: number;
  errors: string[];
}

// ── IndexedDB vault handle persistence ───────────────────────────────────

const IDB_NAME = 'thoughtstack';
const IDB_STORE = 'vault';
const HANDLE_KEY = 'vaultHandle';
const SETTINGS_KEY = 'settings';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Vault handle management ───────────────────────────────────────────────

let _vaultHandle: FileSystemDirectoryHandle | null = null;

async function getVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (_vaultHandle) return _vaultHandle;
  const stored = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY);
  if (!stored) return null;

  // Re-request permission if needed
  const perm = await stored.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') {
    _vaultHandle = stored;
    return stored;
  }
  if (perm === 'prompt') {
    const granted = await stored.requestPermission({ mode: 'readwrite' });
    if (granted === 'granted') {
      _vaultHandle = stored;
      return stored;
    }
  }
  return null;
}

async function requireVault(): Promise<FileSystemDirectoryHandle> {
  const handle = await getVaultHandle();
  if (!handle) throw new Error('No vault selected. Call system.pickVaultFolder() first.');
  return handle;
}

// ── File system helpers ───────────────────────────────────────────────────

async function getFileHandle(
  root: FileSystemDirectoryHandle,
  relPath: string,
  create = false,
): Promise<FileSystemFileHandle> {
  const parts = relPath.split('/');
  let dir: FileSystemDirectoryHandle = root;
  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir.getFileHandle(parts[parts.length - 1], { create });
}

async function getDirHandle(
  root: FileSystemDirectoryHandle,
  relPath: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  const parts = relPath.split('/').filter(Boolean);
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function readTextFile(
  root: FileSystemDirectoryHandle,
  relPath: string,
): Promise<string> {
  const fh = await getFileHandle(root, relPath);
  const file = await fh.getFile();
  return file.text();
}

async function writeTextFile(
  root: FileSystemDirectoryHandle,
  relPath: string,
  content: string,
): Promise<void> {
  const fh = await getFileHandle(root, relPath, true);
  const writable = await (fh as any).createWritable();
  await writable.write(content);
  await writable.close();
}

async function writeBinaryFile(
  root: FileSystemDirectoryHandle,
  relPath: string,
  data: ArrayBuffer,
): Promise<void> {
  const fh = await getFileHandle(root, relPath, true);
  const writable = await (fh as any).createWritable();
  await writable.write(data);
  await writable.close();
}

/** Lists all entries in a directory, returning [name, handle] pairs. */
async function listDir(
  dir: FileSystemDirectoryHandle,
): Promise<Array<[string, FileSystemHandle]>> {
  const entries: Array<[string, FileSystemHandle]> = [];
  for await (const [name, handle] of (dir as any).entries()) {
    entries.push([name, handle]);
  }
  return entries;
}

const SKIP_DIRS = new Set(['.thoughtstack', '.trash', '.images']);

/** Recursively collects all .md files under a directory. Returns relative paths from root. */
async function collectMdFiles(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  skipDirs = true,
): Promise<string[]> {
  const results: string[] = [];
  for await (const [name, handle] of (dir as any).entries()) {
    if (handle.kind === 'file' && name.endsWith('.md') && !name.startsWith('.')) {
      results.push(prefix ? `${prefix}/${name}` : name);
    } else if (handle.kind === 'directory') {
      if (skipDirs && SKIP_DIRS.has(name)) continue;
      const sub = handle as FileSystemDirectoryHandle;
      const subPaths = await collectMdFiles(sub, prefix ? `${prefix}/${name}` : name, skipDirs);
      results.push(...subPaths);
    }
  }
  return results;
}

// ── Frontmatter helpers (browser-safe, no gray-matter/Buffer) ────────────

const FM_DELIM = /^---\r?\n/;

function parseNote(fileContent: string) {
  // Split on opening and closing --- delimiters
  const parts = fileContent.split(/^---\r?\n/m);
  // Structure: ["", yamlBlock, content] when frontmatter present
  if (parts.length >= 3 && fileContent.startsWith('---')) {
    const yaml = parts[1];
    const content = parts.slice(2).join('---\n').trim();
    return { ...parseYamlFrontmatter(yaml), content };
  }
  // No frontmatter
  return { id: '', tags: [] as string[], created: '', modified: '', content: fileContent };
}

function parseYamlFrontmatter(yaml: string) {
  const lines = yaml.split('\n');
  let id = '';
  let created = '';
  let modified = '';
  const tags: string[] = [];
  let inTags = false;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    // Tags block: list items
    if (inTags) {
      const tagMatch = line.match(/^\s+-\s+(.+)/);
      if (tagMatch) { tags.push(tagMatch[1].trim()); continue; }
      inTags = false;
    }
    const kv = line.match(/^(\w+):\s*(.*)/);
    if (!kv) continue;
    const [, key, val] = kv;
    const v = val.trim().replace(/^['"]|['"]$/g, '');
    if (key === 'id') id = v;
    else if (key === 'created') created = v;
    else if (key === 'modified') modified = v;
    else if (key === 'tags') {
      // Could be inline [tag1, tag2] or start of list
      const inline = val.trim().match(/^\[(.+)\]/);
      if (inline) {
        tags.push(...inline[1].split(',').map(t => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
      } else {
        inTags = true;
      }
    }
  }
  return { id, tags, created, modified };
}

function serializeNote(
  id: string,
  tags: string[],
  created: string,
  modified: string,
  content: string,
): string {
  const tagsYaml = tags.length > 0
    ? `tags:\n${tags.map(t => `  - ${t}`).join('\n')}\n`
    : 'tags: []\n';
  const fm = `---\nid: ${id}\n${tagsYaml}created: '${created}'\nmodified: '${modified}'\n---\n`;
  return content ? `${fm}${content}\n` : fm;
}

// Keep FM_DELIM used only for splitting guard
void FM_DELIM;

function titleFromFilename(filename: string): string {
  return filename.endsWith('.md') ? filename.slice(0, -3) : filename;
}

function sanitizeFilename(title: string): string {
  const s = title.replace(/[/\\:*?"<>|]/g, '').trim();
  return s || 'Untitled';
}

async function resolveConflict(
  dir: FileSystemDirectoryHandle,
  filename: string,
): Promise<string> {
  const ext = '.md';
  const base = filename.endsWith(ext) ? filename.slice(0, -ext.length) : filename;
  let candidate = filename;
  let counter = 2;
  const existing = new Set<string>();
  for await (const [name] of (dir as any).entries()) existing.add(name);
  while (existing.has(candidate)) {
    candidate = `${base} ${counter}${ext}`;
    counter++;
  }
  return candidate;
}

function makeSnippet(content: string): string {
  return content.replace(/[#\n]/g, ' ').trim().slice(0, 120);
}

function now(): string {
  return new Date().toISOString();
}

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

// ── Notes API ─────────────────────────────────────────────────────────────

export const notes = {
  async list(params?: { notebook?: string; tag?: string; trash?: boolean }): Promise<NoteSummary[]> {
    const root = await requireVault();
    const isTrash = params?.trash === true;

    let paths: string[];
    if (isTrash) {
      try {
        const trashDir = await root.getDirectoryHandle('.trash');
        paths = await collectMdFiles(trashDir, '', false);
        paths = paths.map((p) => `.trash/${p}`);
      } catch {
        return [];
      }
    } else if (params?.notebook) {
      // Navigate directly to the notebook directory — faster and avoids scanning everything
      try {
        const nbDir = await getDirHandle(root, params.notebook);
        const filenames = await collectMdFiles(nbDir, '', false);
        paths = filenames.map((f) => `${params.notebook}/${f}`);
      } catch (err) {
        console.error('[FSA] notes.list: failed to open notebook dir', params.notebook, err);
        return [];
      }
    } else {
      paths = await collectMdFiles(root, '');
    }

    const summaries: NoteSummary[] = [];
    for (const relPath of paths) {
      try {
        const raw = await readTextFile(root, relPath);
        const parsed = parseNote(raw);
        const parts = relPath.split('/');
        const filename = parts[parts.length - 1];
        const notebook = parts.slice(0, -1).join('/');

        if (params?.tag && !parsed.tags.includes(params.tag)) continue;

        summaries.push({
          id: parsed.id || relPath,
          title: titleFromFilename(filename),
          path: relPath,
          notebook,
          tags: parsed.tags,
          created: parsed.created,
          modified: parsed.modified,
          snippet: makeSnippet(parsed.content),
        });
      } catch (err) {
        console.error('[FSA] notes.list: skipping unreadable file', relPath, err);
      }
    }

    return summaries.sort((a, b) => b.modified.localeCompare(a.modified));
  },

  async get(notePath: string): Promise<NoteData> {
    const root = await requireVault();
    const raw = await readTextFile(root, notePath);
    const parsed = parseNote(raw);
    const parts = notePath.split('/');
    const filename = parts[parts.length - 1];
    const notebook = parts.slice(0, -1).join('/');
    return {
      id: parsed.id || notePath,
      title: titleFromFilename(filename),
      content: parsed.content,
      path: notePath,
      notebook,
      tags: parsed.tags,
      created: parsed.created,
      modified: parsed.modified,
      isTrashed: notePath.startsWith('.trash/'),
    };
  },

  async create(notebook: string, title?: string): Promise<NoteData> {
    const root = await requireVault();
    const noteTitle = (title?.trim()) || 'Untitled';
    const id = generateId();
    const ts = now();

    const notebookDir = await getDirHandle(root, notebook, true);
    const sanitized = sanitizeFilename(noteTitle);
    const filename = await resolveConflict(notebookDir, `${sanitized}.md`);
    const relPath = `${notebook}/${filename}`;

    const markdown = serializeNote(id, [], ts, ts, '');
    await writeTextFile(root, relPath, markdown);

    return {
      id, title: noteTitle, content: '', path: relPath,
      notebook, tags: [], created: ts, modified: ts, isTrashed: false,
    };
  },

  async save(notePath: string, title: string, content: string, tags: string[]): Promise<NoteData> {
    const root = await requireVault();
    let currentRaw = '';
    try { currentRaw = await readTextFile(root, notePath); } catch { /* new file */ }

    const existing = currentRaw ? parseNote(currentRaw) : null;
    const id = existing?.id || generateId();
    const created = existing?.created || now();
    const modified = now();

    const parts = notePath.split('/');
    const currentFilename = parts[parts.length - 1];
    const currentTitle = titleFromFilename(currentFilename);
    const notebook = parts.slice(0, -1).join('/');

    let finalPath = notePath;

    // Rename file if title changed
    if (title !== currentTitle) {
      const dir = await getDirHandle(root, notebook);
      const sanitized = sanitizeFilename(title);
      const newFilename = await resolveConflict(dir, `${sanitized}.md`);
      finalPath = `${notebook}/${newFilename}`;
      // Delete old file
      try {
        const dirHandle = await getDirHandle(root, notebook);
        await dirHandle.removeEntry(currentFilename);
      } catch { /* ignore */ }
    }

    const markdown = serializeNote(id, tags, created, modified, content);
    await writeTextFile(root, finalPath, markdown);

    return {
      id, title, content, path: finalPath,
      notebook, tags, created, modified, isTrashed: false,
    };
  },

  async delete(notePath: string): Promise<boolean> {
    const root = await requireVault();
    try {
      const trashDir = await root.getDirectoryHandle('.trash', { create: true });
      const raw = await readTextFile(root, notePath);
      const parts = notePath.split('/');
      const filename = parts[parts.length - 1];
      const destFilename = await resolveConflict(trashDir, filename);

      // Write to trash
      await writeTextFile(root, `.trash/${destFilename}`, raw);

      // Remove from original location
      const notebookDir = await getDirHandle(root, parts.slice(0, -1).join('/'));
      await notebookDir.removeEntry(filename);
      return true;
    } catch (e) {
      throw new Error(`Failed to delete note: ${e}`);
    }
  },

  async move(fromPath: string, toNotebook: string): Promise<NoteData> {
    const root = await requireVault();
    const raw = await readTextFile(root, fromPath);
    const parts = fromPath.split('/');
    const filename = parts[parts.length - 1];

    const destDir = await getDirHandle(root, toNotebook, true);
    const destFilename = await resolveConflict(destDir, filename);
    const destPath = `${toNotebook}/${destFilename}`;

    await writeTextFile(root, destPath, raw);
    const srcDir = await getDirHandle(root, parts.slice(0, -1).join('/'));
    await srcDir.removeEntry(filename);

    return this.get(destPath);
  },

  async duplicate(notePath: string): Promise<NoteData> {
    const root = await requireVault();
    const raw = await readTextFile(root, notePath);
    const parsed = parseNote(raw);
    const parts = notePath.split('/');
    const filename = parts[parts.length - 1];
    const notebook = parts.slice(0, -1).join('/');
    const title = titleFromFilename(filename);

    const dir = await getDirHandle(root, notebook);
    const copyFilename = await resolveConflict(dir, `${sanitizeFilename(title)} copy.md`);
    const copyPath = `${notebook}/${copyFilename}`;

    const ts = now();
    const newMarkdown = serializeNote(generateId(), parsed.tags, parsed.created, ts, parsed.content);
    await writeTextFile(root, copyPath, newMarkdown);
    return this.get(copyPath);
  },

  async restore(trashPath: string, targetNotebook?: string): Promise<NoteData> {
    const root = await requireVault();
    const raw = await readTextFile(root, trashPath);
    const filename = trashPath.split('/').pop()!;
    const notebook = targetNotebook || 'Inbox';

    const destDir = await getDirHandle(root, notebook, true);
    const destFilename = await resolveConflict(destDir, filename);
    const destPath = `${notebook}/${destFilename}`;

    await writeTextFile(root, destPath, raw);
    const trashDir = await root.getDirectoryHandle('.trash');
    await trashDir.removeEntry(filename);
    return this.get(destPath);
  },

  async permanentDelete(trashPath: string): Promise<boolean> {
    const root = await requireVault();
    const filename = trashPath.split('/').pop()!;
    const trashDir = await root.getDirectoryHandle('.trash');
    await trashDir.removeEntry(filename);
    return true;
  },

  async emptyTrash(): Promise<number> {
    const root = await requireVault();
    let count = 0;
    try {
      const trashDir = await root.getDirectoryHandle('.trash');
      const toDelete: string[] = [];
      for await (const [name, handle] of (trashDir as any).entries()) {
        if (handle.kind === 'file' && name.endsWith('.md')) toDelete.push(name);
      }
      for (const name of toDelete) {
        await trashDir.removeEntry(name);
        count++;
      }
    } catch { /* no trash dir */ }
    return count;
  },
};

// ── Notebooks API ─────────────────────────────────────────────────────────

export const notebooks = {
  async list(): Promise<NotebookInfo[]> {
    const root = await requireVault();
    const result: NotebookInfo[] = [];

    for await (const [name, handle] of (root as any).entries()) {
      if (handle.kind !== 'directory' || SKIP_DIRS.has(name) || name.startsWith('.')) continue;
      const dir = handle as FileSystemDirectoryHandle;

      // Count direct .md files
      let directNotes = 0;
      const subDirs: Array<[string, FileSystemDirectoryHandle]> = [];
      for await (const [subName, subHandle] of (dir as any).entries()) {
        if (subHandle.kind === 'file' && subName.endsWith('.md')) directNotes++;
        else if (subHandle.kind === 'directory' && !subName.startsWith('.')) {
          subDirs.push([subName, subHandle as FileSystemDirectoryHandle]);
        }
      }

      if (directNotes > 0 || subDirs.length === 0) {
        result.push({ name, path: name, stack: null, noteCount: directNotes });
      }

      for (const [subName, subDir] of subDirs) {
        let subNotes = 0;
        for await (const [fn] of (subDir as any).entries()) {
          if (typeof fn === 'string' && fn.endsWith('.md')) subNotes++;
        }
        result.push({ name: subName, path: `${name}/${subName}`, stack: name, noteCount: subNotes });
      }
    }

    return result.sort((a, b) => a.path.localeCompare(b.path));
  },

  async create(name: string, stack?: string): Promise<NotebookInfo> {
    const root = await requireVault();
    const relPath = stack ? `${stack}/${name}` : name;
    await getDirHandle(root, relPath, true);
    return { name, path: relPath, stack: stack ?? null, noteCount: 0 };
  },

  async rename(oldPath: string, newName: string): Promise<NotebookInfo> {
    // FSA doesn't support rename — copy all files then delete originals
    const root = await requireVault();
    const parts = oldPath.split('/');
    const parentPath = parts.slice(0, -1).join('/');
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;

    const srcDir = await getDirHandle(root, oldPath);
    const destDir = await getDirHandle(root, newPath, true);

    // Copy all .md files
    let noteCount = 0;
    for await (const [name, handle] of (srcDir as any).entries()) {
      if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile();
        const content = await file.text();
        await writeTextFile(root, `${newPath}/${name}`, content);
        if (name.endsWith('.md')) noteCount++;
      }
    }

    // Remove old dir entries
    for await (const [name] of (srcDir as any).entries()) {
      await srcDir.removeEntry(name);
    }
    const parent = parentPath ? await getDirHandle(root, parentPath) : root;
    await parent.removeEntry(parts[parts.length - 1]);

    const stack = parts.length > 1 ? parentPath : null;
    return { name: newName, path: newPath, stack, noteCount };
  },

  async delete(notebookPath: string): Promise<boolean> {
    const root = await requireVault();
    const parts = notebookPath.split('/');
    const parent = parts.length > 1
      ? await getDirHandle(root, parts.slice(0, -1).join('/'))
      : root;
    await parent.removeEntry(parts[parts.length - 1], { recursive: true });
    return true;
  },

  async move(notebookPath: string, targetStack?: string): Promise<NotebookInfo> {
    const root = await requireVault();
    const name = notebookPath.split('/').pop()!;
    const newPath = targetStack ? `${targetStack}/${name}` : name;

    const srcDir = await getDirHandle(root, notebookPath);
    const destDir = await getDirHandle(root, newPath, true);

    let noteCount = 0;
    for await (const [fname, fhandle] of (srcDir as any).entries()) {
      if (fhandle.kind === 'file') {
        const file = await (fhandle as FileSystemFileHandle).getFile();
        const content = await file.text();
        await writeTextFile(root, `${newPath}/${fname}`, content);
        if (fname.endsWith('.md')) noteCount++;
      }
    }

    // Remove old
    const oldParts = notebookPath.split('/');
    const oldParent = oldParts.length > 1
      ? await getDirHandle(root, oldParts.slice(0, -1).join('/'))
      : root;
    await oldParent.removeEntry(name, { recursive: true });

    return { name, path: newPath, stack: targetStack ?? null, noteCount };
  },
};

// ── Tags API ──────────────────────────────────────────────────────────────

async function getAllTagCounts(root: FileSystemDirectoryHandle): Promise<Map<string, number>> {
  const paths = await collectMdFiles(root, '');
  const counts = new Map<string, number>();
  for (const p of paths) {
    try {
      const raw = await readTextFile(root, p);
      const parsed = parseNote(raw);
      for (const tag of parsed.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    } catch { /* skip */ }
  }
  return counts;
}

export const tags = {
  async list(): Promise<TagInfo[]> {
    const root = await requireVault();
    const counts = await getAllTagCounts(root);
    return [...counts.entries()]
      .map(([name, noteCount]) => ({ name, noteCount }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async rename(oldName: string, newName: string): Promise<number> {
    const root = await requireVault();
    const paths = await collectMdFiles(root, '');
    let updated = 0;
    for (const p of paths) {
      try {
        const raw = await readTextFile(root, p);
        const parsed = parseNote(raw);
        if (parsed.tags.includes(oldName)) {
          const newTags = parsed.tags.map((t) => (t === oldName ? newName : t));
          const markdown = serializeNote(parsed.id, newTags, parsed.created, now(), parsed.content);
          await writeTextFile(root, p, markdown);
          updated++;
        }
      } catch { /* skip */ }
    }
    return updated;
  },

  async autocomplete(prefix: string): Promise<TagInfo[]> {
    const root = await requireVault();
    const counts = await getAllTagCounts(root);
    const lower = prefix.toLowerCase();
    return [...counts.entries()]
      .filter(([name]) => name.toLowerCase().startsWith(lower))
      .map(([name, noteCount]) => ({ name, noteCount }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
};

// ── Search API ────────────────────────────────────────────────────────────

export const search = {
  async query(
    q: string,
    filters?: { notebook?: string; tag?: string },
  ): Promise<SearchResult[]> {
    const root = await requireVault();
    const paths = await collectMdFiles(root, '');
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const results: SearchResult[] = [];

    for (const relPath of paths) {
      try {
        const raw = await readTextFile(root, relPath);
        const parsed = parseNote(raw);
        const parts = relPath.split('/');
        const filename = parts[parts.length - 1];
        const notebook = parts.slice(0, -1).join('/');
        const title = titleFromFilename(filename);

        if (filters?.notebook && notebook !== filters.notebook) continue;
        if (filters?.tag && !parsed.tags.includes(filters.tag)) continue;

        const haystack = `${title} ${parsed.content} ${parsed.tags.join(' ')}`.toLowerCase();
        const matchCount = terms.filter((t) => haystack.includes(t)).length;
        if (matchCount === 0) continue;

        // Build snippet around first match
        const firstTerm = terms[0];
        const idx = parsed.content.toLowerCase().indexOf(firstTerm);
        const snippet = idx >= 0
          ? '…' + parsed.content.slice(Math.max(0, idx - 30), idx + 90) + '…'
          : makeSnippet(parsed.content);

        results.push({
          noteId: parsed.id || relPath,
          title,
          snippet,
          notebook,
          tags: parsed.tags,
          modified: parsed.modified,
          rank: matchCount,
        });
      } catch { /* skip */ }
    }

    return results.sort((a, b) => b.rank - a.rank).slice(0, 50);
  },

  async rebuildIndex(): Promise<{ count: number }> {
    const root = await requireVault();
    const paths = await collectMdFiles(root, '');
    return { count: paths.length };
  },
};

// ── System API ────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  vaultPath: '',
  theme: 'system',
  autoSaveDelayMs: 1000,
  recentVaults: [],
};

export const system = {
  async getVaultPath(): Promise<string> {
    const stored = await idbGet<AppSettings>(SETTINGS_KEY);
    return stored?.vaultPath ?? '';
  },

  async setVaultPath(path: string): Promise<{ success: boolean }> {
    const current = (await idbGet<AppSettings>(SETTINGS_KEY)) ?? { ...DEFAULT_SETTINGS };
    await idbSet(SETTINGS_KEY, { ...current, vaultPath: path });
    return { success: true };
  },

  async pickVaultFolder(): Promise<string | null> {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      await handle.requestPermission({ mode: 'readwrite' });
      _vaultHandle = handle;
      await idbSet(HANDLE_KEY, handle);
      const name: string = handle.name;
      await this.setVaultPath(name);
      return name;
    } catch {
      return null; // User cancelled
    }
  },

  async getSettings(): Promise<AppSettings> {
    const stored = await idbGet<AppSettings>(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...stored };
  },

  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const merged = { ...current, ...updates };
    await idbSet(SETTINGS_KEY, merged);
    return merged;
  },

  exportVault(): Promise<unknown> {
    return Promise.reject(new Error('exportVault not yet implemented in PWA'));
  },
  importData(_data: unknown): Promise<{ success: boolean }> {
    return Promise.reject(new Error('importData not yet implemented in PWA'));
  },
  migrate(_dbPath: string, _vaultPath: string): Promise<MigrationSummary> {
    return Promise.reject(new Error('migrate not yet implemented in PWA'));
  },
  pickDatabaseFile(): Promise<string | null> {
    return Promise.reject(new Error('pickDatabaseFile not yet implemented in PWA'));
  },
};

// ── Images API ────────────────────────────────────────────────────────────

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

export const images = {
  async save(
    notebook: string,
    imageData: ArrayBuffer,
    mimeType: string,
  ): Promise<{ path: string }> {
    const root = await requireVault();
    const ext = MIME_TO_EXT[mimeType] ?? '.png';
    const id = generateId().slice(0, 12);
    const filename = `${id}${ext}`;
    const relPath = `${notebook}/.images/${filename}`;
    await writeBinaryFile(root, relPath, imageData);
    return { path: `.images/${filename}` };
  },
};

// ── Conflicts API ─────────────────────────────────────────────────────────

const CONFLICT_PATTERNS: Array<{
  re: RegExp;
  provider: ConflictFile['provider'];
  original: (m: RegExpMatchArray) => string;
}> = [
  { re: /^(.+?)\s+\([^)]*conflicted copy[^)]*\)(\.\w+)$/i, provider: 'dropbox', original: (m) => `${m[1]}${m[2]}` },
  { re: /^(.+?)\s+\(conflict\)(\.\w+)$/i, provider: 'icloud', original: (m) => `${m[1]}${m[2]}` },
  { re: /^(.+?)\s+\(\d+\)(\.\w+)$/, provider: 'google-drive', original: (m) => `${m[1]}${m[2]}` },
];

export const conflicts = {
  async detect(): Promise<ConflictFile[]> {
    const root = await requireVault();
    const paths = await collectMdFiles(root, '');
    const found: ConflictFile[] = [];

    for (const relPath of paths) {
      const filename = relPath.split('/').pop()!;
      for (const { re, provider, original } of CONFLICT_PATTERNS) {
        const m = filename.match(re);
        if (m) {
          const dir = relPath.split('/').slice(0, -1).join('/');
          const origName = original(m);
          found.push({
            conflictPath: relPath,
            originalPath: dir ? `${dir}/${origName}` : origName,
            provider,
          });
          break;
        }
      }
    }

    return found;
  },
};

// ── Vault readiness check ─────────────────────────────────────────────────

/** Returns true if a vault handle is already stored and accessible. */
export async function isVaultReady(): Promise<boolean> {
  try {
    const handle = await getVaultHandle();
    return handle !== null;
  } catch {
    return false;
  }
}
