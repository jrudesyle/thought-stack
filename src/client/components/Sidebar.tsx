import React, { useState, useEffect, useCallback, useRef } from 'react';
import { notebooks as notebooksApi, stacks as stacksApi, tags as tagsApi, notes as notesApi, type Notebook, type Tag } from '../api/client';

// ── Types ──────────────────────────────────────────────────────────

export type SidebarView = 'all-notes' | 'notebook' | 'tag' | 'trash';

interface SidebarProps {
  activeView: SidebarView;
  selectedNotebookId: string | null;
  selectedTagId: string | null;
  collapsed: boolean;
  onSelectView: (view: SidebarView) => void;
  onSelectNotebook: (notebookId: string) => void;
  onSelectTag: (tagId: string) => void;
  onToggleCollapse: () => void;
  onDataChange?: () => void;
}

interface StackGroup {
  id: string;
  name: string;
  notebooks: Notebook[];
}

interface ContextMenuState {
  x: number;
  y: number;
  type: 'notebook' | 'stack' | 'tag';
  id: string;
  name: string;
}

// ── Drag-and-drop types ────────────────────────────────────────────

const DRAG_TYPE_NOTEBOOK = 'application/x-notebook';
const DRAG_TYPE_NOTE = 'application/x-note';

// ── Component ──────────────────────────────────────────────────────

