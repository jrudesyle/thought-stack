import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestDatabase, type TestDatabase } from '../../helpers/db.ts';
import type { Database } from '../../../src/server/db/index.ts';
import {
  validateManifest,
  createPluginRegistry,
  type PluginManifest,
  type PluginRegistry,
} from '../../../src/server/plugins/registry.ts';

// ── validateManifest ───────────────────────────────────────────────

describe('validateManifest', () => {
  it('should accept a valid manifest', () => {
    const result = validateManifest({
      name: 'my-plugin',
      version: '1.0.0',
      extensionPoints: [{ type: 'theme', entrypoint: './theme.css' }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept a manifest with all extension point types', () => {
    const result = validateManifest({
      name: 'full-plugin',
      version: '2.1.0',
      description: 'A full plugin',
      extensionPoints: [
        { type: 'theme', entrypoint: './theme.css' },
        { type: 'editor-toolbar-action', entrypoint: './toolbar.js' },
        { type: 'sidebar-section', entrypoint: './sidebar.js' },
        { type: 'note-lifecycle-hook', hooks: ['before-save', 'after-save'] },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('should accept a manifest with semver pre-release', () => {
    const result = validateManifest({
      name: 'beta-plugin',
      version: '1.0.0-beta.1',
      extensionPoints: [],
    });
    expect(result.valid).toBe(true);
  });

  it('should accept a manifest with empty extensionPoints array', () => {
    const result = validateManifest({
      name: 'empty-ext',
      version: '1.0.0',
      extensionPoints: [],
    });
    expect(result.valid).toBe(true);
  });

  it('should reject null', () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
  });

  it('should reject undefined', () => {
    const result = validateManifest(undefined);
    expect(result.valid).toBe(false);
  });

  it('should reject an array', () => {
    const result = validateManifest([]);
    expect(result.valid).toBe(false);
  });

  it('should reject manifest with empty name', () => {
    const result = validateManifest({
      name: '',
      version: '1.0.0',
      extensionPoints: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('should reject manifest with missing name', () => {
    const result = validateManifest({
      version: '1.0.0',
      extensionPoints: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('should reject manifest with non-string name', () => {
    const result = validateManifest({
      name: 123,
      version: '1.0.0',
      extensionPoints: [],
    });
    expect(result.valid).toBe(false);
  });

  it('should reject manifest with invalid version', () => {
    const result = validateManifest({
      name: 'bad-version',
      version: 'not-semver',
      extensionPoints: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('version'))).toBe(true);
  });

  it('should reject manifest with missing version', () => {
    const result = validateManifest({
      name: 'no-version',
      extensionPoints: [],
    });
    expect(result.valid).toBe(false);
  });

  it('should reject manifest with non-array extensionPoints', () => {
    const result = validateManifest({
      name: 'bad-ext',
      version: '1.0.0',
      extensionPoints: 'not-an-array',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('extensionPoints'))).toBe(true);
  });

  it('should reject manifest with missing extensionPoints', () => {
    const result = validateManifest({
      name: 'no-ext',
      version: '1.0.0',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject manifest with invalid extension point type', () => {
    const result = validateManifest({
      name: 'bad-type',
      version: '1.0.0',
      extensionPoints: [{ type: 'invalid-type' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('type'))).toBe(true);
  });

  it('should collect multiple errors', () => {
    const result = validateManifest({
      name: '',
      version: 'bad',
      extensionPoints: 'nope',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Plugin Registry ────────────────────────────────────────────────

describe('createPluginRegistry', () => {
  let db: TestDatabase;
  let registry: PluginRegistry;

  beforeEach(() => {
    db = createTestDatabase();
    registry = createPluginRegistry(db as unknown as Database);
  });

  afterEach(() => {
    db.close();
  });

  // ── getLoadedPlugins / loadPlugin ─────────────────────────────

  it('should start with no loaded plugins', () => {
    expect(registry.getLoadedPlugins()).toEqual([]);
  });

  it('should load a plugin and list it', () => {
    const manifest: PluginManifest = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      extensionPoints: [{ type: 'theme', entrypoint: './theme.css' }],
    };

    registry.loadPlugin(manifest, '/fake/path');

    const loaded = registry.getLoadedPlugins();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('test-plugin');
    expect(loaded[0].version).toBe('1.0.0');
    expect(loaded[0].enabled).toBe(true);
  });

  it('should persist plugin state to the database on load', () => {
    const manifest: PluginManifest = {
      name: 'persisted-plugin',
      version: '1.0.0',
      extensionPoints: [],
    };

    registry.loadPlugin(manifest, '/fake/path');

    const row = db.prepare('SELECT * FROM plugins WHERE name = ?').get('persisted-plugin') as {
      name: string;
      enabled: number;
    } | null;
    expect(row).not.toBeNull();
    expect(row!.name).toBe('persisted-plugin');
    expect(row!.enabled).toBe(1);
  });

  // ── getExtensions ─────────────────────────────────────────────

  it('should register extensions for enabled plugins', () => {
    const manifest: PluginManifest = {
      name: 'ext-plugin',
      version: '1.0.0',
      extensionPoints: [
        { type: 'theme', entrypoint: './theme.css' },
        { type: 'editor-toolbar-action', entrypoint: './toolbar.js' },
      ],
    };

    registry.loadPlugin(manifest, '/fake/path');

    expect(registry.getExtensions('theme')).toHaveLength(1);
    expect(registry.getExtensions('theme')[0].pluginName).toBe('ext-plugin');
    expect(registry.getExtensions('editor-toolbar-action')).toHaveLength(1);
    expect(registry.getExtensions('sidebar-section')).toHaveLength(0);
  });

  it('should not register extensions for disabled plugins', () => {
    // Pre-disable in DB
    db.prepare('INSERT INTO plugins (name, enabled) VALUES (?, ?)').run('disabled-plugin', 0);

    const manifest: PluginManifest = {
      name: 'disabled-plugin',
      version: '1.0.0',
      extensionPoints: [{ type: 'theme', entrypoint: './theme.css' }],
    };

    registry.loadPlugin(manifest, '/fake/path');

    const loaded = registry.getLoadedPlugins();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].enabled).toBe(false);
    expect(registry.getExtensions('theme')).toHaveLength(0);
  });

  // ── unloadPlugin ──────────────────────────────────────────────

  it('should unload a plugin and remove its extensions', () => {
    const manifest: PluginManifest = {
      name: 'removable',
      version: '1.0.0',
      extensionPoints: [{ type: 'theme', entrypoint: './theme.css' }],
    };

    registry.loadPlugin(manifest, '/fake/path');
    expect(registry.getLoadedPlugins()).toHaveLength(1);
    expect(registry.getExtensions('theme')).toHaveLength(1);

    registry.unloadPlugin('removable');
    expect(registry.getLoadedPlugins()).toHaveLength(0);
    expect(registry.getExtensions('theme')).toHaveLength(0);
  });

  it('should not throw when unloading a non-existent plugin', () => {
    expect(() => registry.unloadPlugin('nonexistent')).not.toThrow();
  });

  // ── enablePlugin / disablePlugin ──────────────────────────────

  it('should enable a disabled plugin and register extensions', () => {
    db.prepare('INSERT INTO plugins (name, enabled) VALUES (?, ?)').run('toggle-plugin', 0);

    const manifest: PluginManifest = {
      name: 'toggle-plugin',
      version: '1.0.0',
      extensionPoints: [{ type: 'sidebar-section', entrypoint: './sidebar.js' }],
    };

    registry.loadPlugin(manifest, '/fake/path');
    expect(registry.getExtensions('sidebar-section')).toHaveLength(0);

    const result = registry.enablePlugin('toggle-plugin');
    expect(result).toBe(true);
    expect(registry.getExtensions('sidebar-section')).toHaveLength(1);

    // Check DB
    const row = db.prepare('SELECT enabled FROM plugins WHERE name = ?').get('toggle-plugin') as {
      enabled: number;
    };
    expect(row.enabled).toBe(1);
  });

  it('should disable an enabled plugin and remove extensions', () => {
    const manifest: PluginManifest = {
      name: 'active-plugin',
      version: '1.0.0',
      extensionPoints: [{ type: 'theme', entrypoint: './dark.css' }],
    };

    registry.loadPlugin(manifest, '/fake/path');
    expect(registry.getExtensions('theme')).toHaveLength(1);

    const result = registry.disablePlugin('active-plugin');
    expect(result).toBe(true);
    expect(registry.getExtensions('theme')).toHaveLength(0);

    const row = db.prepare('SELECT enabled FROM plugins WHERE name = ?').get('active-plugin') as {
      enabled: number;
    };
    expect(row.enabled).toBe(0);
  });

  it('should return false when enabling a non-existent plugin', () => {
    expect(registry.enablePlugin('ghost')).toBe(false);
  });

  it('should return false when disabling a non-existent plugin', () => {
    expect(registry.disablePlugin('ghost')).toBe(false);
  });

  it('should return true when enabling an already-enabled plugin', () => {
    const manifest: PluginManifest = {
      name: 'already-on',
      version: '1.0.0',
      extensionPoints: [{ type: 'theme', entrypoint: './t.css' }],
    };
    registry.loadPlugin(manifest, '/fake/path');
    expect(registry.enablePlugin('already-on')).toBe(true);
    // Should not duplicate extensions
    expect(registry.getExtensions('theme')).toHaveLength(1);
  });

  it('should return true when disabling an already-disabled plugin', () => {
    db.prepare('INSERT INTO plugins (name, enabled) VALUES (?, ?)').run('already-off', 0);
    const manifest: PluginManifest = {
      name: 'already-off',
      version: '1.0.0',
      extensionPoints: [{ type: 'theme', entrypoint: './t.css' }],
    };
    registry.loadPlugin(manifest, '/fake/path');
    expect(registry.disablePlugin('already-off')).toBe(true);
  });

  // ── getPluginDir ──────────────────────────────────────────────

  it('should return plugin directory for loaded plugin', () => {
    const manifest: PluginManifest = {
      name: 'dir-plugin',
      version: '1.0.0',
      extensionPoints: [],
    };
    registry.loadPlugin(manifest, '/some/dir');
    expect(registry.getPluginDir('dir-plugin')).toBe('/some/dir');
  });

  it('should return null for unknown plugin', () => {
    expect(registry.getPluginDir('unknown')).toBeNull();
  });
});

// ── discoverPlugins (filesystem) ───────────────────────────────────

describe('discoverPlugins', () => {
  let db: TestDatabase;
  let registry: PluginRegistry;
  let tmpDir: string;

  beforeEach(() => {
    db = createTestDatabase();
    registry = createPluginRegistry(db as unknown as Database);
    tmpDir = join(tmpdir(), `plugin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createPlugin(name: string, manifest: object): void {
    const dir = join(tmpDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest));
  }

  it('should discover valid plugins', () => {
    createPlugin('good-plugin', {
      name: 'good-plugin',
      version: '1.0.0',
      extensionPoints: [{ type: 'theme', entrypoint: './theme.css' }],
    });

    const manifests = registry.discoverPlugins(tmpDir);
    expect(manifests).toHaveLength(1);
    expect(manifests[0].name).toBe('good-plugin');
  });

  it('should discover multiple valid plugins', () => {
    createPlugin('plugin-a', {
      name: 'plugin-a',
      version: '1.0.0',
      extensionPoints: [],
    });
    createPlugin('plugin-b', {
      name: 'plugin-b',
      version: '2.0.0',
      extensionPoints: [{ type: 'theme', entrypoint: './t.css' }],
    });

    const manifests = registry.discoverPlugins(tmpDir);
    expect(manifests).toHaveLength(2);
  });

  it('should skip directories without plugin.json', () => {
    const dir = join(tmpDir, 'no-manifest');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'readme.md'), '# Not a plugin');

    const manifests = registry.discoverPlugins(tmpDir);
    expect(manifests).toHaveLength(0);
  });

  it('should skip invalid manifests and continue loading valid ones', () => {
    createPlugin('valid', {
      name: 'valid',
      version: '1.0.0',
      extensionPoints: [],
    });
    createPlugin('invalid', {
      name: '',
      version: 'bad',
      extensionPoints: 'nope',
    });

    const manifests = registry.discoverPlugins(tmpDir);
    expect(manifests).toHaveLength(1);
    expect(manifests[0].name).toBe('valid');
  });

  it('should skip files with invalid JSON', () => {
    const dir = join(tmpDir, 'bad-json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), '{ not valid json }}}');

    const manifests = registry.discoverPlugins(tmpDir);
    expect(manifests).toHaveLength(0);
  });

  it('should return empty array for non-existent directory', () => {
    const manifests = registry.discoverPlugins('/nonexistent/path');
    expect(manifests).toHaveLength(0);
  });

  it('should return empty array for empty directory', () => {
    const manifests = registry.discoverPlugins(tmpDir);
    expect(manifests).toHaveLength(0);
  });

  it('should skip non-directory entries', () => {
    writeFileSync(join(tmpDir, 'not-a-dir.txt'), 'just a file');

    const manifests = registry.discoverPlugins(tmpDir);
    expect(manifests).toHaveLength(0);
  });
});
