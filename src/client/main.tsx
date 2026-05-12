import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { debugLog } from './components/DebugOverlay';
import './styles.css';

// ── Global error capture ───────────────────────────────────────────

window.onerror = (msg, src, line, col, err) => {
  debugLog(`ERROR: ${msg} (${src}:${line})`);
  console.error('Uncaught error:', msg, src, line, col, err);
};

window.addEventListener('unhandledrejection', (e) => {
  debugLog(`UNHANDLED: ${e.reason?.message ?? e.reason}`);
  console.error('Unhandled promise rejection:', e.reason);
});

// ── Error boundary ─────────────────────────────────────────────────

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    debugLog(`BOUNDARY: ${error.message}`);
    console.error('React error boundary caught:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 20, fontFamily: 'monospace', background: '#1a0000',
          color: '#ff6b6b', minHeight: '100vh', whiteSpace: 'pre-wrap',
          fontSize: 13,
        }}>
          <strong>💥 App crashed</strong>{'\n\n'}
          {this.state.error.message}{'\n\n'}
          {this.state.error.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Mount ──────────────────────────────────────────────────────────

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

debugLog('main.tsx: mounting');

ReactDOM.createRoot(root).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// ── Service Worker Registration ────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(
      (registration) => {
        console.log('Service worker registered:', registration.scope);
      },
      (err) => {
        // Graceful failure — app continues without offline support
        console.warn('Service worker registration failed:', err);
      }
    );
  });
}