export function Sidebar({
  activeView,
  selectedNotebookId,
  selectedTagId,
  collapsed,
  onSelectView,
  onSelectNotebook,
  onSelectTag,
  onToggleCollapse,
  onDataChange,
}: SidebarProps) {
  const [allNotebooks, setAllNotebooks] = useState<Notebook[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  const [notebooksExpanded, setNotebooksExpanded] = useState(true);
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingItem, setEditingItem] = useState<{ type: string; id: string; name: string } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
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

  // Expose refresh for parent
  useEffect(() => {
    if (onDataChange) {
      // Parent can call this indirectly by changing a key prop
    }
  }, [onDataChange]);

  // Re-fetch when parent signals data change
  useEffect(() => {
    fetchData();
  }, [onDataChange, fetchData]);

  // ── Organize notebooks into stacks and standalone ──────────────

  const stackGroups: StackGroup[] = [];
  const standaloneNotebooks: Notebook[] = [];
  const stackMap = new Map<string, StackGroup>();

  for (const nb of allNotebooks) {
    if (nb.stack_id) {
      let group = stackMap.get(nb.stack_id);
      if (!group) {
        group = { id: nb.stack_id, name: nb.stack_name || 'Stack', notebooks: [] };
        stackMap.set(nb.stack_id, group);
        stackGroups.push(group);
      }
      group.notebooks.push(nb);
    } else {
      standaloneNotebooks.push(nb);
    }
  }

  // ── Context menu handlers ──────────────────────────────────────

  const handleContextMenu = (e: React.MouseEvent, type: 'notebook' | 'stack' | 'tag', id: string, name: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type, id, name });
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
    setEditingItem({ type: contextMenu.type, id: contextMenu.id, name: contextMenu.name });
    closeContextMenu();
  };

  const handleDelete = async () => {
    if (!contextMenu) return;
    const { type, id, name } = contextMenu;
    closeContextMenu();

    if (!confirm(`Delete "${name}"?`)) return;

    try {
      if (type === 'notebook') await notebooksApi.delete(id);
      else if (type === 'stack') await stacksApi.delete(id);
      else if (type === 'tag') await tagsApi.delete(id);
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
      if (editingItem.type === 'notebook') await notebooksApi.update(editingItem.id, { name: newName.trim() });
      else if (editingItem.type === 'stack') await stacksApi.update(editingItem.id, newName.trim());
      else if (editingItem.type === 'tag') await tagsApi.rename(editingItem.id, newName.trim());
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
      onSelectNotebook(nb.id);
    } catch (err) {
      console.error('Failed to create notebook:', err);
    }
  };

  // ── Drag-and-drop handlers ────────────────────────────────────

  const handleNotebookDragStart = (e: React.DragEvent, notebookId: string) => {
    e.dataTransfer.setData(DRAG_TYPE_NOTEBOOK, notebookId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleNotebookDragOver = (e: React.DragEvent, targetId: string) => {
    // Accept notebook or note drops
    if (e.dataTransfer.types.includes(DRAG_TYPE_NOTEBOOK) || e.dataTransfer.types.includes(DRAG_TYPE_NOTE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetId(targetId);
    }
  };

  const handleNotebookDragLeave = () => {
    setDropTargetId(null);
  };

  const handleNotebookDrop = async (e: React.DragEvent, targetNotebookId: string) => {
    e.preventDefault();
    setDropTargetId(null);

    const draggedNotebookId = e.dataTransfer.getData(DRAG_TYPE_NOTEBOOK);
    const draggedNoteId = e.dataTransfer.getData(DRAG_TYPE_NOTE);

    if (draggedNotebookId && draggedNotebookId !== targetNotebookId) {
      // Notebook dropped on notebook → create stack
      try {
        const targetNb = allNotebooks.find(n => n.id === targetNotebookId);
        const draggedNb = allNotebooks.find(n => n.id === draggedNotebookId);
        if (!targetNb || !draggedNb) return;

        if (targetNb.stack_id) {
          // Target is already in a stack → move dragged notebook into that stack
          await notebooksApi.update(draggedNotebookId, { stackId: targetNb.stack_id });
        } else {
          // Neither in a stack → create new stack
          const stackName = `${targetNb.name} & ${draggedNb.name}`;
          const stack = await stacksApi.create(stackName);
          await notebooksApi.update(targetNotebookId, { stackId: stack.id });
          await notebooksApi.update(draggedNotebookId, { stackId: stack.id });
        }
        fetchData();
      } catch (err) {
        console.error('Failed to create stack via drag:', err);
      }
    }

    if (draggedNoteId) {
      // Note dropped on notebook → move note
      try {
        await notesApi.move(draggedNoteId, targetNotebookId);
        fetchData();
      } catch (err) {
        console.error('Failed to move note via drag:', err);
      }
    }
  };

  const handleStackDragOver = (e: React.DragEvent, stackId: string) => {
    if (e.dataTransfer.types.includes(DRAG_TYPE_NOTEBOOK)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetId(`stack-${stackId}`);
    }
  };

  const handleStackDrop = async (e: React.DragEvent, stackId: string) => {
    e.preventDefault();
    setDropTargetId(null);

    const draggedNotebookId = e.dataTransfer.getData(DRAG_TYPE_NOTEBOOK);
    if (draggedNotebookId) {
      try {
        await notebooksApi.update(draggedNotebookId, { stackId });
        fetchData();
      } catch (err) {
        console.error('Failed to move notebook to stack:', err);
      }
    }
  };

  // ── Render helpers ─────────────────────────────────────────────

  const renderEditableLabel = (type: string, id: string, label: string) => {
    if (editingItem && editingItem.type === type && editingItem.id === id) {
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

  const toggleStack = (stackId: string) => {
    setExpandedStacks(prev => {
      const next = new Set(prev);
      if (next.has(stackId)) next.delete(stackId);
      else next.add(stackId);
      return next;
    });
  };

  if (collapsed) return null;

  return (
    <aside className="sidebar" role="navigation" aria-label="Sidebar navigation">
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
                  key={stack.id}
                  className={`sidebar-stack ${dropTargetId === `stack-${stack.id}` ? 'sidebar-item--drop-target' : ''}`}
                  onDragOver={(e) => handleStackDragOver(e, stack.id)}
                  onDragLeave={handleNotebookDragLeave}
                  onDrop={(e) => handleStackDrop(e, stack.id)}
                >
                  <button
                    className="sidebar-item sidebar-stack-header"
                    onClick={() => toggleStack(stack.id)}
                    onContextMenu={(e) => handleContextMenu(e, 'stack', stack.id, stack.name)}
                  >
                    <span className={`sidebar-chevron ${expandedStacks.has(stack.id) ? 'sidebar-chevron--open' : ''}`}>▶</span>
                    📚 {renderEditableLabel('stack', stack.id, stack.name)}
                  </button>
                  {expandedStacks.has(stack.id) && stack.notebooks.map(nb => (
                    <button
                      key={nb.id}
                      className={`sidebar-item sidebar-notebook sidebar-notebook--nested ${
                        activeView === 'notebook' && selectedNotebookId === nb.id ? 'sidebar-item--active' : ''
                      } ${dropTargetId === nb.id ? 'sidebar-item--drop-target' : ''}`}
                      onClick={() => onSelectNotebook(nb.id)}
                      onContextMenu={(e) => handleContextMenu(e, 'notebook', nb.id, nb.name)}
                      draggable
                      onDragStart={(e) => handleNotebookDragStart(e, nb.id)}
                      onDragOver={(e) => handleNotebookDragOver(e, nb.id)}
                      onDragLeave={handleNotebookDragLeave}
                      onDrop={(e) => handleNotebookDrop(e, nb.id)}
                    >
                      📓 {renderEditableLabel('notebook', nb.id, nb.name)}
                      <span className="sidebar-count">{nb.note_count ?? 0}</span>
                    </button>
                  ))}
                </div>
              ))}

              {/* Standalone notebooks */}
              {standaloneNotebooks.map(nb => (
                <button
                  key={nb.id}
                  className={`sidebar-item sidebar-notebook ${
                    activeView === 'notebook' && selectedNotebookId === nb.id ? 'sidebar-item--active' : ''
                  } ${dropTargetId === nb.id ? 'sidebar-item--drop-target' : ''}`}
                  onClick={() => onSelectNotebook(nb.id)}
                  onContextMenu={(e) => handleContextMenu(e, 'notebook', nb.id, nb.name)}
                  draggable
                  onDragStart={(e) => handleNotebookDragStart(e, nb.id)}
                  onDragOver={(e) => handleNotebookDragOver(e, nb.id)}
                  onDragLeave={handleNotebookDragLeave}
                  onDrop={(e) => handleNotebookDrop(e, nb.id)}
                >
                  📓 {renderEditableLabel('notebook', nb.id, nb.name)}
                  <span className="sidebar-count">{nb.note_count ?? 0}</span>
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
                  key={tag.id}
                  className={`sidebar-item sidebar-tag ${
                    activeView === 'tag' && selectedTagId === tag.id ? 'sidebar-item--active' : ''
                  }`}
                  onClick={() => onSelectTag(tag.id)}
                  onContextMenu={(e) => handleContextMenu(e, 'tag', tag.id, tag.name)}
                >
                  🏷️ {renderEditableLabel('tag', tag.id, tag.name)}
                  <span className="sidebar-count">{tag.note_count ?? 0}</span>
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
          <button className="context-menu-item context-menu-item--danger" role="menuitem" onClick={handleDelete}>
            🗑️ Delete
          </button>
        </div>
      )}
    </aside>
  );
}

export { DRAG_TYPE_NOTE, DRAG_TYPE_NOTEBOOK };
