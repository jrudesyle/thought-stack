/**
 * Custom TipTap Image extension for FSA/PWA mode.
 * Dynamically loads images from FileSystem API when src matches .images/ pattern.
 */
import { Image as TiptapImage } from '@tiptap/extension-image';
import { images as imagesApi } from '../api';

// Detect FSA/PWA mode
const isFSAMode = () =>
  typeof window !== 'undefined' &&
  (typeof (window as any).showDirectoryPicker === 'function' ||
   typeof navigator.storage?.getDirectory === 'function');

export const FSAImage = TiptapImage.extend({
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('img');
      
      // Copy all attributes
      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          dom.setAttribute(key, String(value));
        }
      });

      const src = node.attrs.src;
      
      // If in FSA mode and src is .images/ reference, load blob
      if (isFSAMode() && src && src.startsWith('.images/')) {
        const filename = src.replace('.images/', '');
        
        // Extract notebook from current note context
        // We'll pass this via a data attribute or context
        const notebook = dom.closest('[data-notebook]')?.getAttribute('data-notebook') || '';
        
        if (!notebook) {
          console.warn('[FSAImage] No notebook context found for image:', src);
          dom.src = src; // fallback to original
          return { dom };
        }

        // Load image as blob
        (async () => {
          try {
            console.log(`[FSAImage] Loading blob for: ${notebook}/${src}`);
            const blob = await imagesApi.read(notebook, filename);
            const blobUrl = URL.createObjectURL(blob);
            dom.src = blobUrl;
            console.log(`[FSAImage] Blob loaded: ${blobUrl}`);
            
            // Cleanup blob URL when node is destroyed
            dom.addEventListener('load', () => {
              // Store cleanup handler
              (dom as any).__blobCleanup = () => URL.revokeObjectURL(blobUrl);
            }, { once: true });
          } catch (err) {
            console.error(`[FSAImage] Failed to load image blob:`, err);
            dom.src = src; // fallback to original path
          }
        })();
      } else {
        // Not FSA mode or not a .images/ reference - use src as-is
        dom.src = src;
      }

      return {
        dom,
        destroy() {
          // Cleanup blob URL if it was created
          if ((dom as any).__blobCleanup) {
            (dom as any).__blobCleanup();
          }
        },
      };
    };
  },
});
