import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  notebooks as notebooksApi,
  tags as tagsApi,
  notes as notesApi,
  type NotebookInfo,
  type TagInfo,
} from '../api';

// ── Types ──────────────────────────────────────────────────────────

export type SidebarView = 'all-notes' | 'notebook' | 'tag' | 'trash';

interface SidebarProps {
  activeView: SidebarView;
  selectedNotebookName: string | null;
  selectedTagName: string | null;
  collapsed: boolean;
  onSelectView: (view: SidebarView) => void;
  onSelectNotebook: (notebookName: string) => void;
  onSelectTag: (tagName: string) => void;
  onToggleCollapse: () => void;
  onDataChange?: () => void;
  className?: string;
}

interface StackGroup {
  name: string;
  notebooks: NotebookInfo[];
}

interface ContextMenuState {
  x: number;
  y: number;
  type: 'notebook' | 'stack' | 'tag';
  name: string;
  path?: string;
}

// ── Drag-and-drop types ────────────────────────────────────────────

const DRAG_TYPE_NOTEBOOK = 'application/x-notebook';
const DRAG_TYPE_NOTE = 'application/x-note';

// ── Component ──────────────────────────────────────────────────────

export function Sidebar({
  activeView,
  selectedNotebookName,
  selectedTagName,
  collapsed,
  onSelectView,
  onSelectNotebook,
  onSelectTag,
  onToggleCollapse,
  onDataChange,
  className = '',
}: SidebarProps) {
  const [allNotebooks, setAllNotebooks] = useState<NotebookInfo[]>([]);
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  const [notebooksExpanded, setNotebooksExpanded] = useState(true);
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingItem, setEditingItem] = useState<{ type: string; name: string; path?: string } | null>(null);
  const [dropTargetName, setDropTargetName] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ── Data fetching ──────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [nbs, tgs] = await Promise.all([notebooksApi.list(), tagsApi.list()]);
      setAllNotebooks(nbs);
      setAllTags(tgs);
    } catch (err) {
      console.error('Failed to load sidebar data:', err);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Re-fetch when parent signals data change
  useEffect(() => {
    fetchData();
  }, [onDataChange, fetchData]);

  // ── Organize notebooks into stacks and standalone ──────────────

  const stackGroups: StackGroup[] = [];
  const standaloneNotebooks: NotebookInfo[] = [];
  const stackMap = new Map<string, StackGroup>();

  for (const nb of allNotebooks) {
    if (nb.stack) {
      let group = stackMap.get(nb.stack);
      if (!group) {
        group = { name: nb.stack, notebooks: [] };
        stackMap.set(nb.stack, group);
        stackGroups.push(group);
      }
      group.notebooks.push(nb);
    } else {
      standaloneNotebooks.push(nb);
    }
  }

  // ── Context menu handlers ──────────────────────────────────────

  const handleContextMenu = (e: React.MouseEvent, type: 'notebook' | 'stack' | 'tag', name: string, path?: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type, name, path });
  };

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (contextMenu) {
      const handler = () => closeContextMenu();
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  }, [contextMenu, closeContextMenu]);

  const handleRename = () => {
    if (!contextMenu) return;
    setEditingItem({ type: contextMenu.type, name: contextMenu.name, path: contextMenu.path });
    closeContextMenu();
  };

  const handleIgnore = async () => {
    if (!contextMenu) return;
    const { type, name, path } = contextMenu;
    closeContextMenu();

    const target = type === 'notebook' ? (path ?? name) : name;
    if (!confirm(`Ignore "${name}"? It will be hidden from ThoughtStack but files won't be deleted.`)) return;

    try {
      await notebooksApi.ignore(target);
      fetchData();
      onDataChange?.();
    } catch (err) {
      console.error(`Failed to ignore ${type}:`, err);
    }
  };

  const handleDelete = async () => {
    if (!contextMenu) return;
    const { type, name, path } = contextMenu;
    closeContextMenu();

    if (!confirm(`Delete "${name}"?`)) return;

    try {
      if (type === 'notebook' && path) {
        await notebooksApi.delete(path);
      } else if (type === 'tag') {
        // Tags are derived from frontmatter — renaming to empty effectively removes
        // For now, we don't have a delete tag API; tags disappear when removed from all notes
        console.warn('Tag deletion not directly supported — remove tag from all notes instead');
      }
      fetchData();
    } catch (err) {
      console.error(`Failed to delete ${type}:`, err);
    }
  };

  const commitRename = async (newName: string) => {
    if (!editingItem || !newName.trim()) {
      setEditingItem(null);
      return;
    }
    try {
      if (editingItem.type === 'notebook' && editingItem.path) {
        await notebooksApi.rename(editingItem.path, newName.trim());
      } else if (editingItem.type === 'tag') {
        await tagsApi.rename(editingItem.name, newName.trim());
      }
      fetchData();
    } catch (err) {
      console.error(`Failed to rename ${editingItem.type}:`, err);
    }
    setEditingItem(null);
  };

  useEffect(() => {
    if (editingItem && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingItem]);

  // ── Create notebook ────────────────────────────────────────────

  const handleCreateNotebook = async () => {
    const name = prompt('New notebook name:');
    if (!name?.trim()) return;
    try {
      const nb = await notebooksApi.create(name.trim());
      fetchData();
      onSelectNotebook(nb.path);
    } catch (err) {
      console.error('Failed to create notebook:', err);
    }
  };

  // ── Drag-and-drop handlers ────────────────────────────────────

  const handleNotebookDragStart = (e: React.DragEvent, notebookName: string) => {
    e.dataTransfer.setData(DRAG_TYPE_NOTEBOOK, notebookName);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleNotebookDragOver = (e: React.DragEvent, targetName: string) => {
    if (e.dataTransfer.types.includes(DRAG_TYPE_NOTEBOOK) || e.dataTransfer.types.includes(DRAG_TYPE_NOTE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetName(targetName);
    }
  };

  const handleNotebookDragLeave = () => {
    setDropTargetName(null);
  };

  const handleNotebookDrop = async (e: React.DragEvent, targetNotebookName: string) => {
    e.preventDefault();
    setDropTargetName(null);

    const draggedNotePath = e.dataTransfer.getData(DRAG_TYPE_NOTE);

    if (draggedNotePath) {
      // Note dropped on notebook → move note
      try {
        await notesApi.move(draggedNotePath, targetNotebookName);
        fetchData();
      } catch (err) {
        console.error('Failed to move note via drag:', err);
      }
    }
  };

  const handleStackDragOver = (e: React.DragEvent, stackName: string) => {
    if (e.dataTransfer.types.includes(DRAG_TYPE_NOTEBOOK)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetName(`stack-${stackName}`);
    }
  };

  const handleStackDrop = async (e: React.DragEvent, stackName: string) => {
    e.preventDefault();
    setDropTargetName(null);

    const draggedNotebookName = e.dataTransfer.getData(DRAG_TYPE_NOTEBOOK);
    if (draggedNotebookName) {
      try {
        // Find the notebook's path
        const nb = allNotebooks.find(n => n.name === draggedNotebookName);
        if (nb) {
          await notebooksApi.move(nb.path, stackName);
          fetchData();
        }
      } catch (err) {
        console.error('Failed to move notebook to stack:', err);
      }
    }
  };

  // ── Render helpers ─────────────────────────────────────────────

  const renderEditableLabel = (type: string, name: string, label: string) => {
    if (editingItem && editingItem.type === type && editingItem.name === name) {
      return (
        <input
          ref={editInputRef}
          className="sidebar-edit-input"
          defaultValue={editingItem.name}
          onBlur={(e) => commitRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setEditingItem(null);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      );
    }
    return <span className="sidebar-label">{label}</span>;
  };

  const toggleStack = (stackName: string) => {
    setExpandedStacks(prev => {
      const next = new Set(prev);
      if (next.has(stackName)) next.delete(stackName);
      else next.add(stackName);
      return next;
    });
  };

  if (collapsed && !className) return null;

  return (
    <aside className={`sidebar${className ? ' ' + className : ''}`} role="navigation" aria-label="Sidebar navigation">
      <nav className="sidebar-nav">
        {/* All Notes */}
        <button
          className={`sidebar-item ${activeView === 'all-notes' ? 'sidebar-item--active' : ''}`}
          onClick={() => onSelectView('all-notes')}
        >
          📄 All Notes
        </button>

        {/* Notebooks section */}
        <div className="sidebar-section">
          <button
            className="sidebar-section-header"
            onClick={() => setNotebooksExpanded(!notebooksExpanded)}
          >
            <span className={`sidebar-chevron ${notebooksExpanded ? 'sidebar-chevron--open' : ''}`}>▶</span>
            📓 Notebooks
            <button
              className="sidebar-add-btn"
              onClick={(e) => { e.stopPropagation(); handleCreateNotebook(); }}
              aria-label="Create notebook"
              title="Create notebook"
            >
              +
            </button>
          </button>

          {notebooksExpanded && (
            <div className="sidebar-section-content">
              {/* Stacks */}
              {stackGroups.map(stack => (
                <div
                  key={stack.name}
                  className={`sidebar-stack ${dropTargetName === `stack-${stack.name}` ? 'sidebar-item--drop-target' : ''}`}
                  onDragOver={(e) => handleStackDragOver(e, stack.name)}
                  onDragLeave={handleNotebookDragLeave}
                  onDrop={(e) => handleStackDrop(e, stack.name)}
                >
                  <button
                    className="sidebar-item sidebar-stack-header"
                    onClick={() => toggleStack(stack.name)}
                    onContextMenu={(e) => handleContextMenu(e, 'stack', stack.name)}
                  >
                    <span className={`sidebar-chevron ${expandedStacks.has(stack.name) ? 'sidebar-chevron--open' : ''}`}>▶</span>
                    📚 {renderEditableLabel('stack', stack.name, stack.name)}
                  </button>
                  {expandedStacks.has(stack.name) && stack.notebooks.map(nb => (
                    <button
                      key={nb.path}
                      className={`sidebar-item sidebar-notebook sidebar-notebook--nested ${
                        activeView === 'notebook' && selectedNotebookName === nb.path ? 'sidebar-item--active' : ''
                      } ${dropTargetName === nb.name ? 'sidebar-item--drop-target' : ''}`}
                      onClick={() => onSelectNotebook(nb.path)}
                      onContextMenu={(e) => handleContextMenu(e, 'notebook', nb.name, nb.path)}
                      draggable
                      onDragStart={(e) => handleNotebookDragStart(e, nb.name)}
                      onDragOver={(e) => handleNotebookDragOver(e, nb.name)}
                      onDragLeave={handleNotebookDragLeave}
                      onDrop={(e) => handleNotebookDrop(e, nb.name)}
                    >
                      📓 {renderEditableLabel('notebook', nb.name, nb.name)}
                      <span className="sidebar-count">{nb.noteCount ?? 0}</span>
                    </button>
                  ))}
                </div>
              ))}

              {/* Standalone notebooks */}
              {standaloneNotebooks.map(nb => (
                <button
                  key={nb.path}
                  className={`sidebar-item sidebar-notebook ${
                    activeView === 'notebook' && selectedNotebookName === nb.path ? 'sidebar-item--active' : ''
                  } ${dropTargetName === nb.name ? 'sidebar-item--drop-target' : ''}`}
                  onClick={() => onSelectNotebook(nb.path)}
                  onContextMenu={(e) => handleContextMenu(e, 'notebook', nb.name, nb.path)}
                  draggable
                  onDragStart={(e) => handleNotebookDragStart(e, nb.name)}
                  onDragOver={(e) => handleNotebookDragOver(e, nb.name)}
                  onDragLeave={handleNotebookDragLeave}
                  onDrop={(e) => handleNotebookDrop(e, nb.name)}
                >
                  📓 {renderEditableLabel('notebook', nb.name, nb.name)}
                  <span className="sidebar-count">{nb.noteCount ?? 0}</span>
                </button>
              ))}

              {allNotebooks.length === 0 && (
                <p className="sidebar-empty">No notebooks yet</p>
              )}
            </div>
          )}
        </div>

        {/* Tags section */}
        <div className="sidebar-section">
          <button
            className="sidebar-section-header"
            onClick={() => setTagsExpanded(!tagsExpanded)}
          >
            <span className={`sidebar-chevron ${tagsExpanded ? 'sidebar-chevron--open' : ''}`}>▶</span>
            🏷️ Tags
          </button>

          {tagsExpanded && (
            <div className="sidebar-section-content">
              {allTags.map(tag => (
                <button
                  key={tag.name}
                  className={`sidebar-item sidebar-tag ${
                    activeView === 'tag' && selectedTagName === tag.name ? 'sidebar-item--active' : ''
                  }`}
                  onClick={() => onSelectTag(tag.name)}
                  onContextMenu={(e) => handleContextMenu(e, 'tag', tag.name)}
                >
                  🏷️ {renderEditableLabel('tag', tag.name, tag.name)}
                  <span className="sidebar-count">{tag.noteCount ?? 0}</span>
                </button>
              ))}
              {allTags.length === 0 && (
                <p className="sidebar-empty">No tags yet</p>
              )}
            </div>
          )}
        </div>

        {/* Trash */}
        <button
          className={`sidebar-item ${activeView === 'trash' ? 'sidebar-item--active' : ''}`}
          onClick={() => onSelectView('trash')}
        >
          🗑️ Trash
        </button>
      </nav>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
        >
          <button className="context-menu-item" role="menuitem" onClick={handleRename}>
            ✏️ Rename
          </button>
          {contextMenu.type !== 'tag' && (
            <button className="context-menu-item" role="menuitem" onClick={handleIgnore}>
              🚫 Ignore
            </button>
          )}
          <button className="context-menu-item context-menu-item--danger" role="menuitem" onClick={handleDelete}>
            🗑️ Delete
          </button>
        </div>
      )}
    </aside>
  );
}

export { DRAG_TYPE_NOTE, DRAG_TYPE_NOTEBOOK };
