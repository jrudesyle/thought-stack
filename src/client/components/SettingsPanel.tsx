import React, { useState, useEffect, useCallback, useRef } from 'react';
import { system, plugins as pluginsApi, type Plugin, type ExportData } from '../api/client';

// ── Theme helpers ──────────────────────────────────────────────────

export type ThemePreference = 'system' | 'light' | 'dark';

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
  }
}

/**
 * Load the persisted theme preference from the server settings API.
 * Falls back to 'system' if no preference is stored.
 */
export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const settings = await system.getSettings();
    const theme = settings.theme as ThemePreference | undefined;
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      return theme;
    }
  } catch {
    // Server may not be available — fall back to system
  }
  return 'system';
}

/**
 * Persist theme preference to the server settings API.
 */
export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  try {
    await system.updateSettings({ theme: preference });
  } catch {
    // Silently fail — theme is already applied in the UI
  }
}

// ── SettingsPanel Component ────────────────────────────────────────

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [pluginList, setPluginList] = useState<Plugin[]>([]);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load current settings when panel opens
  useEffect(() => {
    if (!open) return;

    loadThemePreference().then(setTheme);
    pluginsApi.list().then(setPluginList).catch(() => setPluginList([]));
  }, [open]);

  // ── Theme selection ──────────────────────────────────────────────

  const handleThemeChange = useCallback(async (newTheme: ThemePreference) => {
    setTheme(newTheme);
    applyTheme(newTheme);
    await saveThemePreference(newTheme);
  }, []);

  // ── Plugin toggle ────────────────────────────────────────────────

  const handlePluginToggle = useCallback(async (pluginName: string, currentlyEnabled: boolean) => {
    try {
      if (currentlyEnabled) {
        await pluginsApi.disable(pluginName);
      } else {
        await pluginsApi.enable(pluginName);
      }
      // Refresh plugin list
      const updated = await pluginsApi.list();
      setPluginList(updated);
    } catch {
      setStatusMessage({ text: `Failed to toggle plugin "${pluginName}"`, type: 'error' });
    }
  }, []);

  // ── Export ───────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    try {
      setStatusMessage(null);
      const data = await system.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `notes-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMessage({ text: 'Export downloaded successfully', type: 'success' });
    } catch {
      setStatusMessage({ text: 'Export failed', type: 'error' });
    }
  }, []);

  // ── Import ───────────────────────────────────────────────────────

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setStatusMessage(null);
      const text = await file.text();
      const data = JSON.parse(text) as ExportData;
      const result = await system.importData(data);
      if (result.errors && result.errors.length > 0) {
        setStatusMessage({
          text: `Imported ${result.imported.total} items with ${result.errors.length} errors`,
          type: 'error',
        });
      } else {
        setStatusMessage({
          text: `Successfully imported ${result.imported.total} items`,
          type: 'success',
        });
      }
    } catch {
      setStatusMessage({ text: 'Import failed — invalid file format', type: 'error' });
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
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
          {/* Theme Section */}
          <div className="settings-section">
            <h3>Theme</h3>
            <div className="settings-theme-options">
              {(['system', 'light', 'dark'] as ThemePreference[]).map((t) => (
                <button
                  key={t}
                  className={`settings-theme-btn ${theme === t ? 'settings-theme-btn--active' : ''}`}
                  onClick={() => handleThemeChange(t)}
                >
                  {t === 'system' ? '🖥 System' : t === 'light' ? '☀ Light' : '🌙 Dark'}
                </button>
              ))}
            </div>
          </div>

          {/* Plugins Section */}
          <div className="settings-section">
            <h3>Plugins</h3>
            {pluginList.length === 0 ? (
              <p className="settings-empty">No plugins installed. Add plugins to the plugins/ directory.</p>
            ) : (
              <div className="settings-plugin-list">
                {pluginList.map((plugin) => (
                  <div key={plugin.name} className="settings-plugin-item">
                    <div className="settings-plugin-info">
                      <span className="settings-plugin-name">{plugin.name} <small>v{plugin.version}</small></span>
                      {plugin.description && (
                        <span className="settings-plugin-desc">{plugin.description}</span>
                      )}
                    </div>
                    <button
                      className={`settings-plugin-toggle ${plugin.enabled ? 'settings-plugin-toggle--enabled' : ''}`}
                      onClick={() => handlePluginToggle(plugin.name, plugin.enabled)}
                      aria-label={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
                    />
                  </div>
                ))}
              </div>
            )}
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
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleImportFile}
              />
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
