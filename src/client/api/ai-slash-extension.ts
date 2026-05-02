import { Extension } from '@tiptap/core';

export type AiCommandCallback = (instruction: string, from: number, to: number) => void;

/**
 * TipTap extension that intercepts Enter when the current line starts
 * with "/ai <instruction>" and fires onCommand instead of inserting a newline.
 */
export const AiSlashCommand = Extension.create<{ onCommand: AiCommandCallback }>({
  name: 'aiSlashCommand',

  addOptions() {
    return { onCommand: () => {} };
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;                     // don't intercept if text selected

        const lineText = $from.parent.textContent;
        const trimmed  = lineText.trim();
        if (!trimmed.startsWith('/ai ')) return false;

        const instruction = trimmed.slice(4).trim();
        if (!instruction) return false;

        const from = $from.start();  // start of paragraph content
        const to   = $from.end();    // end of paragraph content
        this.options.onCommand(instruction, from, to);
        return true;  // prevent default newline insertion
      },
    };
  },
});
