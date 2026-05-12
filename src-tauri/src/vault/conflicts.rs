use crate::vault::{resolve_vault_path, ignore::{is_ignored, read_ignore_patterns}, SKIP_DIRS};
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub conflict_path: String,
    pub original_path: String,
    pub provider: String,
}

struct ConflictPattern {
    regex: Regex,
    provider: &'static str,
    /// Reconstructs the original filename from capture groups (without extension)
    to_original: fn(&regex::Captures) -> String,
}

fn build_patterns() -> Vec<ConflictPattern> {
    vec![
        // Dropbox: "name (conflicted copy).ext" or "name (Someone's conflicted copy 2026-04-30).ext"
        ConflictPattern {
            regex: Regex::new(r"(?i)^(.+?)\s+\([^)]*conflicted copy[^)]*\)(\.\w+)$").unwrap(),
            provider: "dropbox",
            to_original: |c| format!("{}{}", &c[1], &c[2]),
        },
        // iCloud: "name (conflict).ext"
        ConflictPattern {
            regex: Regex::new(r"(?i)^(.+?)\s+\(conflict\)(\.\w+)$").unwrap(),
            provider: "icloud",
            to_original: |c| format!("{}{}", &c[1], &c[2]),
        },
        // Google Drive: "name (1).ext", "name (2).ext"
        ConflictPattern {
            regex: Regex::new(r"^(.+?)\s+\(\d+\)(\.\w+)$").unwrap(),
            provider: "google-drive",
            to_original: |c| format!("{}{}", &c[1], &c[2]),
        },
        // iCloud: "name 2.ext", "name 3.ext" (space + single digit before extension)
        ConflictPattern {
            regex: Regex::new(r"^(.+?)\s+\d(\.\w+)$").unwrap(),
            provider: "icloud",
            to_original: |c| format!("{}{}", &c[1], &c[2]),
        },
        // OneDrive: "name-MACHINENAME.ext"
        ConflictPattern {
            regex: Regex::new(r"^(.+?)-[A-Z0-9]{6,}(\.\w+)$").unwrap(),
            provider: "onedrive",
            to_original: |c| format!("{}{}", &c[1], &c[2]),
        },
    ]
}

/// Walks the vault looking for filenames that match known cloud-sync conflict patterns.
pub fn detect_conflicts(vault_path: &str) -> Result<Vec<ConflictFile>, String> {
    let resolved = resolve_vault_path(vault_path);
    let patterns = build_patterns();
    let ignore_patterns = read_ignore_patterns(&resolved);
    let mut conflicts = Vec::new();

    for entry in walkdir::WalkDir::new(&resolved)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_str().unwrap_or("");
            if SKIP_DIRS.contains(&name) {
                return false;
            }
            if e.depth() > 0 && e.file_type().is_dir() {
                if let Ok(rel) = e.path().strip_prefix(&resolved) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    if is_ignored(&ignore_patterns, &rel_str) {
                        return false;
                    }
                }
            }
            true
        })
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };

        for pattern in &patterns {
            if let Some(caps) = pattern.regex.captures(filename) {
                let original_filename = (pattern.to_original)(&caps);
                let parent = path.parent().unwrap_or(&resolved);

                let conflict_rel = path
                    .strip_prefix(&resolved)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| filename.to_string());

                let original_rel = parent
                    .join(&original_filename)
                    .strip_prefix(&resolved)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or(original_filename.clone());

                conflicts.push(ConflictFile {
                    conflict_path: conflict_rel,
                    original_path: original_rel,
                    provider: pattern.provider.to_string(),
                });
                break; // only match first pattern per file
            }
        }
    }

    Ok(conflicts)
}
