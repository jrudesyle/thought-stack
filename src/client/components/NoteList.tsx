import React, { useState, useEffect, useCallback } from 'react';
import { notes as notesApi, type Note } from '../api/client';
import { DRAG_TYPE_NOTE } from './Sidebar';

// ── Types ──────────────────────────────────────────────────────────

export type NoteListContext =
  | { type: 'all-notes' }
  | { type: 'notebook'; notebookId: string }
  | { type: 'tag'; tagId: string }
  | { type: 'trash' }
  | { type: 'search'; results: Note[] };

interface NoteListProps {
  context: NoteListContext;
  selectedNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  onCreateNote: () => void;
  refreshKey?: number;
}

// ── Helpers ────────────────────────────────────────────────────────

function getSnippet(content: string, maxLen = 120): string {
  try {
    const parsed = JSON.parse(content);
    // Extract text from TipTap JSON
    const texts: string[] = [];
    const walk = (node: any) => {
      if (node.text) texts.push(node.text);
      if (node.content) node.content.forEach(walk);
    };
    walk(parsed);
    const plain = texts.join(' ').trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) + '…' : plain;
  } catch {
    // Fallback: treat as plain text
    const plain = content.replace(/<[^>]*>/g, '').trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) + '…' : plain;
  }
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
    case 'notebook': return 'Notebook';
    case 'tag': return 'Tag';
    case 'trash': return 'Trash';
    case 'search': return 'Search Results';
  }
}

// ── Component ──────────────────────────────────────────────────────

export function NoteList({ context, selectedNoteId, onSelectNote, onCreateNote, refreshKey }: NoteListProps) {
  const [notesList, setNotesList] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotes = useCallback(async () => {
    if (context.type === 'search') {
      setNotesList(context.results);
      return;
    }

    setLoading(true);
    try {
      let result: Note[];
      switch (context.type) {
        case 'all-notes':
          result = await notesApi.list();
          break;
        case 'notebook':
          result = await notesApi.list({ notebookId: context.notebookId });
          break;
        case 'tag':
          result = await notesApi.list({ tagId: context.tagId });
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
      setNotesList([]);
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes, refreshKey]);

  // ── Drag source for notes ──────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, noteId: string) => {
    e.dataTransfer.setData(DRAG_TYPE_NOTE, noteId);
    e.dataTransfer.effectAllowed = 'move';
  };

  // ── Trash actions ──────────────────────────────────────────────

  const handleRestore = async (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    try {
      await notesApi.restore(noteId);
      fetchNotes();
    } catch (err) {
      console.error('Failed to restore note:', err);
    }
  };

  const handlePermanentDelete = async (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    if (!confirm('Permanently delete this note? This cannot be undone.')) return;
    try {
      await notesApi.permanentDelete(noteId);
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

        {!loading && notesList.length === 0 && (
          <p className="placeholder-text">
            {context.type === 'trash' ? 'Trash is empty' : 'No notes to display'}
          </p>
        )}

        {!loading && notesList.map(note => (
          <div
            key={note.id}
            className={`note-list-item ${selectedNoteId === note.id ? 'note-list-item--selected' : ''}`}
            onClick={() => onSelectNote(note.id)}
            draggable={context.type !== 'trash'}
            onDragStart={(e) => handleDragStart(e, note.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelectNote(note.id); }}
          >
            <div className="note-list-item-title">
              {note.title || 'Untitled'}
            </div>
            <div className="note-list-item-snippet">
              {getSnippet(note.content)}
            </div>
            <div className="note-list-item-meta">
              <span className="note-list-item-date">
                {context.type === 'trash' && note.trashed_at
                  ? `Deleted ${formatDate(note.trashed_at)}`
                  : formatDate(note.updated_at)}
              </span>
              {note.tags && note.tags.length > 0 && (
                <span className="note-list-item-tags">
                  {note.tags.map(t => t.name).join(', ')}
                </span>
              )}
            </div>
            {context.type === 'trash' && (
              <div className="note-list-item-trash-actions">
                <button className="note-trash-btn" onClick={(e) => handleRestore(e, note.id)} title="Restore">
                  ↩ Restore
                </button>
                <button className="note-trash-btn note-trash-btn--danger" onClick={(e) => handlePermanentDelete(e, note.id)} title="Delete permanently">
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
