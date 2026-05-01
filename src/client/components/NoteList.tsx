import React, { useState, useEffect, useCallback } from 'react';
import { notes as notesApi, type NoteSummary } from '../api';
import { DRAG_TYPE_NOTE } from './Sidebar';

// ── Types ──────────────────────────────────────────────────────────

export type NoteListContext =
  | { type: 'all-notes' }
  | { type: 'notebook'; notebook: string }
  | { type: 'tag'; tag: string }
  | { type: 'trash' }
  | { type: 'search'; results: NoteSummary[] };

interface NoteListProps {
  context: NoteListContext;
  selectedNotePath: string | null;
  onSelectNote: (notePath: string) => void;
  onCreateNote: () => void;
  refreshKey?: number;
}

// ── Helpers ────────────────────────────────────────────────────────

function getSnippet(content: string, maxLen = 120): string {
  // Content is now Markdown — strip basic formatting for snippet
  const plain = content
    .replace(/^---[\s\S]*?---\n?/, '') // strip frontmatter if present
    .replace(/^#+\s+/gm, '')           // strip heading markers
    .replace(/\*\*|__/g, '')           // strip bold
    .replace(/\*|_/g, '')             // strip italic
    .replace(/~~(.*?)~~/g, '$1')      // strip strikethrough
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // strip inline code
    .replace(/!\[.*?\]\(.*?\)/g, '')   // strip images
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1') // strip links, keep text
    .replace(/<[^>]*>/g, '')           // strip HTML
    .trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + '…' : plain;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'));
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

function contextTitle(ctx: NoteListContext): string {
  switch (ctx.type) {
    case 'all-notes': return 'All Notes';
    case 'notebook': return ctx.notebook;
    case 'tag': return `Tag: ${ctx.tag}`;
    case 'trash': return 'Trash';
    case 'search': return 'Search Results';
  }
}

// ── Component ──────────────────────────────────────────────────────

export function NoteList({ context, selectedNotePath, onSelectNote, onCreateNote, refreshKey }: NoteListProps) {
  const [notesList, setNotesList] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    if (context.type === 'search') {
      setNotesList(context.results);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let result: NoteSummary[];
      switch (context.type) {
        case 'all-notes':
          result = await notesApi.list();
          break;
        case 'notebook':
          result = await notesApi.list({ notebook: context.notebook });
          break;
        case 'tag':
          result = await notesApi.list({ tag: context.tag });
          break;
        case 'trash':
          result = await notesApi.list({ trash: true });
          break;
        default:
          result = [];
      }
      setNotesList(result);
    } catch (err) {
      console.error('Failed to fetch notes:', err);
      setError(err instanceof Error ? err.message : String(err));
      setNotesList([]);
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes, refreshKey]);

  // ── Drag source for notes ──────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, notePath: string) => {
    e.dataTransfer.setData(DRAG_TYPE_NOTE, notePath);
    e.dataTransfer.effectAllowed = 'move';
  };

  // ── Trash actions ──────────────────────────────────────────────

  const handleRestore = async (e: React.MouseEvent, notePath: string) => {
    e.stopPropagation();
    try {
      await notesApi.restore(notePath);
      fetchNotes();
    } catch (err) {
      console.error('Failed to restore note:', err);
    }
  };

  const handlePermanentDelete = async (e: React.MouseEvent, notePath: string) => {
    e.stopPropagation();
    if (!confirm('Permanently delete this note? This cannot be undone.')) return;
    try {
      await notesApi.permanentDelete(notePath);
      fetchNotes();
    } catch (err) {
      console.error('Failed to permanently delete note:', err);
    }
  };

  const handleEmptyTrash = async () => {
    if (!confirm('Permanently delete all notes in trash? This cannot be undone.')) return;
    try {
      await notesApi.emptyTrash();
      fetchNotes();
    } catch (err) {
      console.error('Failed to empty trash:', err);
    }
  };

  return (
    <section className="note-list" aria-label="Note list">
      <div className="note-list-header">
        <h2>{contextTitle(context)}</h2>
        <div className="note-list-actions">
          {context.type !== 'trash' && context.type !== 'search' && (
            <button className="note-list-add-btn" onClick={onCreateNote} aria-label="Create note" title="New note">
              + New
            </button>
          )}
          {context.type === 'trash' && notesList.length > 0 && (
            <button className="note-list-empty-trash-btn" onClick={handleEmptyTrash} title="Empty trash">
              Empty Trash
            </button>
          )}
        </div>
      </div>

      <div className="note-list-content">
        {loading && <p className="placeholder-text">Loading…</p>}

        {!loading && error && (
          <p className="placeholder-text" style={{ color: 'red', fontSize: '0.8em' }}>
            Error: {error}
          </p>
        )}

        {!loading && !error && notesList.length === 0 && (
          <p className="placeholder-text">
            {context.type === 'trash' ? 'Trash is empty' : 'No notes to display'}
          </p>
        )}

        {!loading && notesList.map(note => (
          <div
            key={note.path || note.id}
            className={`note-list-item ${selectedNotePath === note.path ? 'note-list-item--selected' : ''}`}
            onClick={() => onSelectNote(note.path)}
            draggable={context.type !== 'trash'}
            onDragStart={(e) => handleDragStart(e, note.path)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelectNote(note.path); }}
          >
            <div className="note-list-item-title">
              {note.title || 'Untitled'}
            </div>
            <div className="note-list-item-snippet">
              {note.snippet || getSnippet(note.title)}
            </div>
            <div className="note-list-item-meta">
              <span className="note-list-item-date">
                {formatDate(note.modified)}
              </span>
              {note.notebook && (
                <span className="note-list-item-notebook">{note.notebook}</span>
              )}
              {note.tags && note.tags.length > 0 && (
                <span className="note-list-item-tags">
                  {note.tags.join(', ')}
                </span>
              )}
            </div>
            {context.type === 'trash' && (
              <div className="note-list-item-trash-actions">
                <button className="note-trash-btn" onClick={(e) => handleRestore(e, note.path)} title="Restore">
                  ↩ Restore
                </button>
                <button className="note-trash-btn note-trash-btn--danger" onClick={(e) => handlePermanentDelete(e, note.path)} title="Delete permanently">
                  ✕ Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
