import { ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { resolveVaultPath } from '../vault/index';
import { listNotes } from '../vault/notes';
import { parseFrontmatter, serializeNote } from '../vault/markdown';
import { titleFromFilename } from '../vault/sanitize';

export interface TagInfo {
  name: string;
  noteCount: number;
}

/**
 * Registers IPC handlers for all tag-related channels.
 * Tags are derived from note frontmatter — no separate storage.
 */
export function registerTagHandlers(getVaultPath: () => string): void {
  ipcMain.handle('tags:list', async () => {
    try {
      return aggregateTags(getVaultPath());
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('tags:rename', async (_event, oldName: string, newName: string) => {
    try {
      return renameTag(getVaultPath(), oldName, newName);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('tags:autocomplete', async (_event, prefix: string) => {
    try {
      const allTags = aggregateTags(getVaultPath());
      const lowerPrefix = prefix.toLowerCase();
      return allTags.filter((t) => t.name.toLowerCase().startsWith(lowerPrefix));
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * Scans all non-trashed notes and aggregates tags from frontmatter.
 * Returns TagInfo[] sorted by noteCount descending.
 */
function aggregateTags(vaultPath: string): TagInfo[] {
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

/**
 * Renames a tag across all notes that contain it.
 * Reads each note file, updates the tags array in frontmatter, and saves.
 * Returns the count of updated notes.
 */
function renameTag(vaultPath: string, oldName: string, newName: string): number {
  const resolved = resolveVaultPath(vaultPath);
  const notes = listNotes(vaultPath);
  let updatedCount = 0;

  for (const note of notes) {
    if (!note.tags.includes(oldName)) continue;

    const fullPath = path.join(resolved, note.path);
    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const { data, content } = parseFrontmatter(fileContent);

    // Replace old tag with new tag, avoiding duplicates
    const newTags = data.tags.map((t) => (t === oldName ? newName : t));
    // Deduplicate in case newName already existed
    const uniqueTags = [...new Set(newTags)];

    const title = titleFromFilename(path.basename(note.path));
    const markdown = serializeNote({
      ...data,
      title,
      tags: uniqueTags,
      content,
    });

    fs.writeFileSync(fullPath, markdown, 'utf-8');
    updatedCount++;
  }

  return updatedCount;
}
