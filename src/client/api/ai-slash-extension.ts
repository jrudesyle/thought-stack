import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type AiCommandCallback = (instruction: string, from: number, to: number) => void;

const aiModeKey = new PluginKey('aiMode');

/**
 * TipTap extension that:
 * 1. Intercepts Enter when the current line starts with "/ai <instruction>"
 *    and fires onCommand instead of inserting a newline.
 * 2. Decorates any paragraph starting with "/ai " with the ai-slash-active
 *    CSS class so the user gets a visual cue they're in AI mode.
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
        if (!empty) return false;

        const lineText = $from.parent.textContent;
        const trimmed  = lineText.trim();
        if (!trimmed.startsWith('/ai ')) return false;

        const instruction = trimmed.slice(4).trim();
        if (!instruction) return false;

        const from = $from.start();
        const to   = $from.end();
        this.options.onCommand(instruction, from, to);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiModeKey,
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'paragraph') {
                const text = node.textContent;
                if (text.startsWith('/ai ') && text.length > 4) {
                  decorations.push(
                    Decoration.node(pos, pos + node.nodeSize, { class: 'ai-slash-active' }),
                  );
                }
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
