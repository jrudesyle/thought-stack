import React, { useState, useCallback } from 'react';
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
