import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Editor } from '@tiptap/react';
import { streamChat, loadAIConfig } from '../api/ai-client';

interface Props {
  editor: Editor;
  noteContext: string;
}

const ACTIONS = [
  { id: 'improve',     label: '✨ Improve'      },
  { id: 'fix-grammar', label: '📝 Fix grammar'  },
  { id: 'shorter',     label: '↕ Shorter'       },
  { id: 'longer',      label: '↔ Longer'        },
  { id: 'summarize',   label: '📋 Summarize'    },
  { id: 'continue',    label: '▶ Continue'      },
] as const;

const PROMPTS: Record<string, string> = {
  'improve':     'Rewrite the following text to be clearer, more engaging, and better written. Return only the improved text with no explanation or preamble:',
  'fix-grammar': 'Fix all grammar, spelling, and punctuation errors. Return only the corrected text with no explanation:',
  'shorter':     'Rewrite to be more concise while preserving the core meaning. Return only the shortened text:',
  'longer':      'Expand and elaborate on the following text with more detail and depth. Return only the expanded text:',
  'summarize':   'Write a brief, clear summary of the following text. Return only the summary:',
  'continue':    'Continue writing naturally from where the following text ends. Return only the continuation text:',
};

export function AISelectionToolbar({ editor, noteContext }: Props) {
  const [visible, setVisible]         = useState(false);
  const [position, setPosition]       = useState({ top: 0, left: 0 });
  const [busy, setBusy]               = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const config     = loadAIConfig();
  const isMobile   = 'ontouchstart' in window;

  // Track selection position
  useEffect(() => {
    if (!editor || isMobile || !config) return;

    const update = () => {
      const { from, to } = editor.state.selection;
      if (from === to) { setVisible(false); return; }

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) { setVisible(false); return; }

      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || rect.width === 0) { setVisible(false); return; }

      // Position toolbar centred above the selection
      const left = Math.max(8, Math.min(
        rect.left + rect.width / 2 - 160,
        window.innerWidth - 328,
      ));
      setPosition({ top: rect.top - 48, left });
      setVisible(true);
    };

    editor.on('selectionUpdate', update);
    return () => { editor.off('selectionUpdate', update); };
  }, [editor, isMobile, config]);

  // Dismiss on outside click when nothing selected
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolbarRef.current?.contains(e.target as Node)) return;
      const { from, to } = editor.state.selection;
      if (from === to) setVisible(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editor]);

  const handleAction = useCallback(async (actionId: string) => {
    if (busy || !config) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;

    const selectedText = editor.state.doc.textBetween(from, to, ' ');
    if (!selectedText.trim()) return;

    setBusy(true);
    setActiveAction(actionId);
    setVisible(false);

    try {
      const prompt = PROMPTS[actionId];
      let result = '';
      for await (const chunk of streamChat(
        [{ role: 'user', content: `${prompt}\n\n${selectedText}` }],
        noteContext,
        config,
      )) {
        result += chunk;
      }
      result = result.trim();
      if (result) {
        editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, result).run();
      }
    } catch (err: any) {
      console.error('[AI selection edit]', err);
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }, [editor, noteContext, config, busy]);

  if (isMobile || !config) return null;

  if (busy) {
    return (
      <div className="ai-selection-toolbar ai-selection-toolbar--busy" style={{ top: position.top, left: position.left }}>
        <span className="ai-selection-spinner">✨</span>
        <span>{ACTIONS.find(a => a.id === activeAction)?.label ?? 'AI'} writing…</span>
      </div>
    );
  }

  if (!visible) return null;

  return (
    <div ref={toolbarRef} className="ai-selection-toolbar" style={{ top: position.top, left: position.left }}>
      {ACTIONS.map(action => (
        <button
          key={action.id}
          className="ai-selection-action"
          onClick={() => handleAction(action.id)}
          type="button"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
