import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, type SidebarView } from './components/Sidebar';
import { NoteList, type NoteListContext } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { SearchBar } from './components/SearchBar';
import { SettingsPanel, applyTheme, loadThemePreference } from './components/SettingsPanel';
import { OfflineIndicator } from './components/OfflineIndicator';
import { VaultPicker } from './components/VaultPicker';
import {
  notebooks as notebooksApi,
  notes as notesApi,
  system as systemApi,
  conflicts as conflictsApi,
  type SearchResult,
  type NoteSummary,
  type ConflictFile,
} from './api/electron-client';

// ── App State ──────────────────────────────────────────────────────

type AppView = 'all-notes' | 'notebook' | 'tag' | 'trash' | 'search';

export function App() {
  // Vault state
  const [vaultReady, setVaultReady] = useState(false);
  const [vaultPath, setVaultPath] = useState('');
  const [vaultChecked, setVaultChecked] = useState(false);

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

  // ── Check vault on mount ───────────────────────────────────────

  useEffect(() => {
    // Guard: if electronAPI is not available, skip vault check
    if (!window.electronAPI) {
      setVaultChecked(true);
      return;
    }

    (async () => {
      try {
        const path = await systemApi.getVaultPath();
        if (path) {
          setVaultPath(path);
          setVaultReady(true);
        }
      } catch (err) {
        console.error('Failed to check vault path:', err);
      } finally {
        setVaultChecked(true);
      }
    })();
  }, []);

  // ── Load theme preference on mount ─────────────────────────────

  useEffect(() => {
    loadThemePreference().then(applyTheme);
  }, []);

  // ── Detect cloud sync conflicts when vault is ready ────────────

  useEffect(() => {
    if (!vaultReady || !window.electronAPI) return;

    (async () => {
      try {
        const detected = await conflictsApi.detect();
        if (Array.isArray(detected)) {
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

  const handleSelectNote = useCallback((notePath: string) => {
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

  const noteListContext: NoteListContext = (() => {
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
  })();

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

  if (!vaultReady && window.electronAPI) {
    return <VaultPicker onVaultReady={handleVaultReady} />;
  }

  return (
    <div className="app-layout">
      {/* Toolbar */}
      <header className="toolbar">
        <button
          className="toolbar-btn sidebar-toggle"
          onClick={toggleSidebar}
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
        {/* Sidebar */}
        {!sidebarCollapsed && (
          <Sidebar
            activeView={activeView === 'search' ? 'all-notes' : activeView as SidebarView}
            selectedNotebookName={selectedNotebookName}
            selectedTagName={selectedTagName}
            collapsed={sidebarCollapsed}
            onSelectView={handleSelectView}
            onSelectNotebook={handleSelectNotebook}
            onSelectTag={handleSelectTag}
            onToggleCollapse={toggleSidebar}
            onDataChange={dataChangeKey as any}
          />
        )}

        {/* Note List */}
        <NoteList
          context={noteListContext}
          selectedNotePath={selectedNotePath}
          onSelectNote={handleSelectNote}
          onCreateNote={handleCreateNote}
          refreshKey={refreshKey}
        />

        {/* Editor */}
        <NoteEditor
          notePath={selectedNotePath}
          onNoteSaved={handleNoteSaved}
        />
      </div>

      {/* Status Bar */}
      <footer className="status-bar">
        <span className="status-bar-item">{viewTitle()}</span>
        <OfflineIndicator />
      </footer>

      {/* Settings Panel */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
