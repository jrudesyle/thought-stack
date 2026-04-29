import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, type SidebarView } from './components/Sidebar';
import { NoteList, type NoteListContext } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { SearchBar } from './components/SearchBar';
import { SettingsPanel, applyTheme, loadThemePreference } from './components/SettingsPanel';
import { OfflineIndicator } from './components/OfflineIndicator';
import { notebooks as notebooksApi, notes as notesApi, type SearchResult, type Note } from './api/client';

// ── App State ──────────────────────────────────────────────────────

type AppView = 'all-notes' | 'notebook' | 'tag' | 'trash' | 'search';

export function App() {
  const [activeView, setActiveView] = useState<AppView>('all-notes');
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [searchResults, setSearchResults] = useState<Note[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [previousView, setPreviousView] = useState<AppView>('all-notes');
  const [previousNotebookId, setPreviousNotebookId] = useState<string | null>(null);
  const [previousTagId, setPreviousTagId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dataChangeKey, setDataChangeKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Load theme preference on mount ─────────────────────────────

  useEffect(() => {
    loadThemePreference().then(applyTheme);
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
    setSelectedNotebookId(null);
    setSelectedTagId(null);
    setSelectedNoteId(null);
  }, []);

  const handleSelectNotebook = useCallback((notebookId: string) => {
    setActiveView('notebook');
    setSelectedNotebookId(notebookId);
    setSelectedTagId(null);
    setSelectedNoteId(null);
  }, []);

  const handleSelectTag = useCallback((tagId: string) => {
    setActiveView('tag');
    setSelectedTagId(tagId);
    setSelectedNotebookId(null);
    setSelectedNoteId(null);
  }, []);

  const handleSelectNote = useCallback((noteId: string) => {
    setSelectedNoteId(noteId);
  }, []);

  // ── Search ─────────────────────────────────────────────────────

  const handleSearchResults = useCallback((results: SearchResult[], query: string) => {
    // Save current view for restore
    if (activeView !== 'search') {
      setPreviousView(activeView);
      setPreviousNotebookId(selectedNotebookId);
      setPreviousTagId(selectedTagId);
    }

    // Convert SearchResult[] to Note-like objects for NoteList
    const noteResults: Note[] = results.map(r => ({
      id: r.noteId,
      title: r.title,
      content: r.snippet,
      notebook_id: '',
      is_trashed: 0,
      trashed_at: null,
      original_notebook_id: null,
      created_at: r.updatedAt,
      updated_at: r.updatedAt,
      tags: r.tags.map(name => ({ id: name, name, created_at: '' })),
    }));

    setSearchResults(noteResults);
    setSearchQuery(query);
    setActiveView('search');
  }, [activeView, selectedNotebookId, selectedTagId]);

  const handleClearSearch = useCallback(() => {
    setSearchResults([]);
    setSearchQuery('');
    setActiveView(previousView);
    setSelectedNotebookId(previousNotebookId);
    setSelectedTagId(previousTagId);
  }, [previousView, previousNotebookId, previousTagId]);

  // ── Create note ────────────────────────────────────────────────

  const handleCreateNote = useCallback(async () => {
    try {
      let notebookId = selectedNotebookId;

      // If no notebook selected, use first available or create one
      if (!notebookId) {
        const nbs = await notebooksApi.list();
        if (nbs.length > 0) {
          notebookId = nbs[0].id;
        } else {
          const nb = await notebooksApi.create('My Notebook');
          notebookId = nb.id;
          setDataChangeKey(k => k + 1);
        }
      }

      const note = await notesApi.create(notebookId);
      setSelectedNoteId(note.id);
      setRefreshKey(k => k + 1);
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  }, [selectedNotebookId]);

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
        return { type: 'notebook' as const, notebookId: selectedNotebookId! };
      case 'tag':
        return { type: 'tag' as const, tagId: selectedTagId! };
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
      case 'notebook': return 'Notebook';
      case 'tag': return 'Tag';
      case 'trash': return 'Trash';
      case 'search': return `Search: "${searchQuery}"`;
    }
  };

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

      {/* Main content area */}
      <div className="main-content">
        {/* Sidebar */}
        {!sidebarCollapsed && (
          <Sidebar
            activeView={activeView === 'search' ? 'all-notes' : activeView as SidebarView}
            selectedNotebookId={selectedNotebookId}
            selectedTagId={selectedTagId}
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
          selectedNoteId={selectedNoteId}
          onSelectNote={handleSelectNote}
          onCreateNote={handleCreateNote}
          refreshKey={refreshKey}
        />

        {/* Editor */}
        <NoteEditor
          noteId={selectedNoteId}
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
