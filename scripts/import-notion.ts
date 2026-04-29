/**
 * Import Notion HTML export into ThoughtRepo.
 *
 * Usage: node --experimental-strip-types scripts/import-notion.ts /path/to/notion/export/dir
 *
 * Reads all .html files from the Notion export directory, converts them to
 * TipTap JSON, and imports them into ThoughtRepo via the API.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const BASE = 'http://localhost:3000/api';

// ── API helpers ────────────────────────────────────────────────────

async function post(path: string, body: object) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 207) {
    const err = await res.text();
    throw new Error(`POST ${path} failed (${res.status}): ${err}`);
  }
  return res.json();
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

// ── HTML to TipTap JSON conversion ─────────────────────────────────

/**
 * Very simple HTML-to-TipTap converter. Handles the common Notion HTML
 * elements: paragraphs, headings, lists, code blocks, blockquotes,
 * links, bold, italic, images, tables, and horizontal rules.
 *
 * This is a regex-based parser (not a full DOM parser) since we're
 * running in Node.js without jsdom. It handles the 90% case for
 * Notion exports.
 */
function htmlToTipTap(html: string): object {
  // Extract the page-body content
  const bodyMatch = html.match(/<div class="page-body">([\s\S]*?)(?:<\/article>|$)/);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;

  const blocks: object[] = [];
  // Process the HTML line by line, building TipTap blocks
  const cleaned = bodyHtml
    // Remove Notion's wrapper divs
    .replace(/<div style="display:contents"[^>]*>/g, '')
    .replace(/<\/div>/g, '')
    // Remove figure wrappers but keep content
    .replace(/<figure[^>]*>/g, '')
    .replace(/<\/figure>/g, '')
    // Normalize whitespace
    .replace(/\r\n/g, '\n');

  // Split into block-level elements
  const blockRegex = /<(h[1-3]|p|ul|ol|pre|blockquote|hr|table|img)[^>]*>([\s\S]*?)<\/\1>|<(hr|img)\s*[^>]*\/?>/gi;

  let match;
  let lastIndex = 0;

  while ((match = blockRegex.exec(cleaned)) !== null) {
    const fullMatch = match[0];
    const tag = (match[1] || match[3] || '').toLowerCase();
    const inner = match[2] || '';

    if (tag === 'hr') {
      blocks.push({ type: 'horizontalRule' });
    } else if (tag === 'img') {
      const srcMatch = fullMatch.match(/src="([^"]+)"/);
      if (srcMatch) {
        blocks.push({
          type: 'image',
          attrs: { src: srcMatch[1] },
        });
      }
    } else if (tag.startsWith('h')) {
      const level = parseInt(tag[1]);
      blocks.push({
        type: 'heading',
        attrs: { level },
        content: parseInline(inner),
      });
    } else if (tag === 'p') {
      const inlineContent = parseInline(inner);
      if (inlineContent.length > 0) {
        blocks.push({
          type: 'paragraph',
          content: inlineContent,
        });
      }
    } else if (tag === 'ul' || tag === 'ol') {
      blocks.push(parseList(inner, tag === 'ol'));
    } else if (tag === 'pre') {
      const codeMatch = inner.match(/<code[^>]*>([\s\S]*?)<\/code>/i);
      const codeText = codeMatch ? stripTags(codeMatch[1]) : stripTags(inner);
      blocks.push({
        type: 'codeBlock',
        content: [{ type: 'text', text: decodeEntities(codeText) }],
      });
    } else if (tag === 'blockquote') {
      blocks.push({
        type: 'blockquote',
        content: [{
          type: 'paragraph',
          content: parseInline(stripTags(inner)),
        }],
      });
    } else if (tag === 'table') {
      blocks.push(parseTable(inner));
    }
  }

  // If no blocks were parsed, treat the whole thing as a paragraph
  if (blocks.length === 0) {
    const text = stripTags(cleaned).trim();
    if (text) {
      blocks.push({
        type: 'paragraph',
        content: [{ type: 'text', text }],
      });
    }
  }

  return { type: 'doc', content: blocks };
}

function parseInline(html: string): object[] {
  const nodes: object[] = [];
  // Remove nested block elements that shouldn't be inline
  const cleaned = html.replace(/<\/?(?:div|figure|figcaption)[^>]*>/gi, '');

  // Handle images inline
  const imgRegex = /<img[^>]*src="([^"]*)"[^>]*\/?>/gi;
  let imgMatch;
  let lastIdx = 0;

  while ((imgMatch = imgRegex.exec(cleaned)) !== null) {
    // Text before the image
    const before = cleaned.slice(lastIdx, imgMatch.index);
    if (before.trim()) {
      nodes.push(...parseTextWithMarks(before));
    }
    // We skip inline images in text nodes — they'll be separate blocks
    lastIdx = imgMatch.index + imgMatch[0].length;
  }

  const remaining = cleaned.slice(lastIdx);
  if (remaining.trim()) {
    nodes.push(...parseTextWithMarks(remaining));
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', text: ' ' }];
}

