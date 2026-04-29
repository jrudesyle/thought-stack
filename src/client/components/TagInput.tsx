import React, { useState, useEffect, useRef, useCallback } from 'react';
import { tags as tagsApi, type Tag } from '../api/client';

// ── Types ──────────────────────────────────────────────────────────

interface TagInputProps {
  noteId: string;
  initialTags: Tag[];
}

// ── Component ──────────────────────────────────────────────────────

export function TagInput({ noteId, initialTags }: TagInputProps) {
  const [assignedTags, setAssignedTags] = useState<Tag[]>(initialTags);
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<Tag[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync when initialTags change (note switch)
  useEffect(() => {
    setAssignedTags(initialTags);
  }, [initialTags]);

  // ── Autocomplete ───────────────────────────────────────────────

  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const results = await tagsApi.autocomplete(query);
      // Filter out already-assigned tags
      const assignedIds = new Set(assignedTags.map(t => t.id));
      const filtered = results.filter(t => !assignedIds.has(t.id));
      setSuggestions(filtered);
      setShowSuggestions(true);
      setSelectedIndex(-1);
    } catch (err) {
      console.error('Tag autocomplete failed:', err);
    }
  }, [assignedTags]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 200);
  };

  // ── Add tag ────────────────────────────────────────────────────

  const addTag = async (tagName: string) => {
    const name = tagName.trim();
    if (!name) return;

    // Check if already assigned
    if (assignedTags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      setInputValue('');
      setShowSuggestions(false);
      return;
    }

    try {
      const tag = await tagsApi.addToNote(noteId, name);
      setAssignedTags(prev => [...prev, tag]);
      setInputValue('');
      setShowSuggestions(false);
      setSuggestions([]);
    } catch (err) {
      console.error('Failed to add tag:', err);
    }
  };

  // ── Remove tag ─────────────────────────────────────────────────

  const removeTag = async (tagId: string) => {
    try {
      await tagsApi.removeFromNote(noteId, tagId);
      setAssignedTags(prev => prev.filter(t => t.id !== tagId));
    } catch (err) {
      console.error('Failed to remove tag:', err);
    }
  };

  // ── Keyboard navigation ────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        addTag(suggestions[selectedIndex].name);
      } else if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    } else if (e.key === 'Backspace' && !inputValue && assignedTags.length > 0) {
      // Remove last tag on backspace in empty input
      const lastTag = assignedTags[assignedTags.length - 1];
      removeTag(lastTag.id);
    }
  };

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="tag-input-container">
      <div className="tag-chips">
        {assignedTags.map(tag => (
          <span key={tag.id} className="tag-chip">
            {tag.name}
            <button
              className="tag-chip-remove"
              onClick={() => removeTag(tag.id)}
              aria-label={`Remove tag ${tag.name}`}
              title={`Remove ${tag.name}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="tag-input"
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (inputValue.trim()) fetchSuggestions(inputValue); }}
          placeholder={assignedTags.length === 0 ? 'Add tags…' : ''}
          aria-label="Add tag"
        />
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="tag-suggestions" ref={suggestionsRef} role="listbox">
          {suggestions.map((tag, idx) => (
            <button
              key={tag.id}
              className={`tag-suggestion-item ${idx === selectedIndex ? 'tag-suggestion-item--selected' : ''}`}
              onClick={() => addTag(tag.name)}
              role="option"
              aria-selected={idx === selectedIndex}
            >
              {tag.name}
              {tag.note_count !== undefined && (
                <span className="tag-suggestion-count">({tag.note_count})</span>
              )}
            </button>
          ))}
        </div>
      )}

      {showSuggestions && suggestions.length === 0 && inputValue.trim() && (
        <div className="tag-suggestions" ref={suggestionsRef}>
          <button
            className="tag-suggestion-item tag-suggestion-item--create"
            onClick={() => addTag(inputValue)}
          >
            Create tag "{inputValue.trim()}"
          </button>
        </div>
      )}
    </div>
  );
}
