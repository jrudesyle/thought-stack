use std::fs;
use std::path::Path;

const IGNORE_FILE: &str = ".thoughtstackignore";

pub fn read_ignore_patterns(vault_path: &Path) -> Vec<String> {
    let file_path = vault_path.join(IGNORE_FILE);
    match fs::read_to_string(&file_path) {
        Ok(content) => content
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .collect(),
        Err(_) => Vec::new(),
    }
}

pub fn add_ignore_pattern(vault_path: &Path, pattern: &str) -> Result<(), String> {
    let file_path = vault_path.join(IGNORE_FILE);
    let existing = read_ignore_patterns(vault_path);
    if existing.iter().any(|p| p == pattern) {
        return Ok(());
    }
    let prefix = if file_path.exists() { "\n" } else { "" };
    let line = format!("{}{}\n", prefix, pattern);
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(line.as_bytes())
        })
        .map_err(|e| e.to_string())
}

pub fn is_ignored(patterns: &[String], relative_path: &str) -> bool {
    let normalized = relative_path.replace('\\', "/");
    patterns
        .iter()
        .any(|p| normalized == *p || normalized.starts_with(&format!("{}/", p)))
}
