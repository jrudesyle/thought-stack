import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Strike } from '@tiptap/extension-strike';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extension-placeholder';
import { notes as notesApi, type Note } from '../api/client';
import { TagInput } from './TagInput';

// ── Types ──────────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

interface NoteEditorProps {
  noteId: string | null;
  onNoteSaved?: () => void;
}

// ── Component ──────────────────────────────────────────────────────

export function NoteEditor({ noteId, onNoteSaved }: NoteEditorProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [loading, setLoading] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);
  const isNewNoteRef = useRef(false);

  // ── TipTap editor setup ────────────────────────────────────────

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        strike: false, // We use the standalone Strike extension
      }),
      Underline,
      Strike,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({
        placeholder: 'Start writing…',
      }),
    ],
    editorProps: {
      handleDrop(view, event) {
        // Handle image drop
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
          const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
          if (imageFiles.length > 0) {
            event.preventDefault();
            imageFiles.forEach(file => insertImageFromFile(file));
            return true;
          }
        }
        return false;
      },
      handlePaste(view, event) {
        // Handle image paste
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
              event.preventDefault();
              const file = item.getAsFile();
              if (file) insertImageFromFile(file);
              return true;
            }
          }
        }
        return false;
      },
    },
    onUpdate: () => {
      scheduleSave();
    },
  });

  // ── Image handling ─────────────────────────────────────────────

  const insertImageFromFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      editor?.chain().focus().setImage({ src: dataUrl }).run();
    };
    reader.readAsDataURL(file);
  }, [editor]);

  const handleImagePicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) insertImageFromFile(file);
    };
    input.click();
  }, [insertImageFromFile]);

  // ── Auto-save with debounce ────────────────────────────────────

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      performSave();
    }, 2000);
  }, []);

  const performSave = useCallback(async () => {
    const id = currentNoteIdRef.current;
    if (!id || !editor) return;

    const content = JSON.stringify(editor.getJSON());
    const currentTitle = titleRef.current?.value ?? '';

    setSaveStatus('saving');
    try {
      await notesApi.update(id, { title: currentTitle, content });
      setSaveStatus('saved');
      onNoteSaved?.();
      // Reset to idle after 2s
      setTimeout(() => setSaveStatus(prev => prev === 'saved' ? 'idle' : prev), 2000);
    } catch (err) {
      console.error('Auto-save failed:', err);
      setSaveStatus('failed');
    }
  }, [editor, onNoteSaved]);

  // ── Load note ──────────────────────────────────────────────────

  useEffect(() => {
    currentNoteIdRef.current = noteId;

    if (!noteId) {
      setNote(null);
      setTitle('');
      editor?.commands.clearContent();
      setSaveStatus('idle');
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const fetched = await notesApi.get(noteId);
        if (cancelled) return;
        setNote(fetched);
        setTitle(fetched.title);

        // Set editor content
        if (editor) {
          try {
            const parsed = JSON.parse(fetched.content);
            editor.commands.setContent(parsed);
          } catch {
            editor.commands.setContent(fetched.content || '');
          }
        }

        // Focus title for new (empty) notes
        if (!fetched.title && fetched.content === '{}') {
          isNewNoteRef.current = true;
          setTimeout(() => titleRef.current?.focus(), 100);
        } else {
          isNewNoteRef.current = false;
        }
      } catch (err) {
        console.error('Failed to load note:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // Save any pending changes before switching
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [noteId, editor]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ── Title change handler ───────────────────────────────────────

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    scheduleSave();
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editor?.commands.focus();
    }
  };

  // ── Toolbar actions ────────────────────────────────────────────

  const addLink = useCallback(() => {
    const url = prompt('Enter URL:');
    if (url) {
      editor?.chain().focus().setLink({ href: url }).run();
    }
  }, [editor]);

  const insertTable = useCallback(() => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [editor]);

  // ── Render ─────────────────────────────────────────────────────

  if (!noteId) {
    return (
      <main className="editor-panel" aria-label="Note editor">
        <div className="editor-empty">
          <p>Select a note or create a new one</p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="editor-panel" aria-label="Note editor">
        <div className="editor-empty">
          <p>Loading…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="editor-panel" aria-label="Note editor">
      {/* Editor Toolbar */}
      <div className="editor-toolbar" role="toolbar" aria-label="Formatting toolbar">
        <button
          className={`editor-toolbar-btn ${editor?.isActive('bold') ? 'editor-toolbar-btn--active' : ''}`}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          title="Bold"
          aria-label="Bold"
        >
          <strong>B</strong>
        </button>
        <button
          className={`editor-toolbar-btn ${editor?.isActive('italic') ? 'editor-toolbar-btn--active' : ''}`}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          title="Italic"
          aria-label="Italic"
        >
          <em>I</em>
        </button>
        <button
          className={`editor-toolbar-btn ${editor?.isActive('underline') ? 'editor-toolbar-btn--active' : ''}`}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          title="Underline"
          aria-label="Underline"
        >
          <u>U</u>
        </button>
        <button
          className={`editor-toolbar-btn ${editor?.isActive('strike') ? 'editor-toolbar-btn--active' : ''}`}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          title="Strikethrough"
          aria-label="Strikethrough"
        >
          <s>S</s>
        </button>

        <span className="editor-toolbar-divider" />

        <button
          className={`editor-toolbar-btn ${editor?.isActive('heading', { level: 1 }) ? 'editor-toolbar-btn--active' : ''}`}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          title="Heading 1"
          aria-label="Heading 1"
        >
          H1
        </button>
        <button
          className={`editor-toolbar-btn ${editor?.isActive('heading', { level: 2 }) ? 'editor-toolbar-btn--active' : ''}`}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Heading 2"
          aria-label="Heading 2"
        >
          H2
        </button>
        <button
          className={`editor-toolbar-btn ${editor?.isActive('heading', { level: 3 }) ? 'editor-toolbar-btn--active' : ''}`}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          title="Heading 3"
          aria-label="Heading 3"
        >
          H3
        </button>

        <span className="editor-toolbar-divider" />

        <button
          className={`editor-toolbar-btn ${editor?.isActive('bulletList') ? 'editor-toolbar-btn--active' : ''}`}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          title="Bullet list"
          aria-label="Bullet list"
        >
          •
        </button>
        <button
          className={`editor-toolbar-btn ${editor?.isActive('orderedList') ? 'editor-toolbar-btn--active' : ''}`}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          title="Numbered list"
          aria-label="Numbered list"
        >
          1.
        </button>
        <button
          className={`editor-toolbar-btn ${editor?.isActive('taskList') ? 'editor-toolbar-btn--active' : ''}`}
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
          title="Checklist"
          aria-label="Checklist"
        >
          ☑
        </button>

        <span className="editor-toolbar-divider" />

        <button
          className={`editor-toolbar-btn ${editor?.isActive('blockquote') ? 'editor-toolbar-btn--active' : ''}`}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          title="Block quote"
          aria-label="Block quote"
        >
          ❝
        </button>
        <button
          className={`editor-toolbar-btn ${editor?.isActive('codeBlock') ? 'editor-toolbar-btn--active' : ''}`}
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          title="Code block"
          aria-label="Code block"
        >
          {'</>'}
        </button>
        <button
          className="editor-toolbar-btn"
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          title="Horizontal rule"
          aria-label="Horizontal rule"
        >
          ―
        </button>

        <span className="editor-toolbar-divider" />

        <button
          className={`editor-toolbar-btn ${editor?.isActive('link') ? 'editor-toolbar-btn--active' : ''}`}
          onClick={addLink}
          title="Insert link"
          aria-label="Insert link"
        >
          🔗
        </button>
        <button
          className="editor-toolbar-btn"
          onClick={handleImagePicker}
          title="Insert image"
          aria-label="Insert image"
        >
          🖼️
        </button>
        <button
          className="editor-toolbar-btn"
          onClick={insertTable}
          title="Insert table"
          aria-label="Insert table"
        >
          📊
        </button>
      </div>

      {/* Title */}
      <div className="editor-title-area">
        <input
          ref={titleRef}
          className="editor-title-input"
          type="text"
          value={title}
          onChange={handleTitleChange}
          onKeyDown={handleTitleKeyDown}
          placeholder="Untitled"
          aria-label="Note title"
        />
      </div>

      {/* Editor Content */}
      <div className="editor-content">
        <EditorContent editor={editor} />
      </div>

      {/* Tags */}
      {note && (
        <TagInput noteId={note.id} initialTags={note.tags || []} />
      )}

      {/* Save Status */}
      <div className="editor-status">
        {saveStatus === 'saving' && <span className="save-status save-status--saving">Saving…</span>}
        {saveStatus === 'saved' && <span className="save-status save-status--saved">✓ Saved</span>}
        {saveStatus === 'failed' && <span className="save-status save-status--failed">✕ Save failed</span>}
      </div>
    </main>
  );
}
