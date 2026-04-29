import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from '../db/index.ts';

// ── Types ──────────────────────────────────────────────────────────

export type ExtensionPointType =
  | 'theme'
  | 'editor-toolbar-action'
  | 'sidebar-section'
  | 'note-lifecycle-hook';

const VALID_EXTENSION_TYPES: ReadonlySet<string> = new Set<ExtensionPointType>([
  'theme',
  'editor-toolbar-action',
  'sidebar-section',
  'note-lifecycle-hook',
]);

export interface ExtensionPointDeclaration {
  type: ExtensionPointType;
  entrypoint?: string;
  hooks?: string[];
}

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  extensionPoints: ExtensionPointDeclaration[];
}

export interface LoadedPlugin {
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  extensions: ExtensionPointDeclaration[];
  /** Absolute path to the plugin directory on disk */
  pluginDir: string;
}

export interface Extension {
  pluginName: string;
  type: ExtensionPointType;
  entrypoint?: string;
  hooks?: string[];
}

/**
 * Simple semver regex: major.minor.patch with optional pre-release / build metadata.
 */
const SEMVER_RE = /^\d+\.\d+\.\d+/;

// ── Validation ─────────────────────────────────────────────────────

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a parsed plugin manifest object.
 *
 * A manifest is valid when:
 *  - `name` is a non-empty string
 *  - `version` matches semver (major.minor.patch, optionally with pre-release/build)
 *  - `extensionPoints` is an array where every entry has a valid `type`
 */
