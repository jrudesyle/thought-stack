import React, { useState, useEffect, useCallback } from 'react';
import { system, type AppSettings } from '../api';
import { loadAIConfig, saveAIConfig, clearAIConfig, type AIProvider } from '../api/ai-client';

// ── Theme helpers ──────────────────────────────────────────────────

export type ThemePreference = 'system' | 'light' | 'dark' | 'evernote' | 'ocean' | 'warm-paper' | 'night-owl' | 'notion' | 'sunset';

/**
 * Apply a theme to the document. When 'system' is selected, remove the
 * data-theme attribute so the CSS `prefers-color-scheme` media query
 * takes effect.
 */
export function applyTheme(preference: ThemePreference): void {
  if (preference === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', preference);
  }}

/**
 * Load the persisted theme preference from the Electron settings API.
 * Falls back to 'system' if no preference is stored.
 */
export async function loadThemePreference(): Promise<ThemePreference> {
  const valid = (t: unknown): t is ThemePreference =>
    t === 'light' || t === 'dark' || t === 'system' || t === 'evernote' ||
    t === 'ocean' || t === 'warm-paper' || t === 'night-owl' || t === 'notion' || t === 'sunset';
  try {
    const settings = await system.getSettings();
    if (valid(settings.theme)) return settings.theme as ThemePreference;
  } catch {
    // Electron API not available — fall through to localStorage
  }
  try {
    const stored = localStorage.getItem('theme-preference');
    if (valid(stored)) return stored;
  } catch {}
  return 'system';
}

/**
 * Persist theme preference (Electron settings API + localStorage fallback).
 */
export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  try {
    await system.updateSettings({ theme: preference });
  } catch {
    // Silently fail in PWA mode
  }
  try {
    localStorage.setItem('theme-preference', preference);
  } catch {}
}

