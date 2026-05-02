import React, { useState, useEffect, useRef, useCallback } from 'react';
import { tags as tagsApi, type TagInfo } from '../api';

// ── Types ──────────────────────────────────────────────────────────

interface TagInputProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  inline?: boolean; // compact inline mode (popover)
}

// ── Component ──────────────────────────────────────────────────────

export function TagInput({ tags, onTagsChange, inline }: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<TagInfo[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Autocomplete ───────────────────────────────────────────────

  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query.trim()) { setSuggestions([]); setShowSuggestions(false); return; }
    try {
      const results = await tagsApi.autocomplete(query);
      const assignedSet = new Set(tags.map(t => t.toLowerCase()));
      setSuggestions(results.filter(t => !assignedSet.has(t.name.toLowerCase())));
      setShowSuggestions(true);
      setSelectedIndex(-1);
    } catch {}
  }, [tags]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 200);
  };

  // ── Add / Remove ───────────────────────────────────────────────

  const addTag = (tagName: string) => {
    const name = tagName.trim();
    if (!name || tags.some(t => t.toLowerCase() === name.toLowerCase())) {
      setInputValue(''); setShowSuggestions(false); return;
    }
    onTagsChange([...tags, name]);
    setInputValue(''); setShowSuggestions(false); setSuggestions([]);
  };

  const removeTag = (tagName: string) => onTagsChange(tags.filter(t => t !== tagName));

  // ── Keyboard navigation ────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      selectedIndex >= 0 && selectedIndex < suggestions.length
        ? addTag(suggestions[selectedIndex].name)
        : inputValue.trim() && addTag(inputValue);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault(); setSelectedIndex(p => Math.min(p + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setSelectedIndex(p => Math.max(p - 1, -1));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false); if (inline) setPopoverOpen(false);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus input when popover opens
  useEffect(() => {
    if (popoverOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [popoverOpen]);

  // ── Inline (compact) mode ──────────────────────────────────────

  if (inline) {
    return (
      <div className="tag-inline-container" ref={containerRef}>
        <button
          className="tag-inline-trigger"
          onClick={() => setPopoverOpen(o => !o)}
          title="Edit tags"
          type="button"
        >
          🏷 {tags.length > 0 ? tags.join(', ') : 'Add tags'}
        </button>

        {popoverOpen && (
          <div className="tag-popover">
            <div className="tag-chips">
              {tags.map(tag => (
                <span key={tag} className="tag-chip">
                  {tag}
                  <button className="tag-chip-remove" onClick={() => removeTag(tag)} type="button">×</button>
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
                placeholder="Add tag…"
                aria-label="Add tag"
              />
            </div>

            {showSuggestions && suggestions.length > 0 && (
              <div className="tag-suggestions" role="listbox">
                {suggestions.map((tag, idx) => (
                  <button
                    key={tag.name}
                    className={`tag-suggestion-item ${idx === selectedIndex ? 'tag-suggestion-item--selected' : ''}`}
                    onClick={() => addTag(tag.name)}
                    type="button"
                  >
                    {tag.name}
                    {tag.noteCount !== undefined && <span className="tag-suggestion-count">({tag.noteCount})</span>}
                  </button>
                ))}
              </div>
            )}
            {showSuggestions && suggestions.length === 0 && inputValue.trim() && (
              <div className="tag-suggestions">
                <button className="tag-suggestion-item tag-suggestion-item--create" onClick={() => addTag(inputValue)} type="button">
                  Create "{inputValue.trim()}"
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Full mode (legacy) ─────────────────────────────────────────

  return (
    <div className="tag-input-container" ref={containerRef}>
      <div className="tag-chips">
        {tags.map(tag => (
          <span key={tag} className="tag-chip">
            {tag}
            <button className="tag-chip-remove" onClick={() => removeTag(tag)} type="button">×</button>
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
        <div className="tag-suggestions" role="listbox">
          {suggestions.map((tag, idx) => (
            <button key={tag.name} className={`tag-suggestion-item ${idx === selectedIndex ? 'tag-suggestion-item--selected' : ''}`} onClick={() => addTag(tag.name)} type="button">
              {tag.name} {tag.noteCount !== undefined && <span className="tag-suggestion-count">({tag.noteCount})</span>}
            </button>
          ))}
        </div>
      )}
      {showSuggestions && suggestions.length === 0 && inputValue.trim() && (
        <div className="tag-suggestions">
          <button className="tag-suggestion-item tag-suggestion-item--create" onClick={() => addTag(inputValue)} type="button">
            Create tag "{inputValue.trim()}"
          </button>
        </div>
      )}
    </div>
  );
}
