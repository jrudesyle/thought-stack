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
  const [aiEndpointUrl, setAiEndpointUrl] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [testStatus, setTestStatus] = useState<{ text: string; type: 'success' | 'error' | 'testing' } | null>(null);

  // Load current settings when panel opens
  useEffect(() => {
    if (!open) return;

    loadThemePreference().then(setTheme);

    const cfg = loadAIConfig();
    if (cfg) {
      setAiProvider(cfg.provider);
      setAiKey(cfg.apiKey);
      setAiEndpointUrl(cfg.endpointUrl ?? '');
      setAiModel(cfg.model ?? '');
      setAiKeySaved(true);
    }

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
    if (aiProvider === 'openclaw') {
      if (!aiEndpointUrl.trim()) { clearAIConfig(); setAiKeySaved(false); return; }
      saveAIConfig({ provider: 'openclaw', apiKey: aiKey.trim(), endpointUrl: aiEndpointUrl.trim(), model: aiModel.trim() || undefined });
    } else {
      if (!aiKey.trim()) { clearAIConfig(); setAiKeySaved(false); return; }
      saveAIConfig({ provider: aiProvider, apiKey: aiKey.trim() });
    }
    setAiKeySaved(true);
    setTestStatus(null);
  };

  const handleTestConnection = async () => {
    const url = aiEndpointUrl.trim();
    if (!url) { setTestStatus({ text: 'Enter an endpoint URL first.', type: 'error' }); return; }
    setTestStatus({ text: 'Testing…', type: 'testing' });

    const base = url.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (aiKey.trim()) headers['Authorization'] = `Bearer ${aiKey.trim()}`;

    // Try GET /models first (lightweight), fall back to a minimal chat completion
    try {
      const modelsRes = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(6000) });
      if (modelsRes.ok) {
        const data = await modelsRes.json().catch(() => ({}));
        const count = (data as any)?.data?.length;
        setTestStatus({ text: `✓ Connected${count ? ` — ${count} model(s) available` : ''}`, type: 'success' });
        return;
      }
    } catch {}

    // Fall back to minimal chat completion
    try {
      const chatRes = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: aiModel.trim() || 'manifest/auto',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (chatRes.ok) {
        setTestStatus({ text: '✓ Connected — endpoint is reachable', type: 'success' });
      } else {
        const err = await chatRes.json().catch(() => ({}));
        const msg = (err as any)?.error?.message ?? `HTTP ${chatRes.status}`;
        setTestStatus({ text: `✗ ${msg}`, type: 'error' });
      }
    } catch (e: any) {
      const isBlocked = e?.message?.includes('Failed to fetch') || e?.name === 'TypeError';
      setTestStatus({
        text: isBlocked
          ? '✗ Blocked — browser cannot reach HTTP from HTTPS. See hint below.'
          : `✗ ${e?.message ?? 'Connection failed'}`,
        type: 'error',
      });
    }
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
                {(['openai', 'anthropic', 'openclaw'] as AIProvider[]).map(p => (
                  <button
                    key={p}
                    className={`settings-theme-btn ${aiProvider === p ? 'settings-theme-btn--active' : ''}`}
                    onClick={() => { setAiProvider(p); setAiKeySaved(false); }}
                  >
                    {p === 'openai' ? '🤖 OpenAI' : p === 'anthropic' ? '🧠 Anthropic' : '🦞 OpenClaw'}
                  </button>
                ))}
              </div>

              {aiProvider === 'openclaw' ? (
                <>
                  <label className="settings-label" style={{ marginTop: 10 }}>Endpoint URL</label>
                  <input
                    type="text"
                    className="settings-ai-key-input"
                    value={aiEndpointUrl}
                    onChange={e => { setAiEndpointUrl(e.target.value); setAiKeySaved(false); }}
                    placeholder="http://192.168.1.x:11434/v1"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <label className="settings-label" style={{ marginTop: 10 }}>Model Name</label>
                  <input
                    type="text"
                    className="settings-ai-key-input"
                    value={aiModel}
                    onChange={e => { setAiModel(e.target.value); setAiKeySaved(false); }}
                    placeholder="llama3, mistral, phi3, …"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <label className="settings-label" style={{ marginTop: 10 }}>API Key (optional)</label>
                  <div className="settings-ai-key-row">
                    <input
                      type={showKey ? 'text' : 'password'}
                      className="settings-ai-key-input"
                      value={aiKey}
                      onChange={e => { setAiKey(e.target.value); setAiKeySaved(false); }}
                      placeholder="Leave blank if no auth required"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button className="settings-btn" onClick={() => setShowKey(s => !s)} style={{ flexShrink: 0 }}>
                      {showKey ? '🙈' : '👁'}
                    </button>
                  </div>
                </>
              ) : (
                <>
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
                </>
              )}
              <div className="settings-ai-actions">
                <button className="settings-btn settings-btn--primary" onClick={handleSaveAI}>
                  {aiKeySaved ? '✓ Saved' : 'Save Key'}
                </button>
                {aiProvider === 'openclaw' && (
                  <button
                    className="settings-btn"
                    onClick={handleTestConnection}
                    disabled={testStatus?.type === 'testing'}
                  >
                    {testStatus?.type === 'testing' ? '⏳ Testing…' : '🔌 Test Connection'}
                  </button>
                )}
                {aiKeySaved && (
                  <button className="settings-btn" onClick={() => { clearAIConfig(); setAiKey(''); setAiEndpointUrl(''); setAiModel(''); setAiKeySaved(false); setTestStatus(null); }}>
                    Remove
                  </button>
                )}
              </div>
              {testStatus && testStatus.type !== 'testing' && (
                <div className={`settings-status settings-status--${testStatus.type === 'success' ? 'success' : 'error'}`} style={{ marginTop: 8 }}>
                  {testStatus.text}
                  {testStatus.type === 'error' && testStatus.text.includes('HTTPS') && (
                    <p style={{ marginTop: 4, fontSize: '0.78rem', opacity: 0.85 }}>
                      Fix: open <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>, add your gateway URL, relaunch Chrome.
                    </p>
                  )}
                </div>
              )}
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