export function validateManifest(manifest: unknown): ManifestValidationResult {
  const errors: string[] = [];

  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['Manifest must be a non-null object'] };
  }

  const m = manifest as Record<string, unknown>;

  // name
  if (typeof m.name !== 'string' || m.name.trim().length === 0) {
    errors.push('Manifest "name" must be a non-empty string');
  }

  // version
  if (typeof m.version !== 'string' || !SEMVER_RE.test(m.version)) {
    errors.push('Manifest "version" must be a valid semver string (e.g. "1.0.0")');
  }

  // extensionPoints
  if (!Array.isArray(m.extensionPoints)) {
    errors.push('Manifest "extensionPoints" must be an array');
  } else {
    for (let i = 0; i < m.extensionPoints.length; i++) {
      const ep = m.extensionPoints[i] as Record<string, unknown> | undefined;
      if (!ep || typeof ep !== 'object') {
        errors.push(`extensionPoints[${i}] must be an object`);
        continue;
      }
      if (typeof ep.type !== 'string' || !VALID_EXTENSION_TYPES.has(ep.type)) {
        errors.push(
          `extensionPoints[${i}].type must be one of: ${[...VALID_EXTENSION_TYPES].join(', ')}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Plugin Registry ────────────────────────────────────────────────

export interface PluginRegistry {
  /** Scan a directory for plugin.json manifests and return valid ones. */
  discoverPlugins(pluginsDir: string): PluginManifest[];
  /** Activate a plugin and register its extensions. */
  loadPlugin(manifest: PluginManifest, pluginDir: string): void;
  /** Deactivate a plugin and remove its extensions. */
  unloadPlugin(name: string): void;
  /** List all loaded plugins with their status. */
  getLoadedPlugins(): LoadedPlugin[];
  /** Get extensions registered for a given type. */
  getExtensions(type: ExtensionPointType): Extension[];
  /** Enable a plugin (persists to DB). */
  enablePlugin(name: string): boolean;
  /** Disable a plugin (persists to DB). */
  disablePlugin(name: string): boolean;
  /** Get the directory path for a loaded plugin (for serving assets). */
  getPluginDir(name: string): string | null;
}

/**
 * Creates an in-memory plugin registry backed by the `plugins` table in the
 * database for enabled/disabled state persistence.
 */
export function createPluginRegistry(db: Database): PluginRegistry {
  const plugins = new Map<string, LoadedPlugin>();
  const extensions: Extension[] = [];

  // ── helpers ────────────────────────────────────────────────────

  function isEnabledInDb(name: string): boolean {
    const row = db.prepare('SELECT enabled FROM plugins WHERE name = ?').get(name) as
      | { enabled: number }
      | null;
    if (row === null) return true; // default to enabled for new plugins
    return row.enabled === 1;
  }

  function persistPluginState(name: string, enabled: boolean): void {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO plugins (name, enabled, loaded_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled`,
    ).run(name, enabled ? 1 : 0, now);
  }

  // ── registry implementation ───────────────────────────────────

  function discoverPlugins(pluginsDir: string): PluginManifest[] {
    const manifests: PluginManifest[] = [];

    if (!existsSync(pluginsDir)) {
      return manifests;
    }

    let entries: string[];
    try {
      entries = readdirSync(pluginsDir);
    } catch (err) {
      console.error(`[plugins] Failed to read plugins directory: ${pluginsDir}`, err);
      return manifests;
    }

    for (const entry of entries) {
      const entryPath = join(pluginsDir, entry);
      try {
        const stat = statSync(entryPath);
        if (!stat.isDirectory()) continue;

        const manifestPath = join(entryPath, 'plugin.json');
        if (!existsSync(manifestPath)) continue;

        const raw = readFileSync(manifestPath, 'utf-8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          console.error(`[plugins] Invalid JSON in ${manifestPath}`);
          continue;
        }

        const result = validateManifest(parsed);
        if (!result.valid) {
          console.error(
            `[plugins] Invalid manifest in ${manifestPath}: ${result.errors.join('; ')}`,
          );
          continue;
        }

        manifests.push(parsed as PluginManifest);
      } catch (err) {
        console.error(`[plugins] Error processing plugin directory ${entryPath}:`, err);
        // Continue loading other plugins
      }
    }

    return manifests;
  }

  function loadPlugin(manifest: PluginManifest, pluginDir: string): void {
    const enabled = isEnabledInDb(manifest.name);

    const loaded: LoadedPlugin = {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      enabled,
      extensions: manifest.extensionPoints,
      pluginDir,
    };

    plugins.set(manifest.name, loaded);

    // Persist state (creates row if not exists)
    persistPluginState(manifest.name, enabled);

    // Register extensions only if enabled
    if (enabled) {
      for (const ep of manifest.extensionPoints) {
        extensions.push({
          pluginName: manifest.name,
          type: ep.type,
          entrypoint: ep.entrypoint,
          hooks: ep.hooks,
        });
      }
    }
  }

  function unloadPlugin(name: string): void {
    plugins.delete(name);

    // Remove all extensions for this plugin
    for (let i = extensions.length - 1; i >= 0; i--) {
      if (extensions[i].pluginName === name) {
        extensions.splice(i, 1);
      }
    }
  }

  function getLoadedPlugins(): LoadedPlugin[] {
    return [...plugins.values()];
  }

  function getExtensions(type: ExtensionPointType): Extension[] {
    return extensions.filter((ext) => ext.type === type);
  }

  function enablePlugin(name: string): boolean {
    const plugin = plugins.get(name);
    if (!plugin) return false;

    if (plugin.enabled) return true; // already enabled

    plugin.enabled = true;
    persistPluginState(name, true);

    // Register extensions
    for (const ep of plugin.extensions) {
      extensions.push({
        pluginName: name,
        type: ep.type,
        entrypoint: ep.entrypoint,
        hooks: ep.hooks,
      });
    }

    return true;
  }

  function disablePlugin(name: string): boolean {
    const plugin = plugins.get(name);
    if (!plugin) return false;

    if (!plugin.enabled) return true; // already disabled

    plugin.enabled = false;
    persistPluginState(name, false);

    // Remove extensions
    for (let i = extensions.length - 1; i >= 0; i--) {
      if (extensions[i].pluginName === name) {
        extensions.splice(i, 1);
      }
    }

    return true;
  }

  function getPluginDir(name: string): string | null {
    const plugin = plugins.get(name);
    return plugin ? plugin.pluginDir : null;
  }

  return {
    discoverPlugins,
    loadPlugin,
    unloadPlugin,
    getLoadedPlugins,
    getExtensions,
    enablePlugin,
    disablePlugin,
    getPluginDir,
  };
}
