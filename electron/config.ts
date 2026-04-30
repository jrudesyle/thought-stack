import fs from 'node:fs';
import path from 'node:path';

export interface AppSettings {
  vaultPath: string;
  theme: 'light' | 'dark' | 'system';
  autoSaveDelayMs: number;
  recentVaults: string[];
}

const DEFAULT_SETTINGS: AppSettings = {
  vaultPath: '',
  theme: 'system',
  autoSaveDelayMs: 2000,
  recentVaults: [],
};

/**
 * Returns the directory where app config is stored.
 * Uses Electron's app.getPath('userData') when available,
 * falls back to a local directory for testing.
 */
function getConfigDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron');
    return app.getPath('userData');
  } catch {
    // Fallback for testing or non-Electron environments
    return path.join(process.cwd(), '.thoughtstack-config');
  }
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Reads app config from the userData config.json file.
 * Returns default settings if the file is missing or unreadable.
 */
export function loadAppConfig(): AppSettings {
  const configPath = getConfigPath();
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      vaultPath: typeof parsed.vaultPath === 'string' ? parsed.vaultPath : DEFAULT_SETTINGS.vaultPath,
      theme: isValidTheme(parsed.theme) ? parsed.theme : DEFAULT_SETTINGS.theme,
      autoSaveDelayMs: typeof parsed.autoSaveDelayMs === 'number' ? parsed.autoSaveDelayMs : DEFAULT_SETTINGS.autoSaveDelayMs,
      recentVaults: Array.isArray(parsed.recentVaults) ? parsed.recentVaults.filter((v): v is string => typeof v === 'string') : DEFAULT_SETTINGS.recentVaults,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Writes app settings to the userData config.json file.
 */
export function saveAppConfig(settings: AppSettings): void {
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2), 'utf-8');
}

function isValidTheme(value: unknown): value is 'light' | 'dark' | 'system' {
  return value === 'light' || value === 'dark' || value === 'system';
}
