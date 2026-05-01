use crate::vault::{resolve_vault_path, VAULT_META_DIR, SETTINGS_FILE};
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub vault_path: String,
    pub theme: String,
    pub auto_save_delay_ms: u32,
    pub recent_vaults: Vec<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            vault_path: default_vault_path(),
            theme: "system".to_string(),
            auto_save_delay_ms: 1000,
            recent_vaults: vec![],
        }
    }
}

fn default_vault_path() -> String {
    dirs::home_dir()
        .map(|h| h.join("ThoughtStack").to_string_lossy().to_string())
        .unwrap_or_else(|| "~/ThoughtStack".to_string())
}

fn settings_file_path(vault_path: &str) -> std::path::PathBuf {
    resolve_vault_path(vault_path)
        .join(VAULT_META_DIR)
        .join(SETTINGS_FILE)
}

pub fn get_settings(vault_path: &str) -> Result<AppSettings, String> {
    let path = settings_file_path(vault_path);
    if path.exists() {
        let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mut settings: AppSettings =
            serde_json::from_str(&json).unwrap_or_else(|_| AppSettings::default());
        settings.vault_path = vault_path.to_string();
        Ok(settings)
    } else {
        Ok(AppSettings {
            vault_path: vault_path.to_string(),
            ..AppSettings::default()
        })
    }
}

pub fn update_settings(
    vault_path: &str,
    updates: serde_json::Value,
) -> Result<AppSettings, String> {
    let mut settings = get_settings(vault_path)?;

    if let Some(theme) = updates.get("theme").and_then(|v| v.as_str()) {
        settings.theme = theme.to_string();
    }
    if let Some(ms) = updates.get("autoSaveDelayMs").and_then(|v| v.as_u64()) {
        settings.auto_save_delay_ms = ms as u32;
    }
    if let Some(vaults) = updates.get("recentVaults").and_then(|v| v.as_array()) {
        settings.recent_vaults = vaults
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }

    save_settings(vault_path, &settings)?;
    Ok(settings)
}

fn save_settings(vault_path: &str, settings: &AppSettings) -> Result<(), String> {
    let meta_dir = resolve_vault_path(vault_path).join(VAULT_META_DIR);
    fs::create_dir_all(&meta_dir).map_err(|e| e.to_string())?;
    let path = meta_dir.join(SETTINGS_FILE);
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}
