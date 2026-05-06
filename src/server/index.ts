/**
 * ThoughtStack HTTP Server
 *
 * Lightweight Node.js HTTP server that exposes the same API as the Electron
 * IPC handlers, allowing the app to run in a browser when Electron is blocked
 * (e.g., macOS Sequoia com.apple.provenance enforcement).
 *
 * Uses only node: built-in modules — no external HTTP framework required.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { URL } from 'node:url';

// ── Vault layer imports ────────────────────────────────────────────

import { resolveVaultPath, initializeVault } from '../../electron/vault/index';
import { createNote, getNote, saveNote, listNotes, deleteNote, moveNote, duplicateNote } from '../../electron/vault/notes';
import { listNotebooks, createNotebook, renameNotebook, deleteNotebook, addIgnorePattern } from '../../electron/vault/notebooks';
import { saveImage } from '../../electron/vault/images';
import { restore, permanentDelete, emptyTrash } from '../../electron/vault/trash';
import { detectConflicts } from '../../electron/vault/conflicts';
import { parseFrontmatter, serializeNote } from '../../electron/vault/markdown';
import { titleFromFilename } from '../../electron/vault/sanitize';

// ── Search index imports ───────────────────────────────────────────

import { ensureSearchIndex, searchNotes, rebuildIndexFull, updateNoteIndex } from '../../electron/index/index';

// ── Config imports ─────────────────────────────────────────────────

import { loadAppConfig, saveAppConfig } from '../../electron/config';
import type { AppSettings } from '../../electron/config';
import type Database from 'better-sqlite3';

// ── Configuration ──────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const VAULT_PATH = process.env.VAULT_PATH ?? path.join(os.homedir(), 'ThoughtStack');

// ── State ──────────────────────────────────────────────────────────

let vaultPath = VAULT_PATH;
let db: Database.Database;

// ── Helpers ────────────────────────────────────────────────────────

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function error(res: http.ServerResponse, message: string, status = 500): void {
  json(res, { error: message }, status);
}

function cors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function parseJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  if (!body) return {};
  return JSON.parse(body);
}

/**
 * Decode a path parameter that may contain slashes (e.g., "Notebook/Note.md").
 * The path comes after a prefix like "/api/notes/".
 */
function extractPath(url: string, prefix: string): string {
  const raw = url.slice(prefix.length);
  // Remove query string if present
  const qIdx = raw.indexOf('?');
  const pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  return decodeURIComponent(pathPart);
}

// ── Tag helpers (same logic as electron/ipc/tags.ipc.ts) ───────────

interface TagInfo {
  name: string;
  noteCount: number;
}

function aggregateTags(): TagInfo[] {
  const notes = listNotes(vaultPath);
  const tagCounts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const result: TagInfo[] = [];
  for (const [name, noteCount] of tagCounts) {
    result.push({ name, noteCount });
  }
  result.sort((a, b) => b.noteCount - a.noteCount);
  return result;
}

function renameTag(oldName: string, newName: string): number {
  const resolved = resolveVaultPath(vaultPath);
  const notes = listNotes(vaultPath);
  let updatedCount = 0;
  for (const note of notes) {
    if (!note.tags.includes(oldName)) continue;
    const fullPath = path.join(resolved, note.path);
    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const { data, content } = parseFrontmatter(fileContent);
    const newTags = data.tags.map((t: string) => (t === oldName ? newName : t));
    const uniqueTags = [...new Set(newTags)];
    const title = titleFromFilename(path.basename(note.path));
    const markdown = serializeNote({ ...data, title, tags: uniqueTags, content });
    fs.writeFileSync(fullPath, markdown, 'utf-8');
    updatedCount++;
  }
  return updatedCount;
}

// ── MIME type lookup ───────────────────────────────────────────────

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

// ── Route matching ─────────────────────────────────────────────────

function match(method: string, urlPath: string, reqMethod: string, reqPath: string): boolean {
  return reqMethod === method && reqPath.startsWith(urlPath);
}

function exactMatch(method: string, urlPath: string, reqMethod: string, reqPath: string): boolean {
  return reqMethod === method && reqPath === urlPath;
}

