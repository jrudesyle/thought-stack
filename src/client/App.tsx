import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Sidebar, type SidebarView } from './components/Sidebar';
import { NoteList, type NoteListContext } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { SearchBar } from './components/SearchBar';
import { SettingsPanel, applyTheme, loadThemePreference, saveThemePreference, type ThemePreference } from './components/SettingsPanel';
import { OfflineIndicator } from './components/OfflineIndicator';
import { VaultPicker } from './components/VaultPicker';
import { DebugOverlay, debugLog } from './components/DebugOverlay';
import {
  notebooks as notebooksApi,
  notes as notesApi,
  system as systemApi,
  conflicts as conflictsApi,
  isVaultReady,
  hasStoredVault,
  reconnectVault,
  isOPFSAvailable,
  initOPFS,
  type SearchResult,
  type NoteSummary,
  type ConflictFile,
} from './api';

// ── App State ──────────────────────────────────────────────────────

type AppView = 'all-notes' | 'notebook' | 'tag' | 'trash' | 'search';

export function App() {
  // Vault state
  const [vaultReady, setVaultReady] = useState(false);
  const [vaultPath, setVaultPath] = useState('');
  const [vaultChecked, setVaultChecked] = useState(false);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  const [activeView, setActiveView] = useState<AppView>('all-notes');
  const [selectedNotebookName, setSelectedNotebookName] = useState<string | null>(null);
  const [selectedTagName, setSelectedTagName] = useState<string | null>(null);
  const [selectedNotePath, setSelectedNotePath] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<NoteSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [previousView, setPreviousView] = useState<AppView>('all-notes');
  const [previousNotebookName, setPreviousNotebookName] = useState<string | null>(null);
  const [previousTagName, setPreviousTagName] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dataChangeKey, setDataChangeKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conflictFiles, setConflictFiles] = useState<ConflictFile[]>([]);
  const [conflictBannerDismissed, setConflictBannerDismissed] = useState(false);
  const [debugMode, setDebugMode] = useState(() => {
    try { return localStorage.getItem('debug-overlay') === 'true'; } catch { return false; }
  });

  // Theme state (owned here so dropdown lives in toolbar)
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [themeDropOpen, setThemeDropOpen] = useState(false);
  const themeDropRef = useRef<HTMLDivElement>(null);

  const THEME_GROUPS: { label: string; items: [ThemePreference, string, string, string][] }[] = [
    { label: 'System', items: [
      ['system',      '🖥', 'System',     '#888,#ccc'],
      ['light',       '☀', 'Light',       '#f5f5f5,#fff'],
      ['dark',        '🌙', 'Dark',        '#1a1816,#2e2a28'],
    ]},
    { label: 'Apps', items: [
      ['notion',      '◻', 'Notion',      '#f7f6f3,#37352f'],
      ['bear',        '🐻', 'Bear',        '#fefefe,#e84041'],
      ['evernote',    '🐘', 'Evernote',    '#2d2d2d,#00a82d'],
      ['github',      '🐙', 'GitHub',      '#f6f8fa,#0969da'],
      ['linear',      '⚡', 'Linear',      '#0f0f11,#5e6ad2'],
      ['obsidian',    '💜', 'Obsidian',    '#1e1e1e,#7c3aed'],
    ]},
    { label: 'Colors', items: [
      ['ocean',       '🌊', 'Ocean',       '#0b4a7a,#0077cc'],
      ['tokyo-night', '🌃', 'Tokyo Night', '#1a1b2e,#f7768e'],
      ['forest',      '🌿', 'Forest',      '#101810,#4ade80'],
      ['night-owl',   '🦉', 'Night Owl',   '#011627,#82aaff'],
      ['gruvbox',     '🟠', 'Gruvbox',     '#282828,#fabd2f'],
    ]},
    { label: 'Warm', items: [
      ['warm-paper',  '📜', 'Warm Paper',  '#3d2b1f,#b5531a'],
      ['sunset',      '🌅', 'Sunset',      '#7b2d00,#e8650a'],
      ['solarized',   '☀', 'Solarized',   '#073642,#268bd2'],
    ]},
    { label: 'Dev', items: [
      ['vscode',       '🖊', 'VS Code Dark',  '#1e1e1e,#007acc'],
      ['vscode-light', '🖊', 'VS Code Light', '#dddddd,#007acc'],
    ]},
  ];

  // ── Check vault on mount ───────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const isFSA = typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function';
        const isTauri = typeof window !== 'undefined' && typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
        const isElectron = typeof window !== 'undefined' && typeof (window as any).electronAPI !== 'undefined';

        if (isFSA && !isTauri && !isElectron) {
          const ready = await isVaultReady();
          if (ready) {
            const path = await systemApi.getVaultPath();
            setVaultPath(path);
            setVaultReady(true);
          } else {
            // Check if there's a stored handle that just needs permission re-grant
            const stored = await hasStoredVault();
            if (stored) setNeedsUnlock(true);
            // else: no vault at all → show VaultPicker
          }
          return;
        }

        // OPFS mode: iOS Safari, Firefox — no directory picker but OPFS is available.
        // Auto-initialise silently; user never needs to pick a folder.
        if (!isTauri && !isElectron && isOPFSAvailable()) {
          await initOPFS();
          setVaultPath('OPFS');
          setVaultReady(true);
          return;
        }

        // Tauri or Electron mode
        const path = await systemApi.getVaultPath();
        if (path) { setVaultPath(path); setVaultReady(true); }
      } catch (err) {
        console.error('Failed to check vault path:', err);
        debugLog(`vault check error: ${(err as any)?.message ?? err}`);
        const isElectron = typeof window !== 'undefined' && typeof (window as any).electronAPI !== 'undefined';
        if (!isElectron) setVaultReady(true);
      } finally {
        setVaultChecked(true);
      }
    })();
  }, []);

  // ── Load theme preference on mount ─────────────────────────────

  useEffect(() => {
    loadThemePreference().then(t => { setTheme(t); applyTheme(t); });
    const storedFont = localStorage.getItem('font-preference') ?? 'system';
    if (storedFont !== 'system') document.documentElement.setAttribute('data-font', storedFont);
  }, []);

  const handleThemeChange = useCallback(async (t: ThemePreference) => {
    setTheme(t);
    applyTheme(t);
    await saveThemePreference(t);
    setThemeDropOpen(false);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (themeDropRef.current && !themeDropRef.current.contains(e.target as Node))
        setThemeDropOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Detect cloud sync conflicts when vault is ready ────────────

  useEffect(() => {
    if (!vaultReady) return;

    (async () => {
      try {
        const detected = await conflictsApi.detect();
        if (Array.isArray(detected) && detected.length > 0) {
          setConflictFiles(detected);
        }
      } catch (err) {
        console.error('Failed to detect conflicts:', err);
      }
    })();
  }, [vaultReady, dataChangeKey]);

  // ── Vault ready callback ───────────────────────────────────────

  const handleVaultReady = useCallback(async () => {
    try {
      const path = await systemApi.getVaultPath();
      setVaultPath(path);
    } catch {
      // Proceed anyway
    }
    setVaultReady(true);
    setDataChangeKey(k => k + 1);
    setRefreshKey(k => k + 1);
  }, []);

  // ── Sidebar collapse persistence ───────────────────────────────

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar-collapsed', String(next)); } catch {}
      return next;
    });
  }, []);

  // ── View navigation ────────────────────────────────────────────

  const handleSelectView = useCallback((view: SidebarView) => {
    setActiveView(view);
    setSelectedNotebookName(null);
    setSelectedTagName(null);
    setSelectedNotePath(null);
  }, []);

  const handleSelectNotebook = useCallback((notebookName: string) => {
    setActiveView('notebook');
    setSelectedNotebookName(notebookName);
    setSelectedTagName(null);
    setSelectedNotePath(null);
  }, []);

  const handleSelectTag = useCallback((tagName: string) => {
    setActiveView('tag');
    setSelectedTagName(tagName);
    setSelectedNotebookName(null);
    setSelectedNotePath(null);
  }, []);

  const handleSelectNote = useCallback((notePath: string | null) => {
    setSelectedNotePath(notePath);
  }, []);

  // ── Search ─────────────────────────────────────────────────────

  const handleSearchResults = useCallback((results: SearchResult[], query: string) => {
    // Save current view for restore
    if (activeView !== 'search') {
      setPreviousView(activeView);
      setPreviousNotebookName(selectedNotebookName);
      setPreviousTagName(selectedTagName);
    }

    // Convert SearchResult[] to NoteSummary-like objects for NoteList
    const noteResults: NoteSummary[] = results.map(r => ({
      id: r.noteId,
      title: r.title,
      path: '', // Search results don't carry full path; NoteList handles display
      notebook: r.notebook,
      tags: r.tags,
      created: r.modified,
      modified: r.modified,
      snippet: r.snippet,
    }));

    setSearchResults(noteResults);
    setSearchQuery(query);
    setActiveView('search');
  }, [activeView, selectedNotebookName, selectedTagName]);

  const handleClearSearch = useCallback(() => {
    setSearchResults([]);
    setSearchQuery('');
    setActiveView(previousView);
    setSelectedNotebookName(previousNotebookName);
    setSelectedTagName(previousTagName);
  }, [previousView, previousNotebookName, previousTagName]);

  // ── Create note ────────────────────────────────────────────────

  const handleCreateNote = useCallback(async () => {
    try {
      let notebookName = selectedNotebookName;

      // If no notebook selected, use first available or create one
      if (!notebookName) {
        const nbs = await notebooksApi.list();
        if (nbs.length > 0) {
          notebookName = nbs[0].name;
        } else {
          await notebooksApi.create('My Notebook');
          notebookName = 'My Notebook';
          setDataChangeKey(k => k + 1);
        }
      }

      const note = await notesApi.create(notebookName);
      setSelectedNotePath(note.path);
      setRefreshKey(k => k + 1);
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  }, [selectedNotebookName]);

  // ── Note saved callback ────────────────────────────────────────

  const handleNoteSaved = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  // ── Build NoteList context ─────────────────────────────────────

  const noteListContext: NoteListContext = useMemo(() => {
    switch (activeView) {
      case 'all-notes':
        return { type: 'all-notes' as const };
      case 'notebook':
        return { type: 'notebook' as const, notebook: selectedNotebookName! };
      case 'tag':
        return { type: 'tag' as const, tag: selectedTagName! };
      case 'trash':
        return { type: 'trash' as const };
      case 'search':
        return { type: 'search' as const, results: searchResults };
      default:
        return { type: 'all-notes' as const };
    }
  }, [activeView, selectedNotebookName, selectedTagName, searchResults]);

  // ── View title ─────────────────────────────────────────────────

  const viewTitle = (): string => {
    switch (activeView) {
      case 'all-notes': return 'All Notes';
      case 'notebook': return selectedNotebookName ?? 'Notebook';
      case 'tag': return `Tag: ${selectedTagName ?? ''}`;
      case 'trash': return 'Trash';
      case 'search': return `Search: "${searchQuery}"`;
    }
  };

  // ── Show loading while checking vault ──────────────────────────

  if (!vaultChecked) {
    return (
      <div className="app-layout">
        <div className="editor-empty" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  // ── Show VaultPicker if no vault configured ────────────────────

  if (!vaultReady) {
    const isFSA = typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function';
    const isElectron = typeof window !== 'undefined' && typeof (window as any).electronAPI !== 'undefined';

    // Stored vault exists but needs permission re-grant (e.g. after page refresh)
    if (isFSA && needsUnlock) {
      return (
        <div className="app-layout">
          <header className="toolbar">
            <div className="vault-picker-logo" style={{ fontSize: '1.2rem', margin: 0 }}>🔒</div>
            <span style={{ flex: 1, fontWeight: 700, fontSize: '1rem', paddingLeft: 8 }}>ThoughtStack</span>
          </header>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: '3rem' }}>🔒</div>
            <p style={{ fontSize: '1rem', color: 'var(--color-text-secondary)', maxWidth: 280 }}>
              Tap below to reconnect to your vault. Android requires this on every page load.
            </p>
            <button
              className="vault-picker-btn vault-picker-btn--primary"
              style={{ fontSize: '1.1rem', padding: '14px 32px' }}
              disabled={unlocking}
              onClick={async () => {
                setUnlocking(true);
                const ok = await reconnectVault();
                if (ok) {
                  const path = await systemApi.getVaultPath();
                  setVaultPath(path);
                  setVaultReady(true);
                  setNeedsUnlock(false);
                  setRefreshKey(k => k + 1);
                } else {
                  setNeedsUnlock(false); // fall through to full picker
                }
                setUnlocking(false);
              }}
            >
              {unlocking ? '⏳ Unlocking…' : '🔓 Unlock Vault'}
            </button>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
              Your vault folder is remembered — just tap to re-grant access.
            </p>
          </div>
        </div>
      );
    }

    if (isFSA || isElectron) {
      return <VaultPicker onVaultReady={handleVaultReady} />;
    }
  }

  return (
    <div className="app-layout">
      {/* Toolbar */}
      <header className="toolbar">
        <button
          className="toolbar-btn sidebar-toggle"
          onClick={() => {
            // On mobile: toggle overlay; on desktop: collapse sidebar
            if (window.innerWidth <= 768) {
              setMobileSidebarOpen(o => !o);
            } else {
              toggleSidebar();
            }
          }}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          ☰
        </button>
        <div className="toolbar-search">
          <SearchBar
            onSearchResults={handleSearchResults}
            onClearSearch={handleClearSearch}
            isSearchActive={activeView === 'search'}
          />
        </div>
        {/* Theme dropdown */}
        {(() => {
          const allThemes = THEME_GROUPS.flatMap(g => g.items);
          const current = allThemes.find(([t]) => t === theme) ?? allThemes[0];
          const [, icon, , swatches] = current;
          const [s1, s2] = swatches.split(',');
          return (
            <div className="toolbar-theme-dropdown" ref={themeDropRef}>
              <button
                className="toolbar-theme-trigger toolbar-btn"
                onClick={() => setThemeDropOpen(o => !o)}
                title="Switch theme"
                aria-label="Switch theme"
              >
                <span className="toolbar-theme-swatch" style={{ background: `linear-gradient(135deg, ${s1} 50%, ${s2} 50%)` }} />
                <span style={{ fontSize: '0.9em' }}>{icon}</span>
              </button>
              {themeDropOpen && (
                <div className="settings-theme-dropdown__menu toolbar-theme-menu">
                  {THEME_GROUPS.map(group => (
                    <React.Fragment key={group.label}>
                      <div className="settings-theme-dropdown__group-label">{group.label}</div>
                      {group.items.map(([t, ico, lbl, sw]) => {
                        const [c1, c2] = sw.split(',');
                        return (
                          <button
                            key={t}
                            className={`settings-theme-dropdown__item${theme === t ? ' settings-theme-dropdown__item--active' : ''}`}
                            onClick={() => handleThemeChange(t)}
                          >
                            <span className="settings-theme-swatch" style={{ background: `linear-gradient(135deg, ${c1} 50%, ${c2} 50%)` }} />
                            <span>{ico}</span>
                            <span>{lbl}</span>
                            {theme === t && <span style={{ marginLeft: 'auto', color: 'var(--color-primary)' }}>✓</span>}
                          </button>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
        <div className="toolbar-actions">
          <button className="toolbar-btn" onClick={handleCreateNote} aria-label="New note" title="New note">
            ✚
          </button>
          <button className="toolbar-btn" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>
            ⚙
          </button>
        </div>
      </header>

      {/* Conflict Banner */}
      {conflictFiles.length > 0 && !conflictBannerDismissed && (
        <div className="conflict-banner" role="alert">
          <span className="conflict-banner-icon">⚠️</span>
          <span className="conflict-banner-text">
            {conflictFiles.length} conflict file{conflictFiles.length !== 1 ? 's' : ''} detected
            from cloud sync ({[...new Set(conflictFiles.map(c => c.provider))].join(', ')}).
            Review these files in your vault folder to resolve duplicates.
          </span>
          <button
            className="conflict-banner-dismiss"
            onClick={() => setConflictBannerDismissed(true)}
            aria-label="Dismiss conflict warning"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main content area */}
      <div className="main-content">
        {/* Mobile sidebar backdrop */}
        {mobileSidebarOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setMobileSidebarOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(0,0,0,0.4)' }}
          />
        )}

        {/* Sidebar */}
        {(!sidebarCollapsed || mobileSidebarOpen) && (
          <Sidebar
            activeView={activeView === 'search' ? 'all-notes' : activeView as SidebarView}
            selectedNotebookName={selectedNotebookName}
            selectedTagName={selectedTagName}
            collapsed={sidebarCollapsed}
            onSelectView={(v) => { handleSelectView(v); setMobileSidebarOpen(false); }}
            onSelectNotebook={(n) => { handleSelectNotebook(n); setMobileSidebarOpen(false); }}
            onSelectTag={(t) => { handleSelectTag(t); setMobileSidebarOpen(false); }}
            onToggleCollapse={toggleSidebar}
            onDataChange={dataChangeKey as any}
            className={mobileSidebarOpen ? 'sidebar--mobile-open' : ''}
          />
        )}

        {/* Note List */}
        <NoteList
          context={noteListContext}
          selectedNotePath={selectedNotePath}
          onSelectNote={(p) => { handleSelectNote(p); }}
          onCreateNote={handleCreateNote}
          refreshKey={refreshKey}
        />

        {/* Editor wrapper — slides over note list on mobile when a note is open */}
        <div className={`editor-pane${selectedNotePath ? ' editor-pane--mobile-open' : ''}`}>
          {selectedNotePath && (
            <button
              className="editor-back-btn mobile-only"
              onClick={() => handleSelectNote(null)}
              aria-label="Back to notes"
            >
              ← Notes
            </button>
          )}
          <NoteEditor
            notePath={selectedNotePath}
            onNoteSaved={handleNoteSaved}
          />
        </div>
      </div>

      {/* Status Bar */}
      <footer className="status-bar">
        <span className="status-bar-item">{viewTitle()}</span>
        <OfflineIndicator />
      </footer>

      {/* Settings Panel */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        debugMode={debugMode}
        onToggleDebug={(v) => {
          setDebugMode(v);
          try { localStorage.setItem('debug-overlay', String(v)); } catch {}
        }}
      />

      {/* Debug Overlay */}
      {debugMode && (
        <DebugOverlay
          vaultReady={vaultReady}
          vaultChecked={vaultChecked}
          needsUnlock={needsUnlock}
          vaultPath={vaultPath}
          refreshKey={refreshKey}
          dataChangeKey={dataChangeKey}
        />
      )}
    </div>
  );
}
