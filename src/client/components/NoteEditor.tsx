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
import { Markdown } from 'tiptap-markdown';
import { notes as notesApi, images as imagesApi, type NoteData } from '../api';
import { TagInput } from './TagInput';
import { AISelectionToolbar } from './AISelectionToolbar';
import { AiSlashCommand } from '../api/ai-slash-extension';
import { streamChat, loadAIConfig, classifyAiInstruction, type AiIntent } from '../api/ai-client';

// ── Types ──────────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

interface NoteEditorProps {
  notePath: string | null;
  onNoteSaved?: () => void;
}

// ── Environment detection ──────────────────────────────────────────

const isElectronMode = typeof window !== 'undefined' && typeof (window as any).electronAPI !== 'undefined';

// ── Image path helpers ─────────────────────────────────────────────

/**
 * Converts relative image paths in Markdown (e.g., `.images/abc.png`)
 * to displayable URLs.
 *
 * - Electron mode: uses vault:// protocol URLs
 * - HTTP mode: uses /api/vault-images/ prefix
 */
function markdownToVaultUrls(markdown: string, notebook: string): string {
  if (isElectronMode) {
    return markdown.replace(
      /!\[([^\]]*)\]\(\.images\/([^)]+)\)/g,
      (_match, alt, filename) =>
        `![${alt}](vault://${encodeURIComponent(notebook)}/.images/${filename})`
    );
  }
  // HTTP mode: use the server's image endpoint
  return markdown.replace(
    /!\[([^\]]*)\]\(\.images\/([^)]+)\)/g,
    (_match, alt, filename) =>
      `![${alt}](/api/vault-images/${encodeURIComponent(notebook)}/.images/${filename})`
  );
}

/**
 * Converts display URLs back to relative image paths for storage.
 * Handles both vault:// (Electron) and /api/vault-images/ (HTTP) formats.
 */
function vaultUrlsToMarkdown(markdown: string): string {
  // Handle vault:// protocol URLs (Electron mode)
  let result = markdown.replace(
    /!\[([^\]]*)\]\(vault:\/\/[^/]+\/\.images\/([^)]+)\)/g,
    (_match, alt, filename) => `![${alt}](.images/${filename})`
  );
  // Handle /api/vault-images/ URLs (HTTP mode)
  result = result.replace(
    /!\[([^\]]*)\]\(\/api\/vault-images\/[^/]+\/\.images\/([^)]+)\)/g,
    (_match, alt, filename) => `![${alt}](.images/${filename})`
  );
  return result;
}

// ── Component ──────────────────────────────────────────────────────

