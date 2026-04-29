import type { Database } from '../db/index.ts';
import type { ExportData } from './export.service.ts';

export interface ImportError {
  index: number;
  type: string;
  message: string;
}

export interface ImportResult {
  imported: {
    stacks: number;
    notebooks: number;
    notes: number;
    tags: number;
    total: number;
  };
  errors: ImportError[];
}

export interface ImportService {
  importData(data: ExportData): ImportResult;
}

/**
 * Creates an import service that parses and validates import JSON against
 * the ExportData schema, imports valid entries within a transaction, skips
 * malformed entries, and collects per-entry error messages.
 */
export function createImportService(db: Database): ImportService {
  return {
    importData(data: ExportData): ImportResult {
      const errors: ImportError[] = [];
      let importedStacks = 0;
      let importedNotebooks = 0;
      let importedNotes = 0;
      let importedTags = 0;

      const doImport = () => {
        // Import stacks
        const stacks = Array.isArray(data.stacks) ? data.stacks : [];
        for (let i = 0; i < stacks.length; i++) {
          const stack = stacks[i];
          if (!stack || !stack.id || !stack.name) {
            errors.push({
              index: i,
              type: 'stack',
              message: `Stack at index ${i}: missing required fields (id, name)`,
            });
            continue;
          }
          try {
            db.prepare(
              `INSERT OR IGNORE INTO notebook_stacks (id, name) VALUES (?, ?)`,
            ).run(stack.id, stack.name);
            importedStacks++;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push({ index: i, type: 'stack', message: `Stack '${stack.name}': ${msg}` });
          }
        }

        // Import tags
        const tags = Array.isArray(data.tags) ? data.tags : [];
        for (let i = 0; i < tags.length; i++) {
          const tag = tags[i];
          if (!tag || !tag.id || !tag.name) {
            errors.push({
              index: i,
              type: 'tag',
              message: `Tag at index ${i}: missing required fields (id, name)`,
            });
            continue;
          }
          try {
            db.prepare(
              `INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)`,
            ).run(tag.id, tag.name);
            importedTags++;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push({ index: i, type: 'tag', message: `Tag '${tag.name}': ${msg}` });
          }
        }

        // Import notebooks
        const notebooks = Array.isArray(data.notebooks) ? data.notebooks : [];
        for (let i = 0; i < notebooks.length; i++) {
          const nb = notebooks[i];
          if (!nb || !nb.id || !nb.name) {
            errors.push({
              index: i,
              type: 'notebook',
              message: `Notebook at index ${i}: missing required fields (id, name)`,
            });
            continue;
          }
          try {
            db.prepare(
              `INSERT OR IGNORE INTO notebooks (id, name, stack_id) VALUES (?, ?, ?)`,
            ).run(nb.id, nb.name, nb.stackId ?? null);
            importedNotebooks++;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push({ index: i, type: 'notebook', message: `Notebook '${nb.name}': ${msg}` });
          }
        }

        // Import notes
        const notes = Array.isArray(data.notes) ? data.notes : [];
        for (let i = 0; i < notes.length; i++) {
          const note = notes[i];
          if (!note || !note.id || !note.notebookId) {
            errors.push({
              index: i,
              type: 'note',
              message: `Note at index ${i}: missing required fields (id, notebookId)`,
            });
            continue;
          }

          // Verify the notebook exists
          const nbExists = db
            .prepare('SELECT id FROM notebooks WHERE id = ?')
            .get(note.notebookId);
          if (!nbExists) {
            errors.push({
              index: i,
              type: 'note',
              message: `Note '${note.title || note.id}': references non-existent notebook '${note.notebookId}'`,
            });
            continue;
          }

          try {
            const contentStr =
              typeof note.content === 'string'
                ? note.content
                : JSON.stringify(note.content ?? {});

            db.prepare(
              `INSERT OR IGNORE INTO notes (id, title, content, notebook_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            ).run(
              note.id,
              note.title ?? '',
              contentStr,
              note.notebookId,
              note.createdAt ?? new Date().toISOString(),
              note.updatedAt ?? new Date().toISOString(),
            );

            // Import note-tag associations
            if (Array.isArray(note.tags)) {
              for (const tagName of note.tags) {
                if (typeof tagName !== 'string' || tagName.trim().length === 0) continue;
                // Find the tag by name
                const tag = db
                  .prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE')
                  .get(tagName) as { id: string } | null;
                if (tag) {
                  db.prepare(
                    'INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)',
                  ).run(note.id, tag.id);
                }
              }
            }

            importedNotes++;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push({
              index: i,
              type: 'note',
              message: `Note '${note.title || note.id}': ${msg}`,
            });
          }
        }
      };

      // Run the import in a transaction
      const runImport = db.transaction(doImport as (...args: unknown[]) => unknown);
      runImport();

      const totalImported = importedStacks + importedNotebooks + importedNotes + importedTags;

      return {
        imported: {
          stacks: importedStacks,
          notebooks: importedNotebooks,
          notes: importedNotes,
          tags: importedTags,
          total: totalImported,
        },
        errors,
      };
    },
  };
}
