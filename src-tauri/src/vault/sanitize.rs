use std::path::Path;

/// Strips characters invalid in filenames across Windows, macOS, and Linux.
/// Trims whitespace and defaults to "Untitled" if the result is empty.
pub fn sanitize_filename(title: &str) -> String {
    let sanitized: String = title
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let trimmed = sanitized.trim().to_string();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed
    }
}

/// If a file with the given filename already exists in the directory,
/// appends " 2", " 3", etc. until a unique name is found.
/// The filename should include the `.md` extension.
pub fn resolve_filename_conflict(directory: &Path, filename: &str) -> String {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();
    let base = if ext.is_empty() {
        filename.to_string()
    } else {
        filename[..filename.len() - ext.len()].to_string()
    };

    let mut candidate = filename.to_string();
    let mut counter = 2u32;

    while directory.join(&candidate).exists() {
        candidate = format!("{} {}{}", base, counter, ext);
        counter += 1;
    }

    candidate
}

/// Strips the `.md` extension from a filename to derive the note title.
pub fn title_from_filename(filename: &str) -> String {
    if filename.ends_with(".md") {
        filename[..filename.len() - 3].to_string()
    } else {
        filename.to_string()
    }
}
