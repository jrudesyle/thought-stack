import React, { useState, useEffect, useRef, useCallback } from 'react';
import { tags as tagsApi, type TagInfo } from '../api';

// ── Types ──────────────────────────────────────────────────────────

interface TagInputProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
}

// ── Component ──────────────────────────────────────────────────────

export function TagInput({ tags, onTagsChange }: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<TagInfo[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const assignedSet = new Set(tags.map(t => t.toLowerCase()));
      const filtered = results.filter(t => !assignedSet.has(t.name.toLowerCase()));
      setSuggestions(filtered);
      setShowSuggestions(true);
      setSelectedIndex(-1);
    } catch (err) {
      console.error('Tag autocomplete failed:', err);
    }
  }, [tags]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 200);
  };

  // ── Add tag ────────────────────────────────────────────────────

  const addTag = (tagName: string) => {
    const name = tagName.trim();
    if (!name) return;

    // Check if already assigned
    if (tags.some(t => t.toLowerCase() === name.toLowerCase())) {
      setInputValue('');
      setShowSuggestions(false);
      return;
    }

    // Update tags locally — parent (NoteEditor) includes tags in the save call
    onTagsChange([...tags, name]);
    setInputValue('');
    setShowSuggestions(false);
    setSuggestions([]);
  };

  // ── Remove tag ─────────────────────────────────────────────────

  const removeTag = (tagName: string) => {
    onTagsChange(tags.filter(t => t !== tagName));
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
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      // Remove last tag on backspace in empty input
      const lastTag = tags[tags.length - 1];
      removeTag(lastTag);
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
        {tags.map(tag => (
          <span key={tag} className="tag-chip">
            {tag}
            <button
              className="tag-chip-remove"
              onClick={() => removeTag(tag)}
              aria-label={`Remove tag ${tag}`}
              title={`Remove ${tag}`}
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
          placeholder={tags.length === 0 ? 'Add tags…' : ''}
          aria-label="Add tag"
        />
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="tag-suggestions" ref={suggestionsRef} role="listbox">
          {suggestions.map((tag, idx) => (
            <button
              key={tag.name}
              className={`tag-suggestion-item ${idx === selectedIndex ? 'tag-suggestion-item--selected' : ''}`}
              onClick={() => addTag(tag.name)}
              role="option"
              aria-selected={idx === selectedIndex}
            >
              {tag.name}
              {tag.noteCount !== undefined && (
                <span className="tag-suggestion-count">({tag.noteCount})</span>
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
