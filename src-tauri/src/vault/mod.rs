pub mod conflicts;
pub mod images;
pub mod markdown;
pub mod notebooks;
pub mod notes;
pub mod sanitize;
pub mod search;
pub mod settings;
pub mod trash;

use std::path::{Path, PathBuf};

pub const VAULT_META_DIR: &str = ".thoughtstack";
pub const TRASH_DIR: &str = ".trash";
pub const IMAGES_DIR: &str = ".images";
pub const TRASH_META_FILE: &str = ".trash-meta.json";
pub const SETTINGS_FILE: &str = "settings.json";

/// Excluded directories when walking the vault for notes.
pub const SKIP_DIRS: &[&str] = &[".thoughtstack", ".trash", ".images"];

/// Resolves and validates a vault path, expanding `~` to the home directory.
pub fn resolve_vault_path(vault_path: &str) -> PathBuf {
    let expanded = if vault_path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            home.join(&vault_path[2..])
        } else {
            PathBuf::from(vault_path)
        }
    } else {
        PathBuf::from(vault_path)
    };
    expanded
}

/// Returns true if the directory name should be skipped when walking.
pub fn is_skip_dir(name: &str) -> bool {
    SKIP_DIRS.contains(&name)
}

/// Checks whether a path component is a skip directory.
pub fn path_has_skip_ancestor(path: &Path, vault_root: &Path) -> bool {
    if let Ok(rel) = path.strip_prefix(vault_root) {
        for component in rel.components() {
            if let std::path::Component::Normal(name) = component {
                if is_skip_dir(name.to_str().unwrap_or("")) {
                    return true;
                }
            }
        }
    }
    false
}
