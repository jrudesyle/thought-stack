import matter from 'gray-matter';

export interface FrontmatterData {
  id: string;
  tags: string[];
  created: string;
  modified: string;
  [key: string]: unknown; // Preserve unknown fields
}

export interface ParsedNote {
  data: FrontmatterData;
  content: string;
}

/**
 * Parses YAML frontmatter from a Markdown file's content.
 * Handles missing frontmatter, empty content, and preserves extra unknown fields.
 */
export function parseFrontmatter(fileContent: string): ParsedNote {
  const parsed = matter(fileContent);

  const data: FrontmatterData = {
    id: typeof parsed.data.id === 'string' ? parsed.data.id : '',
    tags: Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [],
    created: typeof parsed.data.created === 'string' ? parsed.data.created : '',
    modified: typeof parsed.data.modified === 'string' ? parsed.data.modified : '',
  };

  // Preserve any extra unknown fields from frontmatter
  for (const key of Object.keys(parsed.data)) {
    if (!(key in data)) {
      data[key] = parsed.data[key];
    }
  }

  return {
    data,
    content: parsed.content,
  };
}

/**
 * Serializes a note object into a Markdown string with YAML frontmatter.
 */
export function serializeNote(note: {
  id: string;
  title: string;
  tags: string[];
  created: string;
  modified: string;
  content: string;
  [key: string]: unknown;
}): string {
  // Build frontmatter data, preserving extra fields
  const frontmatterData: Record<string, unknown> = {
    id: note.id,
    tags: note.tags,
    created: note.created,
    modified: note.modified,
  };

  // Preserve any extra fields beyond the known ones
  const knownKeys = new Set(['id', 'title', 'tags', 'created', 'modified', 'content']);
  for (const key of Object.keys(note)) {
    if (!knownKeys.has(key)) {
      frontmatterData[key] = note[key];
    }
  }

  const content = note.content ?? '';
  return matter.stringify(content, frontmatterData);
}
