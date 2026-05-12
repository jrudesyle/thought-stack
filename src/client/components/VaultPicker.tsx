import React, { useState, useEffect, useCallback } from 'react';
import { system } from '../api';
import type { MigrationSummary } from '../api';

// ── Types ──────────────────────────────────────────────────────────

interface VaultPickerProps {
  onVaultReady: () => void;
}

// ── Component ──────────────────────────────────────────────────────

export function VaultPicker({ onVaultReady }: VaultPickerProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationSummary | null>(null);

  const [customPath, setCustomPath] = useState('');
  const [vaultOptions, setVaultOptions] = useState<{ internal: string; external: string | null } | null>(null);

  const isTauri = typeof window !== 'undefined' && typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
  const isAndroid = isTauri && /android/i.test(navigator.userAgent);

  // Load vault options on Android
  useEffect(() => {
    if (!isAndroid) return;
    system.getVaultOptions().then(setVaultOptions).catch(() => {});
  }, [isAndroid]);

  const handleUseCustomPath = useCallback(async (path: string) => {
    if (!path.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const result = await system.setVaultPath(path.trim());
      if (result.success) {
        onVaultReady();
      } else {
        setError('Could not use that path. Check it exists and the app has permission.');
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [onVaultReady]);

  const handlePickVault = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const path = await system.pickVaultFolder();
      if (!path) {
        // User cancelled the dialog
        setLoading(false);
        return;
      }
      const result = await system.setVaultPath(path);
      if (result.success) {
        onVaultReady();
      } else {
        setError('Failed to set vault path. Please try again.');
      }
    } catch (err) {
      console.error('Vault setup failed:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [onVaultReady]);

  const handleMigrate = useCallback(async () => {
    setError(null);
    setMigrationResult(null);

    // Step 1: Pick the old database file
    const dbPath = await system.pickDatabaseFile();
    if (!dbPath) return; // User cancelled

    // Step 2: Pick the target vault folder
    const vaultPath = await system.pickVaultFolder();
    if (!vaultPath) return; // User cancelled

    setMigrating(true);
    try {
      const summary = await system.migrate(dbPath, vaultPath);
      setMigrationResult(summary);

      // If migration succeeded (has notes), set the vault path
      if (summary.notes > 0 && summary.errors.length === 0) {
        const result = await system.setVaultPath(vaultPath);
        if (result.success) {
          // Don't auto-navigate — let user see the results first
        }
      }
    } catch (err) {
      console.error('Migration failed:', err);
      setError('Migration failed. Please try again.');
    } finally {
      setMigrating(false);
    }
  }, []);

  const handleMigrationDone = useCallback(async () => {
    if (!migrationResult) return;
    // Set vault path and proceed
    setMigrationResult(null);
    onVaultReady();
  }, [migrationResult, onVaultReady]);

  if (isAndroid) {
    const suggestions = [
      '/sdcard/ThoughtStack',
      ...(vaultOptions
        ? [vaultOptions.external, vaultOptions.internal].filter(Boolean) as string[]
        : []),
    ];

    return (
      <div className="vault-picker-overlay">
        <div className="vault-picker-panel">
          <div className="vault-picker-logo">📝</div>
          <h1 className="vault-picker-title">ThoughtStack</h1>
          <p className="vault-picker-subtitle">Enter the full path to your vault folder.</p>

          {suggestions.length > 0 && (
            <div style={{ width: '100%', marginBottom: 16 }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                Recommended paths (tap to use):
              </p>
              {suggestions.map(s => (
                <button
                  key={s}
                  onClick={() => handleUseCustomPath(s)}
                  disabled={loading}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px',
                    marginBottom: 8,
                    fontSize: '0.85rem',
                    background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    color: 'var(--color-text)',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                  }}
                >
                  {s === vaultOptions?.external && '📂 '}
                  {s === vaultOptions?.internal && '📱 '}
                  {s}
                </button>
              ))}
            </div>
          )}

          <div style={{ width: '100%', marginBottom: 12 }}>
            <input
              type="text"
              value={customPath}
              onChange={e => setCustomPath(e.target.value)}
              placeholder="Or type a custom path"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '0.95rem',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-secondary)',
                color: 'var(--color-text)',
                boxSizing: 'border-box',
              }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <button
            className="vault-picker-btn vault-picker-btn--primary"
            onClick={() => handleUseCustomPath(customPath)}
            disabled={loading || !customPath.trim()}
            style={{ width: '100%' }}
          >
            {loading ? 'Setting up…' : '✓ Use This Path'}
          </button>

          {error && <div className="vault-picker-error">{error}</div>}

          <p className="vault-picker-hint" style={{ fontSize: '0.75rem', marginTop: 12 }}>
            Files app-accessible paths require special permission. Use recommended paths for best reliability.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="vault-picker-overlay">
      <div className="vault-picker-panel">
        <div className="vault-picker-logo">📝</div>
        <h1 className="vault-picker-title">ThoughtStack</h1>
        <p className="vault-picker-subtitle">
          Choose where to store your notes. Pick a folder on your local drive or a cloud-synced directory.
        </p>

        <div className="vault-picker-actions">
          <button
            className="vault-picker-btn vault-picker-btn--primary"
            onClick={handlePickVault}
            disabled={loading || migrating}
          >
            {loading ? 'Setting up…' : '📁 Create New Vault'}
          </button>
          <button
            className="vault-picker-btn"
            onClick={handlePickVault}
            disabled={loading || migrating}
          >
            {loading ? 'Opening…' : '📂 Open Existing Vault'}
          </button>
          <button
            className="vault-picker-btn vault-picker-btn--migrate"
            onClick={handleMigrate}
            disabled={loading || migrating}
          >
            {migrating ? '⏳ Migrating…' : '🔄 Import from Existing Database'}
          </button>
        </div>

        {error && (
          <div className="vault-picker-error">{error}</div>
        )}

        {migrationResult && (
          <div className="vault-picker-migration-result">
            <h3>Migration Complete</h3>
            <ul>
              <li>📓 Notebooks: {migrationResult.notebooks}</li>
              <li>📝 Notes: {migrationResult.notes}</li>
              <li>🏷️ Tags: {migrationResult.tags}</li>
              <li>🖼️ Images: {migrationResult.images}</li>
            </ul>
            {migrationResult.errors.length > 0 && (
              <div className="vault-picker-migration-errors">
                <p>⚠️ {migrationResult.errors.length} error(s):</p>
                <ul>
                  {migrationResult.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {migrationResult.errors.length > 5 && (
                    <li>…and {migrationResult.errors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
            <button
              className="vault-picker-btn vault-picker-btn--primary"
              onClick={handleMigrationDone}
            >
              Open Vault
            </button>
          </div>
        )}

        <p className="vault-picker-hint">
          Your vault is a folder of Markdown files. Place it on Google Drive, iCloud, or Dropbox for cross-device sync.
        </p>
      </div>
    </div>
  );
}
