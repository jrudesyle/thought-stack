import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  search as searchApi,
  notebooks as notebooksApi,
  tags as tagsApi,
  type SearchResult,
  type NotebookInfo,
  type TagInfo,
} from '../api';

// ── Types ──────────────────────────────────────────────────────────

interface SearchBarProps {
  onSearchResults: (results: SearchResult[], query: string) => void;
  onClearSearch: () => void;
  isSearchActive: boolean;
}

// ── Component ──────────────────────────────────────────────────────

export function SearchBar({ onSearchResults, onClearSearch, isSearchActive }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [filterNotebook, setFilterNotebook] = useState<string>('');
  const [filterTag, setFilterTag] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  const [allNotebooks, setAllNotebooks] = useState<NotebookInfo[]>([]);
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load filter options
  useEffect(() => {
    (async () => {
      try {
        const [nbs, tgs] = await Promise.all([notebooksApi.list(), tagsApi.list()]);
        setAllNotebooks(nbs);
        setAllTags(tgs);
      } catch (err) {
        console.error('Failed to load search filters:', err);
      }
    })();
  }, []);

  // ── Search with debounce ───────────────────────────────────────

  const performSearch = useCallback(async (q: string, nb: string, tg: string) => {
    if (!q.trim()) {
      setResults([]);
      setShowResults(false);
      setNoResults(false);
      return;
    }

    try {
      const filters: { notebook?: string; tag?: string } = {};
      if (nb) filters.notebook = nb;
      if (tg) filters.tag = tg;

      // search.query returns SearchResult[] directly (no wrapper)
      const searchResults = await searchApi.query(q, filters);
      setResults(searchResults);
      setNoResults(searchResults.length === 0);
      setShowResults(true);
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
      setNoResults(true);
      setShowResults(true);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!val.trim()) {
      setResults([]);
      setShowResults(false);
      setNoResults(false);
      if (isSearchActive) onClearSearch();
      return;
    }

    debounceRef.current = setTimeout(() => {
      performSearch(val, filterNotebook, filterTag);
    }, 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && query.trim()) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      performSearch(query, filterNotebook, filterTag);
      onSearchResults(results, query);
      setShowResults(false);
    }
    if (e.key === 'Escape') {
      handleClear();
    }
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setShowResults(false);
    setNoResults(false);
    setFilterNotebook('');
    setFilterTag('');
    if (isSearchActive) onClearSearch();
  };

  const handleResultClick = (_result: SearchResult) => {
    onSearchResults(results, query);
    setShowResults(false);
  };

  // Apply filter changes
  useEffect(() => {
    if (query.trim()) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        performSearch(query, filterNotebook, filterTag);
      }, 300);
    }
  }, [filterNotebook, filterTag]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
        setShowFilters(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="search-bar" ref={containerRef}>
      <div className="search-bar-input-row">
        <input
          className="search-bar-input"
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setShowResults(true); }}
          placeholder="Search notes…"
          aria-label="Search notes"
        />
        {query && (
          <button className="search-bar-clear" onClick={handleClear} aria-label="Clear search" title="Clear search">
            ✕
          </button>
        )}
        <button
          className={`search-bar-filter-btn ${showFilters ? 'search-bar-filter-btn--active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
          aria-label="Search filters"
          title="Filters"
        >
          ⚙
        </button>
      </div>

      {/* Filter dropdowns */}
      {showFilters && (
        <div className="search-filters">
          <select
            className="search-filter-select"
            value={filterNotebook}
            onChange={(e) => setFilterNotebook(e.target.value)}
            aria-label="Filter by notebook"
          >
            <option value="">All notebooks</option>
            {allNotebooks.map(nb => (
              <option key={nb.path} value={nb.name}>{nb.name}</option>
            ))}
          </select>
          <select
            className="search-filter-select"
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            aria-label="Filter by tag"
          >
            <option value="">All tags</option>
            {allTags.map(tag => (
              <option key={tag.name} value={tag.name}>{tag.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Results dropdown */}
      {showResults && (
        <div className="search-results-dropdown" role="listbox">
          {noResults && (
            <div className="search-no-results">No notes found</div>
          )}
          {results.map(result => (
            <button
              key={result.noteId}
              className="search-result-item"
              onClick={() => handleResultClick(result)}
              role="option"
            >
              <div className="search-result-title">{result.title || 'Untitled'}</div>
              <div
                className="search-result-snippet"
                dangerouslySetInnerHTML={{ __html: result.snippet }}
              />
              <div className="search-result-meta">
                <span>{result.notebook}</span>
                {result.tags.length > 0 && (
                  <span className="search-result-tags">{result.tags.join(', ')}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
