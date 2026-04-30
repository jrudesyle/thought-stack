#!/usr/bin/env node
/**
 * Quick migration script — runs with plain Node.js (no tsx needed).
 * Reads data/notes.db and creates Markdown files in ~/ThoughtStack.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import matter from 'gray-matter';

const DB_PATH = path.resolve('data/notes.db');
const VAULT_PATH = path.join(os.homedir(), 'ThoughtStack');

const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

// ── TipTap JSON → Markdown converter ──────────────────────────────

function tiptapToMarkdown(jsonStr) {
  if (!jsonStr || jsonStr.trim() === '' || jsonStr.trim() === '{}') return '';
  let doc;
  try { doc = JSON.parse(jsonStr); } catch { return jsonStr; }
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return '';
  return renderNodes(doc.content).trim();
}

function renderNodes(nodes) {
  return nodes.map(renderNode).join('\n\n');
}

function renderNode(node) {
  switch (node.type) {
    case 'paragraph': return renderInline(node.content);
    case 'heading': {
      const level = node.attrs?.level ?? 1;
      return '#'.repeat(Math.min(level, 6)) + ' ' + renderInline(node.content);
    }
    case 'bulletList': return (node.content || []).map(li => '- ' + renderListItem(li)).join('\n');
    case 'orderedList': return (node.content || []).map((li, i) => `${i+1}. ` + renderListItem(li)).join('\n');
    case 'taskList': return (node.content || []).map(ti => {
      const checked = ti.attrs?.checked ? 'x' : ' ';
      return `- [${checked}] ` + renderListItem(ti);
    }).join('\n');
    case 'blockquote': return (node.content || []).map(n => '> ' + renderNode(n)).join('\n');
    case 'codeBlock': {
      const lang = node.attrs?.language || '';
      const code = renderInline(node.content);
      return '```' + lang + '\n' + code + '\n```';
    }
    case 'horizontalRule': return '---';
    case 'image': {
      const src = node.attrs?.src || '';
      const alt = node.attrs?.alt || '';
      return `![${alt}](${src})`;
    }
    case 'table': return renderTable(node);
    case 'hardBreak': return '  \n';
    default:
      if (node.content) return renderInline(node.content);
      if (node.text) return node.text;
      return '';
  }
}

function renderListItem(node) {
  if (!node.content) return '';
  return node.content.map(child => {
    if (child.type === 'paragraph') return renderInline(child.content);
    return renderNode(child);
  }).join('\n');
}

function renderInline(content) {
  if (!content) return '';
  return content.map(node => {
    if (node.type === 'text') return applyMarks(node.text || '', node.marks);
    if (node.type === 'hardBreak') return '  \n';
    if (node.type === 'image') return `![${node.attrs?.alt || ''}](${node.attrs?.src || ''})`;
    if (node.content) return renderInline(node.content);
    return node.text || '';
  }).join('');
}

function applyMarks(text, marks) {
  if (!marks) return text;
  let r = text;
  for (const m of marks) {
    switch (m.type) {
      case 'bold': case 'strong': r = `**${r}**`; break;
      case 'italic': case 'em': r = `*${r}*`; break;
      case 'strike': r = `~~${r}~~`; break;
      case 'code': r = '`' + r + '`'; break;
      case 'link': r = `[${r}](${m.attrs?.href || ''})`; break;
    }
  }
  return r;
}

function renderTable(node) {
  if (!node.content) return '';
  const rows = [];
  for (const row of node.content) {
    if (row.type !== 'tableRow' || !row.content) continue;
    const cells = row.content.map(cell => {
      if (!cell.content) return '';
      return cell.content.map(c => renderInline(c.content)).join(' ').trim();
    });
    rows.push(cells);
  }
  if (rows.length === 0) return '';
  const colCount = Math.max(...rows.map(r => r.length));
  const widths = Array.from({length: colCount}, (_, c) =>
    Math.max(3, ...rows.map(r => (r[c] || '').length))
  );
  const fmt = cells => '| ' + widths.map((w, i) => (cells[i] || '').padEnd(w)).join(' | ') + ' |';
  const sep = '| ' + widths.map(w => '-'.repeat(w)).join(' | ') + ' |';
  return [fmt(rows[0]), sep, ...rows.slice(1).map(fmt)].join('\n');
}

// ── Filename sanitization ─────────────────────────────────────────

function sanitize(name) {
  let s = name.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) s = 'Untitled';
  if (s.length > 200) s = s.slice(0, 200).trim();
  return s;
}

// ── Serialize note to Markdown with frontmatter ───────────────────

function serializeNote({ id, title, tags, created, modified, content }) {
  const fm = { id, tags, created, modified };
  return matter.stringify(content || '', fm);
}

function normalizeTimestamp(ts) {
  if (!ts) return new Date().toISOString();
  if (ts.includes('T')) return ts;
  return ts.replace(' ', 'T') + 'Z';
}

// ── Main migration ────────────────────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║       ThoughtStack Vault Migration           ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');

if (!fs.existsSync(DB_PATH)) {
  console.error(`✕ Database not found: ${DB_PATH}`);
  process.exit(1);
}

console.log(`  Database:  ${DB_PATH}`);
console.log(`  Vault:     ${VAULT_PATH}`);
console.log('');

// Initialize vault
fs.mkdirSync(path.join(VAULT_PATH, '.thoughtstack'), { recursive: true });
fs.mkdirSync(path.join(VAULT_PATH, '.trash'), { recursive: true });

const db = new Database(DB_PATH, { readonly: true });
const summary = { notebooks: 0, notes: 0, tags: 0, images: 0, errors: [] };

try {
  // Read stacks
  const stacks = db.prepare('SELECT id, name FROM notebook_stacks').all();
  const stackMap = new Map(stacks.map(s => [s.id, s.name]));

  // Read notebooks
  const notebooks = db.prepare('SELECT id, name, stack_id FROM notebooks ORDER BY name').all();
  const nbDirMap = new Map();

  for (const nb of notebooks) {
    const stackName = nb.stack_id ? stackMap.get(nb.stack_id) : null;
    const dirPath = stackName
      ? path.join(sanitize(stackName), sanitize(nb.name))
      : sanitize(nb.name);
    fs.mkdirSync(path.join(VAULT_PATH, dirPath), { recursive: true });
    nbDirMap.set(nb.id, dirPath);
    summary.notebooks++;
  }

  // Read all tags for notes
  const allTags = new Set();

  // Read notes
  const notes = db.prepare(
    'SELECT id, title, content, notebook_id, is_trashed, created_at, updated_at FROM notes ORDER BY created_at'
  ).all();

  const usedFilenames = new Map();

  for (const note of notes) {
    if (note.is_trashed) continue;
    const nbDir = nbDirMap.get(note.notebook_id);
    if (!nbDir) {
      summary.errors.push(`Note "${note.title}" — notebook not found`);
      continue;
    }

    try {
      // Get tags
      const noteTags = db.prepare(
        'SELECT t.name FROM tags t INNER JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name'
      ).all(note.id).map(t => t.name);
      noteTags.forEach(t => allTags.add(t));

      // Convert content
      const markdown = tiptapToMarkdown(note.content);

      // Resolve filename
      const sanitized = sanitize(note.title || 'Untitled');
      if (!usedFilenames.has(nbDir)) usedFilenames.set(nbDir, new Set());
      const used = usedFilenames.get(nbDir);
      let filename = `${sanitized}.md`;
      let counter = 2;
      while (used.has(filename.toLowerCase())) {
        filename = `${sanitized} ${counter}.md`;
        counter++;
      }
      used.add(filename.toLowerCase());

      // Write file
      const fileContent = serializeNote({
        id: note.id,
        title: note.title || 'Untitled',
        tags: noteTags,
        created: normalizeTimestamp(note.created_at),
        modified: normalizeTimestamp(note.updated_at),
        content: markdown,
      });

      fs.writeFileSync(path.join(VAULT_PATH, nbDir, filename), fileContent, 'utf-8');
      summary.notes++;
    } catch (err) {
      summary.errors.push(`Note "${note.title}": ${err.message}`);
    }
  }

  // Images
  try {
    const images = db.prepare('SELECT id, note_id, mime_type, data FROM note_images').all();
    for (const img of images) {
      const noteRow = db.prepare('SELECT notebook_id FROM notes WHERE id = ?').get(img.note_id);
      if (!noteRow) continue;
      const nbDir = nbDirMap.get(noteRow.notebook_id);
      if (!nbDir) continue;
      const ext = MIME_TO_EXT[img.mime_type] || '.png';
      const imagesDir = path.join(VAULT_PATH, nbDir, '.images');
      fs.mkdirSync(imagesDir, { recursive: true });
      fs.writeFileSync(path.join(imagesDir, `${img.id}${ext}`), img.data);
      summary.images++;
    }
  } catch { /* note_images table may not exist */ }

  summary.tags = allTags.size;
} finally {
  db.close();
}

// Print summary
console.log('  ┌─────────────────────────────────────────┐');
console.log('  │           Migration Summary              │');
console.log('  ├─────────────────────────────────────────┤');
console.log(`  │  📓 Notebooks:  ${String(summary.notebooks).padStart(6)}                │`);
console.log(`  │  📝 Notes:      ${String(summary.notes).padStart(6)}                │`);
console.log(`  │  🏷️  Tags:       ${String(summary.tags).padStart(6)}                │`);
console.log(`  │  🖼️  Images:     ${String(summary.images).padStart(6)}                │`);
console.log('  └─────────────────────────────────────────┘');
console.log('');

if (summary.errors.length > 0) {
  console.log(`  ⚠ ${summary.errors.length} error(s):`);
  summary.errors.forEach(e => console.log(`    • ${e}`));
  console.log('');
}

if (summary.notes > 0) {
  console.log(`  ✓ Migration complete! Your notes are at: ${VAULT_PATH}`);
  console.log('');
  console.log('  Next: point ThoughtStack at this vault folder when the app starts.');
} else {
  console.log('  ⚠ No notes found in the database.');
}
console.log('');