export function NoteEditor({ notePath, onNoteSaved }: NoteEditorProps) {
  const [note, setNote]               = useState<NoteData | null>(null);
  const [title, setTitle]             = useState('');
  const [currentTags, setCurrentTags] = useState<string[]>([]);
  const [saveStatus, setSaveStatus]   = useState<SaveStatus>('idle');
  const [loading, setLoading]         = useState(false);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [retryKey, setRetryKey]       = useState(0);
  const [toolbarOpen, setToolbarOpen] = useState(() => {
    try { return localStorage.getItem('toolbar-open') === 'true'; } catch { return false; }
  });
  const [aiSlashBusy, setAiSlashBusy] = useState(false);
  const [aiSlashLabel, setAiSlashLabel] = useState('');
  const [aiSlashIntent, setAiSlashIntent] = useState<AiIntent>('replace');
  const [aiAnswer, setAiAnswer] = useState<{ text: string; insertPos: number } | null>(null);
  const titleRef              = useRef<HTMLInputElement>(null);
  const saveTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentNotePathRef    = useRef<string | null>(null);
  const currentTagsRef        = useRef<string[]>([]);
  const isNewNoteRef          = useRef(false);
  const aiSlashHandlerRef     = useRef<((instruction: string, from: number, to: number) => void) | null>(null);

  // Keep tags ref in sync
  useEffect(() => {
    currentTagsRef.current = currentTags;
  }, [currentTags]);

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
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      AiSlashCommand.configure({
        onCommand: (instruction, from, to) => {
          aiSlashHandlerRef.current?.(instruction, from, to);
        },
      }),
    ],
    editorProps: {
      handleDrop(view, event) {
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

  // ── /ai slash command handler (defined after editor to avoid TDZ) ──

  const handleAiSlashCommand = useCallback(async (instruction: string, from: number, to: number) => {
    const config = loadAIConfig();
    if (!config || !editor) return;

    const intent = classifyAiInstruction(instruction);
    setAiSlashBusy(true);
    setAiSlashIntent(intent);
    setAiSlashLabel(instruction.length > 30 ? instruction.slice(0, 30) + '…' : instruction);
    setAiAnswer(null);

    // Always remove the /ai ... line first
    editor.chain().focus().deleteRange({ from, to }).run();

    try {
      const noteCtx = `${titleRef.current?.value ?? ''}\n\n${editor.storage.markdown.getMarkdown()}`;
      let result = '';
      for await (const chunk of streamChat(
        [{ role: 'user', content: instruction }],
        noteCtx,
        config,
      )) {
        result += chunk;
      }
      result = result.trim();
      if (!result) return;

      if (intent === 'question') {
        // Show answer in popup — don't touch note content
        setAiAnswer({ text: result, insertPos: from });
      } else if (intent === 'append') {
        // Insert after the last character of the document
        const end = editor.state.doc.content.size;
        editor.chain().focus().insertContentAt(end, '\n' + result).run();
      } else {
        // replace: insert at the position the /ai line was
        editor.chain().focus().insertContentAt(from, result).run();
      }
    } catch (err: any) {
      console.error('[/ai command]', err);
    } finally {
      setAiSlashBusy(false);
      setAiSlashLabel('');
    }
  }, [editor]);

  // Keep ref current so the extension (created once) always calls the latest handler
  useEffect(() => {
    aiSlashHandlerRef.current = handleAiSlashCommand;
  }, [handleAiSlashCommand]);

  // ── Image handling ─────────────────────────────────────────────

  const insertImageFromFile = useCallback(async (file: File) => {
    if (!note || !editor) {
      console.warn('[NoteEditor] Cannot insert image: no note or editor available');
      return;
    }

    console.log(`[NoteEditor] Inserting image: ${file.name} (${file.type}, ${file.size} bytes)`);

    try {
      // Read file as ArrayBuffer and save via storage API
      const arrayBuffer = await file.arrayBuffer();
      console.log('[NoteEditor] Image data loaded, calling imagesApi.save...');
      
      const result = await imagesApi.save(note.notebook, arrayBuffer, file.type);
      console.log(`[NoteEditor] Image saved successfully: ${result.path}`);
      
      // Insert using the appropriate URL scheme for the current mode.
      // result.path is like ".images/abc123.png"
      let imageUrl: string;
      if (isElectronMode) {
        imageUrl = `vault://${encodeURIComponent(note.notebook)}/${result.path}`;
      } else {
        imageUrl = `/api/vault-images/${encodeURIComponent(note.notebook)}/${result.path}`;
      }
      
      console.log(`[NoteEditor] Inserting image into editor: ${imageUrl}`);
      editor.chain().focus().setImage({ src: imageUrl }).run();
      console.log('[NoteEditor] Image inserted successfully');
    } catch (err) {
      console.error('[NoteEditor] Failed to save image:', err);
      console.log('[NoteEditor] Falling back to base64 embedding');
      
      // Fallback: embed as base64
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        editor?.chain().focus().setImage({ src: dataUrl }).run();
        console.log('[NoteEditor] Base64 image embedded');
      };
      reader.onerror = () => {
        console.error('[NoteEditor] FileReader error:', reader.error);
      };
      reader.readAsDataURL(file);
    }
  }, [editor, note]);

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
    const path = currentNotePathRef.current;
    if (!path || !editor) return;

    const rawContent = editor.storage.markdown.getMarkdown();
    const content = vaultUrlsToMarkdown(rawContent);
    const currentTitle = titleRef.current?.value ?? '';
    const tags = currentTagsRef.current;

    setSaveStatus('saving');
    try {
      const saved = await notesApi.save(path, currentTitle, content, tags);
      // If the file was renamed (title changed), update our path ref so
      // subsequent saves go to the correct file.
      if (saved.path && saved.path !== currentNotePathRef.current) {
        currentNotePathRef.current = saved.path;
      }
      setSaveStatus('saved');
      onNoteSaved?.();
      setTimeout(() => setSaveStatus(prev => prev === 'saved' ? 'idle' : prev), 2000);
    } catch (err) {
      console.error('Auto-save failed:', err);
      setSaveStatus('failed');
    }
  }, [editor, onNoteSaved]);

  // ── Tag change handler ─────────────────────────────────────────

  const handleTagsChange = useCallback((newTags: string[]) => {
    setCurrentTags(newTags);
    scheduleSave();
  }, [scheduleSave]);

  // ── Load note ──────────────────────────────────────────────────

  useEffect(() => {
    currentNotePathRef.current = notePath;

    if (!notePath) {
      setNote(null);
      setTitle('');
      setCurrentTags([]);
      setLoadError(null);
      editor?.commands.clearContent();
      setSaveStatus('idle');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const fetched = await notesApi.get(notePath);
        if (cancelled) return;
        setNote(fetched);
        setTitle(fetched.title);
        setCurrentTags(fetched.tags || []);

        // Set editor content from Markdown, converting relative image paths
        // to vault:// protocol URLs so the renderer can load them.
        if (editor) {
          const contentWithVaultUrls = fetched.content
            ? markdownToVaultUrls(fetched.content, fetched.notebook)
            : '';
          editor.commands.setContent(contentWithVaultUrls);
        }

        // Focus title for new (empty) notes
        if (!fetched.title && !fetched.content) {
          isNewNoteRef.current = true;
          setTimeout(() => titleRef.current?.focus(), 100);
        } else {
          isNewNoteRef.current = false;
        }
      } catch (err) {
        console.error('Failed to load note:', err);
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [notePath, editor, retryKey]);

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

  if (!notePath) {
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

  if (loadError) {
    return (
      <main className="editor-panel" aria-label="Note editor">
        <div className="editor-empty">
          <p style={{ color: 'var(--color-danger, red)', fontSize: '0.9em', padding: '16px', textAlign: 'center' }}>
            ⚠️ Failed to load note
          </p>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.8em', padding: '0 16px', textAlign: 'center', wordBreak: 'break-all' }}>
            {loadError}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <button
              style={{ padding: '8px 20px', borderRadius: 6, border: '1px solid var(--color-border)', cursor: 'pointer', background: 'var(--color-surface)' }}
              onClick={() => { setLoadError(null); setRetryKey(k => k + 1); }}
            >
              Retry
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="editor-panel" aria-label="Note editor">
      {/* Formatting toolbar — collapsible on all screen sizes */}
      <div className={`editor-toolbar-row${toolbarOpen ? ' editor-toolbar-row--open' : ''}`}>
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
        {/* Toggle button lives inside the row, pinned right */}
        <button
          className="editor-toolbar-toggle"
          onClick={() => {
            const next = !toolbarOpen;
            setToolbarOpen(next);
            try { localStorage.setItem('toolbar-open', String(next)); } catch {}
          }}
          aria-label={toolbarOpen ? 'Hide formatting toolbar' : 'Show formatting toolbar'}
          title={toolbarOpen ? 'Hide formatting' : 'Show formatting'}
        >
          {toolbarOpen ? '✕' : 'Aa'}
        </button>
        </div>{/* end .editor-toolbar */}
      </div>{/* end .editor-toolbar-row */}
      {/* Collapsed toggle shown when toolbar is hidden */}
      {!toolbarOpen && (
        <button
          className="editor-toolbar-show-btn"
          onClick={() => {
            setToolbarOpen(true);
            try { localStorage.setItem('toolbar-open', 'true'); } catch {}
          }}
          aria-label="Show formatting toolbar"
          title="Show formatting"
        >
          Aa
        </button>
      )}

      {/* Title + inline tag chip */}
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
        {note && (
          <TagInput
            tags={currentTags}
            onTagsChange={handleTagsChange}
            inline
          />
        )}
      </div>

      {/* Editor Content */}
      <div className="editor-content">
        <EditorContent editor={editor} />
        {/* /ai busy indicator */}
        {aiSlashBusy && (
          <div className={`ai-slash-busy ai-slash-busy--${aiSlashIntent}`}>
            <span className="ai-selection-spinner">✨</span>
            {aiSlashIntent === 'question' && <span>Answering: </span>}
            {aiSlashIntent === 'append'   && <span>Appending: </span>}
            {aiSlashIntent === 'replace'  && <span>Rewriting: </span>}
            <em>{aiSlashLabel}</em>
          </div>
        )}
        {/* Question answer popup */}
        {aiAnswer && (
          <div className="ai-answer-popup">
            <div className="ai-answer-popup__header">
              <span>✨ Answer</span>
              <button className="ai-answer-popup__close" onClick={() => setAiAnswer(null)} title="Dismiss">✕</button>
            </div>
            <div className="ai-answer-popup__body">{aiAnswer.text}</div>
            <div className="ai-answer-popup__actions">
              <button
                className="ai-answer-popup__insert"
                onClick={() => {
                  editor?.chain().focus().insertContentAt(aiAnswer.insertPos, aiAnswer.text).run();
                  setAiAnswer(null);
                }}
              >Insert into note</button>
              <button className="ai-answer-popup__dismiss" onClick={() => setAiAnswer(null)}>Dismiss</button>
            </div>
          </div>
        )}
      </div>

      {/* Save Status */}
      <div className="editor-status">
        {saveStatus === 'saving' && <span className="save-status save-status--saving">Saving…</span>}
        {saveStatus === 'saved' && <span className="save-status save-status--saved">✓ Saved</span>}
        {saveStatus === 'failed' && <span className="save-status save-status--failed">✕ Save failed</span>}
      </div>

      {/* AI Selection Toolbar (desktop only) */}
      {editor && (
        <AISelectionToolbar
          editor={editor}
          noteContext={`${title}\n\n${editor.storage.markdown?.getMarkdown?.() ?? ''}`}
        />
      )}
    </main>
  );
}
