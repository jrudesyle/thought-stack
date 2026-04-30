import { describe, it, expect } from 'vitest';
import { tiptapJsonToMarkdown } from '../../migration/tiptap-to-markdown';

describe('tiptapJsonToMarkdown', () => {
  // ── Empty / invalid input ────────────────────────────────────────

  it('returns empty string for empty input', () => {
    expect(tiptapJsonToMarkdown('')).toBe('');
  });

  it('returns empty string for "{}"', () => {
    expect(tiptapJsonToMarkdown('{}')).toBe('');
  });

  it('returns empty string for null-ish input', () => {
    expect(tiptapJsonToMarkdown(null as unknown as string)).toBe('');
  });

  it('returns raw content when JSON parsing fails', () => {
    const raw = 'This is not JSON {{{';
    expect(tiptapJsonToMarkdown(raw)).toBe(raw);
  });

  it('returns empty string for doc with no content', () => {
    const json = JSON.stringify({ type: 'doc' });
    expect(tiptapJsonToMarkdown(json)).toBe('');
  });

  // ── Paragraphs ───────────────────────────────────────────────────

  it('converts a simple paragraph', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('Hello world');
  });

  it('converts multiple paragraphs with blank lines', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('First\n\nSecond');
  });

  // ── Headings ─────────────────────────────────────────────────────

  it('converts headings at different levels', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H1' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H2' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'H3' }] },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('# H1\n\n## H2\n\n### H3');
  });

  // ── Inline marks ─────────────────────────────────────────────────

  it('converts bold text', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('**bold**');
  });

  it('converts italic text', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          ],
        },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('*italic*');
  });

  it('converts strikethrough text', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'struck', marks: [{ type: 'strike' }] },
          ],
        },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('~~struck~~');
  });

  it('converts inline code', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'code', marks: [{ type: 'code' }] },
          ],
        },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('`code`');
  });

  it('converts links', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click here',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('[click here](https://example.com)');
  });

  it('handles multiple marks on the same text', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'important',
              marks: [{ type: 'bold' }, { type: 'italic' }],
            },
          ],
        },
      ],
    });
    const result = tiptapJsonToMarkdown(json);
    expect(result).toContain('**');
    expect(result).toContain('*');
    expect(result).toContain('important');
  });

  // ── Code blocks ──────────────────────────────────────────────────

  it('converts code blocks', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'javascript' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('```javascript\nconst x = 1;\n```');
  });

  it('converts code blocks without language', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          content: [{ type: 'text', text: 'hello' }],
        },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('```\nhello\n```');
  });

  // ── Lists ────────────────────────────────────────────────────────

  it('converts bullet lists', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 1' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 2' }] }] },
          ],
        },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('- Item 1\n- Item 2');
  });

  it('converts ordered lists', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] },
          ],
        },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('1. First\n2. Second');
  });

  it('converts task lists', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Todo' }] }] },
            { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done' }] }] },
          ],
        },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('- [ ] Todo\n- [x] Done');
  });

  // ── Blockquotes ──────────────────────────────────────────────────

  it('converts blockquotes', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'A wise quote' }] },
          ],
        },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('> A wise quote');
  });

  // ── Horizontal rule ──────────────────────────────────────────────

  it('converts horizontal rules', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Above' }] },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Below' }] },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('Above\n\n---\n\nBelow');
  });

  // ── Images ───────────────────────────────────────────────────────

  it('converts images', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: '.images/abc123.png', alt: 'Diagram' },
        },
      ],
    });
    expect(tiptapJsonToMarkdown(json)).toBe('![Diagram](.images/abc123.png)');
  });

  // ── Tables ───────────────────────────────────────────────────────

  it('converts tables', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Age' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alice' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '30' }] }] },
              ],
            },
          ],
        },
      ],
    });
    const result = tiptapJsonToMarkdown(json);
    expect(result).toContain('| Name');
    expect(result).toContain('| Alice');
    expect(result).toContain('---');
  });

  // ── Mixed content ────────────────────────────────────────────────

  it('converts a complex document with mixed content', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'My Note' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This is ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
            { type: 'text', text: '.' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item A' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item B' }] }] },
          ],
        },
      ],
    });
    const result = tiptapJsonToMarkdown(json);
    expect(result).toContain('# My Note');
    expect(result).toContain('**bold**');
    expect(result).toContain('*italic*');
    expect(result).toContain('- Item A');
    expect(result).toContain('- Item B');
  });
});