// ── SettingsPanel Component ────────────────────────────────────────

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [vaultPath, setVaultPath] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // AI settings
  const [aiProvider, setAiProvider] = useState<AIProvider>('openai');
  const [aiKey, setAiKey] = useState('');
  const [aiKeySaved, setAiKeySaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // Load current settings when panel opens
  useEffect(() => {
    if (!open) return;

    loadThemePreference().then(setTheme);

    const cfg = loadAIConfig();
    if (cfg) { setAiProvider(cfg.provider); setAiKey(cfg.apiKey); setAiKeySaved(true); }

    // Load vault path
    (async () => {
      try {
        const path = await system.getVaultPath();
        setVaultPath(path);
      } catch {
        setVaultPath('');
      }
    })();
  }, [open]);

  const handleSaveAI = () => {
    if (!aiKey.trim()) { clearAIConfig(); setAiKeySaved(false); return; }
    saveAIConfig({ provider: aiProvider, apiKey: aiKey.trim() });
    setAiKeySaved(true);
  };

  // ── Theme selection ──────────────────────────────────────────────

  const handleThemeChange = useCallback(async (newTheme: ThemePreference) => {
    setTheme(newTheme);
    applyTheme(newTheme);
    await saveThemePreference(newTheme);
  }, []);

  // ── Vault path change ────────────────────────────────────────────

  const handleChangeVault = useCallback(async () => {
    try {
      setStatusMessage(null);
      const path = await system.pickVaultFolder();
      if (!path) return; // User cancelled

      const result = await system.setVaultPath(path);
      if (result.success) {
        setVaultPath(path);
        setStatusMessage({ text: 'Vault changed. Reload the app to apply.', type: 'success' });
      } else {
        setStatusMessage({ text: 'Failed to set vault path.', type: 'error' });
      }
    } catch {
      setStatusMessage({ text: 'Failed to change vault.', type: 'error' });
    }
  }, []);

  // ── Export ───────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    try {
      setStatusMessage(null);
      const result = await system.exportVault() as { success?: boolean; canceled?: boolean; error?: string; path?: string };
      if (result.canceled) {
        // User cancelled the save dialog — no message needed
        return;
      }
      if (result.error) {
        setStatusMessage({ text: `Export failed: ${result.error}`, type: 'error' });
        return;
      }
      setStatusMessage({ text: 'Vault exported successfully', type: 'success' });
    } catch {
      setStatusMessage({ text: 'Export failed', type: 'error' });
    }
  }, []);

  // ── Import ───────────────────────────────────────────────────────

  const handleImportClick = useCallback(async () => {
    try {
      setStatusMessage(null);
      const result = await system.importData(null) as {
        success?: boolean;
        canceled?: boolean;
        notebooks?: number;
        notes?: number;
        images?: number;
        errors?: string[];
      };
      if (result.canceled) {
        // User cancelled the open dialog — no message needed
        return;
      }
      if (result.success) {
        setStatusMessage({
          text: `Import completed: ${result.notebooks ?? 0} notebooks, ${result.notes ?? 0} notes, ${result.images ?? 0} images`,
          type: 'success',
        });
      } else {
        const errorCount = result.errors?.length ?? 0;
        setStatusMessage({
          text: `Import completed with ${errorCount} error(s)`,
          type: 'error',
        });
      }
    } catch {
      setStatusMessage({ text: 'Import failed', type: 'error' });
    }
  }, []);

  // ── Close on Escape ──────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings-panel" role="dialog" aria-label="Settings">
        {/* Header */}
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        {/* Body */}
        <div className="settings-body">
          {/* Vault Section */}
          <div className="settings-section">
            <h3>Vault</h3>
            <div className="settings-vault-info">
              <span className="settings-vault-path" title={vaultPath}>
                {vaultPath || 'No vault configured'}
              </span>
              <button className="settings-btn" onClick={handleChangeVault}>
                Change Vault
              </button>
            </div>
          </div>

          {/* Theme Section */}
          <div className="settings-section">
            <h3>Theme</h3>
            <div className="settings-theme-options">
              {([
                ['system',     '🖥',  'System'],
                ['light',      '☀',   'Light'],
                ['dark',       '🌙',  'Dark'],
                ['evernote',   '🐘',  'Evernote'],
                ['ocean',      '🌊',  'Ocean'],
                ['warm-paper', '📜',  'Warm Paper'],
                ['night-owl',  '🦉',  'Night Owl'],
                ['notion',     '◻',   'Notion'],
                ['sunset',     '🌅',  'Sunset'],
              ] as [ThemePreference, string, string][]).map(([t, icon, label]) => (
                <button
                  key={t}
                  className={`settings-theme-btn ${theme === t ? 'settings-theme-btn--active' : ''}`}
                  onClick={() => handleThemeChange(t)}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          </div>

          {/* AI Section */}
          <div className="settings-section">
            <h3>✨ AI Assistant</h3>
            <div className="settings-ai">
              <label className="settings-label">Provider</label>
              <div className="settings-ai-provider">
                {(['openai', 'anthropic'] as AIProvider[]).map(p => (
                  <button
                    key={p}
                    className={`settings-theme-btn ${aiProvider === p ? 'settings-theme-btn--active' : ''}`}
                    onClick={() => { setAiProvider(p); setAiKeySaved(false); }}
                  >
                    {p === 'openai' ? '🤖 OpenAI' : '🧠 Anthropic'}
                  </button>
                ))}
              </div>
              <label className="settings-label" style={{ marginTop: 10 }}>
                {aiProvider === 'openai' ? 'OpenAI API Key' : 'Anthropic API Key'}
              </label>
              <div className="settings-ai-key-row">
                <input
                  type={showKey ? 'text' : 'password'}
                  className="settings-ai-key-input"
                  value={aiKey}
                  onChange={e => { setAiKey(e.target.value); setAiKeySaved(false); }}
                  placeholder={aiProvider === 'openai' ? 'sk-...' : 'sk-ant-...'}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="settings-btn" onClick={() => setShowKey(s => !s)} style={{ flexShrink: 0 }}>
                  {showKey ? '🙈' : '👁'}
                </button>
              </div>
              <div className="settings-ai-actions">
                <button className="settings-btn settings-btn--primary" onClick={handleSaveAI}>
                  {aiKeySaved ? '✓ Saved' : 'Save Key'}
                </button>
                {aiKeySaved && (
                  <button className="settings-btn" onClick={() => { clearAIConfig(); setAiKey(''); setAiKeySaved(false); }}>
                    Remove
                  </button>
                )}
              </div>
              <p className="settings-hint">Your key is stored locally only — never sent anywhere except the AI provider.</p>
            </div>
          </div>

          {/* Export / Import Section */}
          <div className="settings-section">
            <h3>Data</h3>
            <div className="settings-export-import">
              <button className="settings-btn settings-btn--primary" onClick={handleExport}>
                Export Data
              </button>
              <button className="settings-btn" onClick={handleImportClick}>
                Import Data
              </button>
            </div>
            {statusMessage && (
              <div className={`settings-status settings-status--${statusMessage.type}`}>
                {statusMessage.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