// ── Request handler ────────────────────────────────────────────────

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const urlPath = parsedUrl.pathname;
  const method = req.method ?? 'GET';

  try {
    // ── Notes ────────────────────────────────────────────────────

    if (exactMatch('POST', '/api/notes/empty-trash', method, urlPath)) {
      const count = emptyTrash(vaultPath);
      return json(res, { count });
    }

    if (exactMatch('GET', '/api/notes', method, urlPath)) {
      const notebook = parsedUrl.searchParams.get('notebook') ?? undefined;
      const tag = parsedUrl.searchParams.get('tag') ?? undefined;
      const trash = parsedUrl.searchParams.get('trash') === 'true' ? true : undefined;
      const result = listNotes(vaultPath, { notebook, tag, trash });
      return json(res, result);
    }

    if (exactMatch('POST', '/api/notes', method, urlPath)) {
      const body = await parseJson(req);
      const notebook = body.notebook as string;
      const title = (body.title as string) ?? undefined;
      const result = createNote(vaultPath, notebook, title);
      updateNoteIndex(db, vaultPath, result.path);
      return json(res, result, 201);
    }

    // Note-specific actions (must check before generic GET/PUT/DELETE :path)
    if (method === 'POST' && urlPath.startsWith('/api/notes/') && urlPath.endsWith('/move')) {
      const notePath = extractPath(urlPath, '/api/notes/').replace(/\/move$/, '');
      const body = await parseJson(req);
      const toNotebook = body.toNotebook as string;
      const result = moveNote(vaultPath, notePath, toNotebook);
      updateNoteIndex(db, vaultPath, result.path);
      return json(res, result);
    }

    if (method === 'POST' && urlPath.startsWith('/api/notes/') && urlPath.endsWith('/duplicate')) {
      const notePath = extractPath(urlPath, '/api/notes/').replace(/\/duplicate$/, '');
      const result = duplicateNote(vaultPath, notePath);
      updateNoteIndex(db, vaultPath, result.path);
      return json(res, result, 201);
    }

    if (method === 'POST' && urlPath.startsWith('/api/notes/') && urlPath.endsWith('/restore')) {
      const notePath = extractPath(urlPath, '/api/notes/').replace(/\/restore$/, '');
      const body = await parseJson(req);
      const targetNotebook = (body.targetNotebook as string) ?? undefined;
      // For trash restore, the path is like ".trash/Note.md" — we need just the filename
      const trashFilename = path.basename(notePath);
      const result = restore(vaultPath, trashFilename, targetNotebook);
      updateNoteIndex(db, vaultPath, result.path);
      return json(res, result);
    }

    if (method === 'DELETE' && urlPath.startsWith('/api/notes/') && urlPath.endsWith('/permanent')) {
      const notePath = extractPath(urlPath, '/api/notes/').replace(/\/permanent$/, '');
      const trashFilename = path.basename(notePath);
      const result = permanentDelete(vaultPath, trashFilename);
      return json(res, { success: result });
    }

    if (method === 'GET' && urlPath.startsWith('/api/notes/') && !urlPath.includes('/empty-trash')) {
      const notePath = extractPath(urlPath, '/api/notes/');
      const result = getNote(vaultPath, notePath);
      return json(res, result);
    }

    if (method === 'PUT' && urlPath.startsWith('/api/notes/')) {
      const notePath = extractPath(urlPath, '/api/notes/');
      const body = await parseJson(req);
      const title = body.title as string;
      const content = body.content as string;
      const tags = body.tags as string[];
      const result = saveNote(vaultPath, notePath, title, content, tags);
      updateNoteIndex(db, vaultPath, result.path);
      return json(res, result);
    }

    if (method === 'DELETE' && urlPath.startsWith('/api/notes/')) {
      const notePath = extractPath(urlPath, '/api/notes/');
      const result = deleteNote(vaultPath, notePath);
      return json(res, { success: result });
    }

    // ── Notebooks ────────────────────────────────────────────────

    if (exactMatch('GET', '/api/notebooks', method, urlPath)) {
      return json(res, listNotebooks(vaultPath));
    }

    if (exactMatch('POST', '/api/notebooks', method, urlPath)) {
      const body = await parseJson(req);
      const name = body.name as string;
      const stack = (body.stack as string) ?? undefined;
      const result = createNotebook(vaultPath, name, stack);
      return json(res, result, 201);
    }

    if (method === 'PUT' && urlPath.startsWith('/api/notebooks/')) {
      const nbPath = extractPath(urlPath, '/api/notebooks/');
      const body = await parseJson(req);
      const newName = body.newName as string;
      const result = renameNotebook(vaultPath, nbPath, newName);
      return json(res, result);
    }

    if (method === 'DELETE' && urlPath.startsWith('/api/notebooks/')) {
      const nbPath = extractPath(urlPath, '/api/notebooks/');
      const result = deleteNotebook(vaultPath, nbPath);
      return json(res, { success: result });
    }

    if (exactMatch('POST', '/api/notebooks/ignore', method, urlPath)) {
      const body = await parseJson(req);
      const notebookPath = body.notebookPath as string;
      addIgnorePattern(vaultPath, notebookPath);
      return json(res, { success: true });
    }

    // ── Tags ─────────────────────────────────────────────────────

    if (match('GET', '/api/tags/autocomplete', method, urlPath)) {
      const prefix = parsedUrl.searchParams.get('prefix') ?? '';
      const allTags = aggregateTags();
      const lowerPrefix = prefix.toLowerCase();
      const filtered = allTags.filter(t => t.name.toLowerCase().startsWith(lowerPrefix));
      return json(res, filtered);
    }

    if (exactMatch('GET', '/api/tags', method, urlPath)) {
      return json(res, aggregateTags());
    }

    if (method === 'PUT' && urlPath.startsWith('/api/tags/')) {
      const tagName = decodeURIComponent(urlPath.slice('/api/tags/'.length));
      const body = await parseJson(req);
      const newName = body.newName as string;
      const count = renameTag(tagName, newName);
      return json(res, { count });
    }

    // ── Search ───────────────────────────────────────────────────

    if (exactMatch('POST', '/api/search/rebuild', method, urlPath)) {
      const count = rebuildIndexFull(db, vaultPath);
      return json(res, { count });
    }

    if (match('GET', '/api/search', method, urlPath)) {
      const q = parsedUrl.searchParams.get('q') ?? '';
      const notebook = parsedUrl.searchParams.get('notebook') ?? undefined;
      const tag = parsedUrl.searchParams.get('tag') ?? undefined;
      const results = searchNotes(db, q, { notebook, tag });
      return json(res, results);
    }

    // ── System ───────────────────────────────────────────────────

    if (exactMatch('GET', '/api/system/settings', method, urlPath)) {
      const settings = loadAppConfig();
      // Override vaultPath with the server's active vault path
      return json(res, { ...settings, vaultPath });
    }

    if (exactMatch('PUT', '/api/system/settings', method, urlPath)) {
      const body = await parseJson(req) as Partial<AppSettings>;
      const current = loadAppConfig();
      const updated: AppSettings = {
        vaultPath: typeof body.vaultPath === 'string' ? body.vaultPath : current.vaultPath,
        theme: isValidTheme(body.theme) ? body.theme : current.theme,
        autoSaveDelayMs: typeof body.autoSaveDelayMs === 'number' ? body.autoSaveDelayMs : current.autoSaveDelayMs,
        recentVaults: Array.isArray(body.recentVaults) ? body.recentVaults : current.recentVaults,
      };
      saveAppConfig(updated);
      return json(res, updated);
    }

    // ── Conflicts ────────────────────────────────────────────────

    if (exactMatch('GET', '/api/conflicts', method, urlPath)) {
      return json(res, detectConflicts(vaultPath));
    }

    // ── Images ───────────────────────────────────────────────────

    if (exactMatch('POST', '/api/images', method, urlPath)) {
      const body = await parseJson(req);
      const notebook = body.notebook as string;
      const imageData = body.imageData as string; // base64
      const mimeType = body.mimeType as string;
      const buffer = Buffer.from(imageData, 'base64');
      const relativePath = saveImage(vaultPath, notebook, buffer, mimeType);
      return json(res, { path: relativePath }, 201);
    }

    // ── Vault images (serve files) ───────────────────────────────

    if (method === 'GET' && urlPath.startsWith('/api/vault-images/')) {
      const imagePath = decodeURIComponent(urlPath.slice('/api/vault-images/'.length));
      const resolved = resolveVaultPath(vaultPath);
      const fullPath = path.join(resolved, imagePath);

      // Security: ensure the resolved path is within the vault
      const realPath = path.resolve(fullPath);
      const realVault = path.resolve(resolved);
      if (!realPath.startsWith(realVault)) {
        return error(res, 'Forbidden', 403);
      }

      if (!fs.existsSync(fullPath)) {
        return error(res, 'Image not found', 404);
      }

      const ext = path.extname(fullPath).toLowerCase();
      const contentType = EXT_TO_MIME[ext] ?? 'application/octet-stream';
      const data = fs.readFileSync(fullPath);

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': data.length,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
      return;
    }

    // ── AI proxy (avoids mixed-content when app is served over HTTPS) ──

    if (exactMatch('POST', '/api/ai/proxy', method, urlPath)) {
      const body = await readBody(req);
      const { targetUrl, apiKey, payload } = JSON.parse(body) as {
        targetUrl: string;
        apiKey?: string;
        payload: unknown;
      };

      const upstream = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      });

      if (upstream.body) {
        const reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }

    // ── 404 ──────────────────────────────────────────────────────

    error(res, `Not found: ${method} ${urlPath}`, 404);
  } catch (err) {
    console.error(`[${method} ${urlPath}]`, err);
    error(res, err instanceof Error ? err.message : String(err), 500);
  }
}

function isValidTheme(value: unknown): value is 'light' | 'dark' | 'system' {
  return value === 'light' || value === 'dark' || value === 'system';
}

// ── Server startup ─────────────────────────────────────────────────

function start(): void {
  console.log(`[ThoughtStack Server] Vault path: ${vaultPath}`);

  // Initialize vault if needed
  const resolved = resolveVaultPath(vaultPath);
  if (!fs.existsSync(resolved)) {
    console.log('[ThoughtStack Server] Creating vault directory...');
  }
  initializeVault(vaultPath);

  // Initialize search index
  console.log('[ThoughtStack Server] Building search index...');
  db = ensureSearchIndex(vaultPath);
  console.log('[ThoughtStack Server] Search index ready.');

  const server = http.createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(`[ThoughtStack Server] Listening on http://localhost:${PORT}`);
    console.log(`[ThoughtStack Server] API ready — connect your browser to the Vite dev server.`);
  });
}

start();
