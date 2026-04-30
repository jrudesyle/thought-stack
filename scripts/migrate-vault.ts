#!/usr/bin/env npx tsx
/**
 * Vault Migration Script
 *
 * Migrates notes from the old SQLite database (data/notes.db) to a
 * Markdown vault at ~/ThoughtStack.
 *
 * Usage:
 *   npx tsx scripts/migrate-vault.ts
 *   npx tsx scripts/migrate-vault.ts --db path/to/notes.db
 *   npx tsx scripts/migrate-vault.ts --vault ~/MyVault
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { migrateDatabase, type MigrationSummary } from '../electron/migration/migrate';

// ── Parse CLI arguments ────────────────────────────────────────────

function parseArgs(): { dbPath: string; vaultPath: string } {
  const args = process.argv.slice(2);
  let dbPath = path.resolve('data/notes.db');
  let vaultPath = path.join(os.homedir(), 'ThoughtStack');

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--db' || args[i] === '-d') && args[i + 1]) {
      dbPath = path.resolve(args[++i]);
    } else if ((args[i] === '--vault' || args[i] === '-v') && args[i + 1]) {
      vaultPath = path.resolve(args[++i].replace(/^~/, os.homedir()));
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
ThoughtStack Vault Migration

Migrates notes from the old SQLite database to a Markdown vault.

Usage:
  npx tsx scripts/migrate-vault.ts [options]

Options:
  --db, -d <path>      Path to SQLite database (default: data/notes.db)
  --vault, -v <path>   Path to vault directory (default: ~/ThoughtStack)
  --help, -h           Show this help message
`);
      process.exit(0);
    }
  }

  return { dbPath, vaultPath };
}

// ── Main ───────────────────────────────────────────────────────────

function main(): void {
  const { dbPath, vaultPath } = parseArgs();

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       ThoughtStack Vault Migration           ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // Validate database exists
  if (!fs.existsSync(dbPath)) {
    console.error(`✕ Database not found: ${dbPath}`);
    console.error('  Make sure the database file exists or specify a path with --db');
    process.exit(1);
  }

  console.log(`  Database:  ${dbPath}`);
  console.log(`  Vault:     ${vaultPath}`);
  console.log('');

  // Create vault directory if it doesn't exist
  if (!fs.existsSync(vaultPath)) {
    console.log(`  Creating vault directory: ${vaultPath}`);
    fs.mkdirSync(vaultPath, { recursive: true });
  } else {
    console.log('  Vault directory already exists — merging into it.');
  }

  console.log('');
  console.log('  Migrating…');
  console.log('');

  // Run the migration
  const summary: MigrationSummary = migrateDatabase(dbPath, vaultPath);

  // Print summary
  printSummary(summary);

  // Exit with error code if there were errors
  if (summary.errors.length > 0 && summary.notes === 0) {
    process.exit(1);
  }
}

function printSummary(summary: MigrationSummary): void {
  const hasErrors = summary.errors.length > 0;

  console.log('  ┌─────────────────────────────────────────┐');
  console.log('  │           Migration Summary              │');
  console.log('  ├─────────────────────────────────────────┤');
  console.log(`  │  📓 Notebooks:  ${String(summary.notebooks).padStart(6)}                │`);
  console.log(`  │  📝 Notes:      ${String(summary.notes).padStart(6)}                │`);
  console.log(`  │  🏷️  Tags:       ${String(summary.tags).padStart(6)}                │`);
  console.log(`  │  🖼️  Images:     ${String(summary.images).padStart(6)}                │`);

  if (hasErrors) {
    console.log(`  │  ⚠️  Errors:     ${String(summary.errors.length).padStart(6)}                │`);
  }

  console.log('  └─────────────────────────────────────────┘');
  console.log('');

  if (hasErrors) {
    console.log('  Errors:');
    for (const err of summary.errors) {
      console.log(`    • ${err}`);
    }
    console.log('');
  }

  if (summary.notes > 0) {
    console.log('  ✓ Migration complete!');
  } else if (hasErrors) {
    console.log('  ✕ Migration failed — see errors above.');
  } else {
    console.log('  ⚠ No notes found in the database.');
  }

  console.log('');
}

// ── Run ────────────────────────────────────────────────────────────

main();
