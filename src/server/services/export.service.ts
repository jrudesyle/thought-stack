import type { Database } from '../db/index.ts';

/**
 * Export data format matching the design doc's ExportData interface.
 */
export interface ExportData {
  version: 1;
  exportedAt: string;
  stacks: Array<{ id: string; name: string }>;
  notebooks: Array<{ id: string; name: string; stackId: string | null }>;
  notes: Array<{
    id: string;
    title: string;
    content: object;
    notebookId: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  tags: Array<{ id: string; name: string }>;
}

export interface ExportService {
  exportAll(): ExportData;
}

/**
 * Creates an export service that reads all stacks, notebooks, notes
 * (with content and tag names), and tags from the database and returns
 * them in the ExportData format.
 */
export function createExportService(db: Database): ExportService {
  return {
    exportAll(): ExportData {
      const stacks = db
        .prepare('SELECT id, name FROM notebook_stacks ORDER BY name')
        .all() as Array<{ id: string; name: string }>;

      const notebooks = db
        .prepare('SELECT id, name, stack_id FROM notebooks ORDER BY name')
        .all() as Array<{ id: string; name: string; stack_id: string | null }>;

      const rawNotes = db
        .prepare(
          `SELECT id, title, content, notebook_id, created_at, updated_at
           FROM notes
           ORDER BY updated_at DESC`,
        )
        .all() as Array<{
        id: string;
        title: string;
        content: string;
        notebook_id: string;
        created_at: string;
        updated_at: string;
      }>;

      const tags = db
        .prepare('SELECT id, name FROM tags ORDER BY name')
        .all() as Array<{ id: string; name: string }>;

      // Build a lookup for note tags
      const noteTagStmt = db.prepare(
        `SELECT t.name FROM tags t
         INNER JOIN note_tags nt ON nt.tag_id = t.id
         WHERE nt.note_id = ?
         ORDER BY t.name`,
      );

      const notes = rawNotes.map((n) => {
        let content: object;
        try {
          content = JSON.parse(n.content);
        } catch {
          content = {};
        }

        const noteTags = (noteTagStmt.all(n.id) as Array<{ name: string }>).map(
          (t) => t.name,
        );

        return {
          id: n.id,
          title: n.title,
          content,
          notebookId: n.notebook_id,
          tags: noteTags,
          createdAt: n.created_at,
          updatedAt: n.updated_at,
        };
      });

      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        stacks: stacks.map((s) => ({ id: s.id, name: s.name })),
        notebooks: notebooks.map((nb) => ({
          id: nb.id,
          name: nb.name,
          stackId: nb.stack_id,
        })),
        notes,
        tags: tags.map((t) => ({ id: t.id, name: t.name })),
      };
    },
  };
}
