/**
 * Converts TipTap JSON content to Markdown.
 *
 * Handles common TipTap node types and gracefully degrades for unknown types.
 * If JSON parsing fails, returns the raw content as-is.
 */

// ── Types ──────────────────────────────────────────────────────────

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: TipTapMark[];
  attrs?: Record<string, unknown>;
}

interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Converts a TipTap JSON string to Markdown.
 *
 * - If the input is empty, `{}`, or `null`, returns empty string.
 * - If JSON parsing fails, returns the raw input as-is (graceful degradation).
 */
export function tiptapJsonToMarkdown(json: string): string {
  if (!json || json.trim() === '' || json.trim() === '{}') {
    return '';
  }

  let doc: TipTapNode;
  try {
    doc = JSON.parse(json);
  } catch {
    // Graceful degradation: return raw content if JSON is invalid
    return json;
  }

  if (!doc || !doc.type) {
    return '';
  }

  if (doc.type !== 'doc' || !Array.isArray(doc.content)) {
    return '';
  }

  return renderNodes(doc.content).trim();
}

// ── Node rendering ─────────────────────────────────────────────────

function renderNodes(nodes: TipTapNode[]): string {
  const parts: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const rendered = renderNode(node);
    parts.push(rendered);
  }

  return parts.join('\n\n');
}

function renderNode(node: TipTapNode): string {
  switch (node.type) {
    case 'paragraph':
      return renderInlineContent(node.content);

    case 'heading':
      return renderHeading(node);

    case 'bulletList':
      return renderBulletList(node);

    case 'orderedList':
      return renderOrderedList(node);

    case 'taskList':
      return renderTaskList(node);

    case 'listItem':
      return renderListItemContent(node);

    case 'taskItem':
      return renderTaskItemContent(node);

    case 'blockquote':
      return renderBlockquote(node);

    case 'codeBlock':
      return renderCodeBlock(node);

    case 'horizontalRule':
      return '---';

    case 'image':
      return renderImage(node);

    case 'table':
      return renderTable(node);

    case 'hardBreak':
      return '  \n';

    default:
      // Unknown node type: try to render inline content if available
      if (node.content) {
        return renderInlineContent(node.content);
      }
      if (node.text) {
        return node.text;
      }
      return '';
  }
}

// ── Inline content ─────────────────────────────────────────────────

function renderInlineContent(content?: TipTapNode[]): string {
  if (!content || content.length === 0) return '';

  return content.map(renderInlineNode).join('');
}

function renderInlineNode(node: TipTapNode): string {
  if (node.type === 'text') {
    return applyMarks(node.text ?? '', node.marks);
  }

  if (node.type === 'hardBreak') {
    return '  \n';
  }

  if (node.type === 'image') {
    return renderImage(node);
  }

  // Unknown inline node — try text or recurse
  if (node.text) {
    return applyMarks(node.text, node.marks);
  }
  if (node.content) {
    return renderInlineContent(node.content);
  }
  return '';
}

// ── Mark application ───────────────────────────────────────────────

function applyMarks(text: string, marks?: TipTapMark[]): string {
  if (!marks || marks.length === 0) return text;

  let result = text;

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        result = `**${result}**`;
        break;
      case 'italic':
      case 'em':
        result = `*${result}*`;
        break;
      case 'strike':
        result = `~~${result}~~`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'link': {
        const href = mark.attrs?.href ?? '';
        result = `[${result}](${href})`;
        break;
      }
      // Unknown marks are ignored (text preserved)
    }
  }

  return result;
}

// ── Block-level renderers ──────────────────────────────────────────

function renderHeading(node: TipTapNode): string {
  const level = (node.attrs?.level as number) ?? 1;
  const prefix = '#'.repeat(Math.min(Math.max(level, 1), 6));
  const text = renderInlineContent(node.content);
  return `${prefix} ${text}`;
}

function renderBulletList(node: TipTapNode): string {
  if (!node.content) return '';
  return node.content
    .map((item) => {
      const content = renderListItemContent(item);
      return indentListItem(content, '- ');
    })
    .join('\n');
}

function renderOrderedList(node: TipTapNode): string {
  if (!node.content) return '';
  return node.content
    .map((item, index) => {
      const content = renderListItemContent(item);
      return indentListItem(content, `${index + 1}. `);
    })
    .join('\n');
}

function renderTaskList(node: TipTapNode): string {
  if (!node.content) return '';
  return node.content
    .map((item) => {
      const checked = item.attrs?.checked === true;
      const checkbox = checked ? '- [x] ' : '- [ ] ';
      const content = renderTaskItemContent(item);
      return indentListItem(content, checkbox);
    })
    .join('\n');
}

function renderListItemContent(node: TipTapNode): string {
  if (!node.content) return '';

  const parts: string[] = [];
  for (const child of node.content) {
    if (child.type === 'paragraph') {
      parts.push(renderInlineContent(child.content));
    } else if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
      parts.push(renderNode(child));
    } else {
      parts.push(renderNode(child));
    }
  }
  return parts.join('\n');
}

function renderTaskItemContent(node: TipTapNode): string {
  return renderListItemContent(node);
}

function indentListItem(content: string, prefix: string): string {
  const lines = content.split('\n');
  const first = prefix + lines[0];
  const rest = lines.slice(1).map((line) => '  ' + line);
  return [first, ...rest].join('\n');
}

function renderBlockquote(node: TipTapNode): string {
  if (!node.content) return '>';

  const inner = node.content.map(renderNode).join('\n\n');
  return inner
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function renderCodeBlock(node: TipTapNode): string {
  const language = (node.attrs?.language as string) ?? '';
  const code = renderInlineContent(node.content);
  return `\`\`\`${language}\n${code}\n\`\`\``;
}

function renderImage(node: TipTapNode): string {
  const src = (node.attrs?.src as string) ?? '';
  const alt = (node.attrs?.alt as string) ?? '';
  return `![${alt}](${src})`;
}

// ── Table rendering ────────────────────────────────────────────────

function renderTable(node: TipTapNode): string {
  if (!node.content || node.content.length === 0) return '';

  const rows: string[][] = [];

  for (const row of node.content) {
    if (row.type !== 'tableRow' || !row.content) continue;
    const cells: string[] = [];
    for (const cell of row.content) {
      if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue;
      const text = cell.content
        ? cell.content.map((child) => renderInlineContent(child.content)).join(' ')
        : '';
      cells.push(text.trim());
    }
    rows.push(cells);
  }

  if (rows.length === 0) return '';

  // Calculate column widths
  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    const maxWidth = Math.max(3, ...rows.map((r) => (r[c] ?? '').length));
    colWidths.push(maxWidth);
  }

  const formatRow = (cells: string[]): string => {
    const padded = colWidths.map((w, i) => (cells[i] ?? '').padEnd(w));
    return `| ${padded.join(' | ')} |`;
  };

  const separator = `| ${colWidths.map((w) => '-'.repeat(w)).join(' | ')} |`;

  const lines: string[] = [];
  lines.push(formatRow(rows[0]));
  lines.push(separator);
  for (let i = 1; i < rows.length; i++) {
    lines.push(formatRow(rows[i]));
  }

  return lines.join('\n');
}
