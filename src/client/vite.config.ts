import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  publicDir: 'public',

  // Use relative paths in production so Electron can load files from disk
  base: process.env.NODE_ENV === 'production' ? './' : '/',

  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Don't proxy module requests (Vite HMR) — only actual API calls
        bypass(req) {
          if (req.url && (req.url.includes('.ts') || req.url.includes('.tsx') || req.url.includes('.js'))) {
            return req.url;
          }
        },
      },
    },
  },

  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    // Electron uses Chromium — target modern Chrome
    target: 'chrome120',
    sourcemap: true,
  },
});
