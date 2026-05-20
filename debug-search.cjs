#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Update this to your vault path
const VAULT_PATH = process.argv[2] || process.env.HOME + '/ThoughtStack';
const DB_PATH = path.join(VAULT_PATH, '.thoughtstack', 'cache.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`Database not found at: ${DB_PATH}`);
  console.error(`Usage: node debug-search.js [vault_path]`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

console.log('=== Database Contents ===\n');

// Show all indexed notes
const notes = db.prepare('SELECT id, title, path, notebook, tags, modified FROM notes_index ORDER BY modified DESC LIMIT 10').all();
console.log(`Found ${notes.length} recent notes:\n`);
notes.forEach((note, i) => {
  console.log(`${i + 1}. ${note.title}`);
  console.log(`   ID: ${note.id}`);
  console.log(`   Path: ${note.path}`);
  console.log(`   Notebook: ${note.notebook}`);
  console.log(`   Tags: ${note.tags}`);
  console.log(`   Modified: ${note.modified}`);
  console.log('');
});

// Try a sample search
console.log('=== Sample Search (query: "test") ===\n');

const searchQuery = '"test"'; // FTS5 format
try {
  const results = db.prepare(`
    SELECT
      ni.id AS noteId,
      ni.path AS path,
      ni.title AS title,
      ni.body_text AS body_text,
      ni.notebook AS notebook,
      ni.tags AS tags,
      ni.modified AS modified,
      nf.rank AS rank
    FROM notes_fts nf
    JOIN notes_index ni ON ni.rowid = nf.rowid
    WHERE notes_fts MATCH ?
    ORDER BY nf.rank
    LIMIT 5
  `).all(searchQuery);

  console.log(`Found ${results.length} results:\n`);
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.title}`);
    console.log(`   Path: ${r.path}`);
    console.log(`   Notebook: ${r.notebook}`);
    console.log(`   Rank: ${r.rank}`);
    console.log('');
  });
} catch (err) {
  console.error('Search error:', err.message);
}

db.close();