function parseTextWithMarks(html: string): object[] {
  const text = decodeEntities(stripTags(html)).trim();
  if (!text) return [];

  const marks: object[] = [];
  if (/<strong|<b[\s>]/i.test(html)) marks.push({ type: 'bold' });
  if (/<em|<i[\s>]/i.test(html)) marks.push({ type: 'italic' });
  if (/<u[\s>]/i.test(html)) marks.push({ type: 'underline' });
  if (/<s[\s>]|<strike|<del[\s>]/i.test(html)) marks.push({ type: 'strike' });
  if (/<code[\s>]/i.test(html) && !/<pre/i.test(html)) marks.push({ type: 'code' });

  const linkMatch = html.match(/<a[^>]*href="([^"]*)"[^>]*>/i);
  if (linkMatch) marks.push({ type: 'link', attrs: { href: linkMatch[1] } });

  const node: Record<string, unknown> = { type: 'text', text };
  if (marks.length > 0) node.marks = marks;
  return [node];
}

function parseList(html: string, ordered: boolean): object {
  const items: object[] = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;

  while ((liMatch = liRegex.exec(html)) !== null) {
    const content = parseInline(liMatch[1]);
    items.push({
      type: 'listItem',
      content: [{
        type: 'paragraph',
        content,
      }],
    });
  }

  if (items.length === 0) {
    items.push({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }],
    });
  }

  return {
    type: ordered ? 'orderedList' : 'bulletList',
    content: items,
  };
}

function parseTable(html: string): object {
  const rows: object[] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  let isFirstRow = true;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const cells: object[] = [];
    const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
      cells.push({
        type: isFirstRow ? 'tableHeader' : 'tableCell',
        content: [{
          type: 'paragraph',
          content: parseInline(cellMatch[1]),
        }],
      });
    }

    if (cells.length > 0) {
      rows.push({ type: 'tableRow', content: cells });
    }
    isFirstRow = false;
  }

  return { type: 'table', content: rows };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

// ── Extract title from Notion filename ─────────────────────────────

function extractTitle(filename: string): string {
  // Notion filenames: "Title hashid.html" — strip the hash and extension
  const name = basename(filename, '.html');
  // Remove the Notion hash (32 hex chars at the end, possibly with spaces)
  const cleaned = name.replace(/\s+[0-9a-f]{32}$/i, '');
  return cleaned.trim() || 'Untitled';
}

// ── Detect subfolder as notebook name ──────────────────────────────

function getNotebookName(filePath: string, rootDir: string): string {
  const relative = filePath.replace(rootDir, '').replace(/^\//, '');
  const parts = relative.split('/');
  if (parts.length > 1) {
    // File is in a subfolder — use folder name as notebook
    return extractTitle(parts[0]);
  }
  return 'Notion Import';
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const exportDir = process.argv[2];
  if (!exportDir) {
    console.error('Usage: node --experimental-strip-types scripts/import-notion.ts <export-dir>');
    process.exit(1);
  }

  // Find all HTML files recursively
  const htmlFiles: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.html')) {
        htmlFiles.push(full);
      }
    }
  }
  walk(exportDir);

  console.log(`Found ${htmlFiles.length} HTML files in Notion export.`);

  if (htmlFiles.length === 0) {
    console.log('No HTML files found. Check the export directory path.');
    process.exit(0);
  }

  // Get or create notebooks
  const notebookCache = new Map<string, string>();

  async function getOrCreateNotebook(name: string): Promise<string> {
    if (notebookCache.has(name)) return notebookCache.get(name)!;

    // Check existing
    const existing = await get('/notebooks') as Array<{ id: string; name: string }>;
    const found = existing.find(n => n.name === name);
    if (found) {
      notebookCache.set(name, found.id);
      return found.id;
    }

    const nb = await post('/notebooks', { name });
    notebookCache.set(name, nb.id);
    console.log(`  📓 Created notebook: ${name}`);
    return nb.id;
  }

  // Import each file
  let imported = 0;
  let skipped = 0;

  for (const filePath of htmlFiles) {
    const title = extractTitle(basename(filePath));
    const notebookName = getNotebookName(filePath, exportDir);

    // Skip the CSV/database index pages
    if (title.startsWith('[Shared]') || filePath.endsWith('.csv')) {
      skipped++;
      continue;
    }

    try {
      const html = readFileSync(filePath, 'utf-8');
      const tiptapDoc = htmlToTipTap(html);
      const content = JSON.stringify(tiptapDoc);

      const nbId = await getOrCreateNotebook(notebookName);

      const note = await post('/notes', {
        notebookId: nbId,
        title,
        content,
      });

      // Tag with notion-import
      await post(`/notes/${note.id}/tags`, { name: 'notion-import' });

      imported++;
      console.log(`  ✓ ${title}`);
    } catch (err) {
      console.error(`  ✕ Failed: ${title} — ${(err as Error).message}`);
      skipped++;
    }
  }

  console.log(`\nDone! Imported ${imported} notes, skipped ${skipped}.`);
  console.log('All imported notes are tagged with "notion-import".');
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
