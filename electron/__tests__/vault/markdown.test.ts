import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeNote } from '../../vault/markdown';

describe('parseFrontmatter', () => {
  it('parses valid frontmatter with all fields', () => {
    const input = `---
id: abc123def456
tags:
  - meeting
  - project
created: "2026-04-30T10:00:00Z"
modified: "2026-04-30T14:30:00Z"
---

# My Note

Some content here.`;

    const result = parseFrontmatter(input);

    expect(result.data.id).toBe('abc123def456');
    expect(result.data.tags).toEqual(['meeting', 'project']);
    expect(result.data.created).toBe('2026-04-30T10:00:00Z');
    expect(result.data.modified).toBe('2026-04-30T14:30:00Z');
    expect(result.content).toContain('# My Note');
    expect(result.content).toContain('Some content here.');
  });

  it('handles missing frontmatter gracefully', () => {
    const input = '# Just a heading\n\nSome content without frontmatter.';

    const result = parseFrontmatter(input);

    expect(result.data.id).toBe('');
    expect(result.data.tags).toEqual([]);
    expect(result.data.created).toBe('');
    expect(result.data.modified).toBe('');
    expect(result.content).toContain('# Just a heading');
  });

  it('handles empty content', () => {
    const input = `---
id: abc123
tags: []
created: "2026-01-01T00:00:00Z"
modified: "2026-01-01T00:00:00Z"
---
`;

    const result = parseFrontmatter(input);

    expect(result.data.id).toBe('abc123');
    expect(result.data.tags).toEqual([]);
    expect(result.content.trim()).toBe('');
  });

  it('handles completely empty string', () => {
    const result = parseFrontmatter('');

    expect(result.data.id).toBe('');
    expect(result.data.tags).toEqual([]);
    expect(result.content).toBe('');
  });

  it('preserves extra unknown fields', () => {
    const input = `---
id: abc123
tags: []
created: "2026-01-01T00:00:00Z"
modified: "2026-01-01T00:00:00Z"
customField: hello
anotherField: 42
---

Content`;

    const result = parseFrontmatter(input);

    expect(result.data.id).toBe('abc123');
    expect(result.data.customField).toBe('hello');
    expect(result.data.anotherField).toBe(42);
  });
});

describe('serializeNote', () => {
  it('serializes a note with frontmatter and content', () => {
    const note = {
      id: 'abc123def456',
      title: 'My Note',
      tags: ['meeting', 'project'],
      created: '2026-04-30T10:00:00Z',
      modified: '2026-04-30T14:30:00Z',
      content: '# My Note\n\nSome content here.',
    };

    const result = serializeNote(note);

    expect(result).toContain('---');
    expect(result).toContain('id: abc123def456');
    expect(result).toContain('- meeting');
    expect(result).toContain('- project');
    expect(result).toContain('# My Note');
    expect(result).toContain('Some content here.');
  });

  it('serializes a note with empty tags', () => {
    const note = {
      id: 'abc123',
      title: 'Empty Tags',
      tags: [],
      created: '2026-01-01T00:00:00Z',
      modified: '2026-01-01T00:00:00Z',
      content: 'Hello',
    };

    const result = serializeNote(note);

    expect(result).toContain('tags: []');
    expect(result).toContain('Hello');
  });

  it('preserves extra fields in serialization', () => {
    const note = {
      id: 'abc123',
      title: 'Extra Fields',
      tags: [],
      created: '2026-01-01T00:00:00Z',
      modified: '2026-01-01T00:00:00Z',
      content: 'Content',
      customField: 'preserved',
    };

    const result = serializeNote(note);

    expect(result).toContain('customField: preserved');
  });
});

describe('frontmatter round-trip', () => {
  it('preserves all fields through serialize → parse cycle', () => {
    const original = {
      id: 'a1b2c3d4e5f6',
      title: 'Round Trip Test',
      tags: ['tag1', 'tag2', 'tag3'],
      created: '2026-04-30T10:00:00.000Z',
      modified: '2026-04-30T14:30:00.000Z',
      content: '# Heading\n\nParagraph with **bold** and *italic*.\n\n- List item 1\n- List item 2',
    };

    const serialized = serializeNote(original);
    const parsed = parseFrontmatter(serialized);

    expect(parsed.data.id).toBe(original.id);
    expect(parsed.data.tags).toEqual(original.tags);
    expect(parsed.data.created).toBe(original.created);
    expect(parsed.data.modified).toBe(original.modified);
    expect(parsed.content.trim()).toBe(original.content);
  });

  it('preserves extra fields through round-trip', () => {
    const original = {
      id: 'abc123',
      title: 'Extra Fields',
      tags: ['test'],
      created: '2026-01-01T00:00:00Z',
      modified: '2026-01-01T00:00:00Z',
      content: 'Content here',
      customField: 'should survive',
    };

    const serialized = serializeNote(original);
    const parsed = parseFrontmatter(serialized);

    expect(parsed.data.customField).toBe('should survive');
  });

  it('handles empty content through round-trip', () => {
    const original = {
      id: 'abc123',
      title: 'Empty',
      tags: [],
      created: '2026-01-01T00:00:00Z',
      modified: '2026-01-01T00:00:00Z',
      content: '',
    };

    const serialized = serializeNote(original);
    const parsed = parseFrontmatter(serialized);

    expect(parsed.data.id).toBe(original.id);
    expect(parsed.content.trim()).toBe('');
  });
});
