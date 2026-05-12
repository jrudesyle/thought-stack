use crate::vault::{
    ignore::{is_ignored, read_ignore_patterns},
    markdown::{parse_frontmatter, serialize_note},
    resolve_vault_path,
    sanitize::{resolve_filename_conflict, sanitize_filename, title_from_filename},
    trash::soft_delete,
    SKIP_DIRS,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteData {
    pub id: String,
    pub title: String,
    pub content: String,
    pub path: String,
    pub notebook: String,
    pub tags: Vec<String>,
    pub created: String,
    pub modified: String,
    pub is_trashed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub path: String,
    pub notebook: String,
    pub tags: Vec<String>,
    pub created: String,
    pub modified: String,
    pub snippet: String,
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn note_from_file(
    vault_root: &Path,
    file_path: &Path,
    is_trashed: bool,
) -> Option<NoteData> {
    let content_str = fs::read_to_string(file_path).ok()?;
    let parsed = parse_frontmatter(&content_str);

    let rel_path = file_path.strip_prefix(vault_root).ok()?;
    let rel_str = rel_path.to_string_lossy().to_string();

    // Determine notebook from relative path
    let notebook = rel_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    // Derive title from filename (strip .md)
    let filename = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let title = title_from_filename(&filename);

    let id = if parsed.data.id.is_empty() {
        rel_str.clone()
    } else {
        parsed.data.id.clone()
    };

    Some(NoteData {
        id,
        title,
        content: parsed.content.clone(),
        path: rel_str,
        notebook,
        tags: parsed.data.tags.clone(),
        created: parsed.data.created.clone(),
        modified: parsed.data.modified.clone(),
        is_trashed,
    })
}

fn note_summary_from_data(note: &NoteData) -> NoteSummary {
    let snippet: String = note
        .content
        .chars()
        .filter(|c| *c != '\n' && *c != '#')
        .take(120)
        .collect::<String>()
        .trim()
        .to_string();

    NoteSummary {
        id: note.id.clone(),
        title: note.title.clone(),
        path: note.path.clone(),
        notebook: note.notebook.clone(),
        tags: note.tags.clone(),
        created: note.created.clone(),
        modified: note.modified.clone(),
        snippet,
    }
}

// ── Public API ─────────────────────────────────────────────────────────────

/// Creates a new note in the specified notebook directory.
pub fn create_note(
    vault_path: &str,
    notebook: &str,
    title: Option<&str>,
) -> Result<NoteData, String> {
    let resolved = resolve_vault_path(vault_path);
    let note_title = title
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .unwrap_or("Untitled")
        .to_string();

    let id = Uuid::new_v4().to_string().replace('-', "");
    let now = Utc::now().to_rfc3339();

    let notebook_dir = resolved.join(notebook);
    fs::create_dir_all(&notebook_dir).map_err(|e| e.to_string())?;

    let sanitized = sanitize_filename(&note_title);
    let filename = resolve_filename_conflict(&notebook_dir, &format!("{}.md", sanitized));

    let markdown = serialize_note(&id, &[], &now, &now, "", &HashMap::new());
    let file_path = notebook_dir.join(&filename);
    fs::write(&file_path, &markdown).map_err(|e| e.to_string())?;

    let rel_path = file_path
        .strip_prefix(&resolved)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    Ok(NoteData {
        id,
        title: note_title,
        content: String::new(),
        path: rel_path,
        notebook: notebook.to_string(),
        tags: vec![],
        created: now.clone(),
        modified: now,
        is_trashed: false,
    })
}

/// Reads a note from disk by its relative path.
pub fn get_note(vault_path: &str, note_path: &str) -> Result<NoteData, String> {
    let resolved = resolve_vault_path(vault_path);
    let file_path = resolved.join(note_path);

    let content_str =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read note: {}", e))?;
    let parsed = parse_frontmatter(&content_str);

    let filename = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let title = title_from_filename(&filename);

    let notebook = file_path
        .strip_prefix(&resolved)
        .ok()
        .and_then(|p| p.parent())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let id = if parsed.data.id.is_empty() {
        note_path.to_string()
    } else {
        parsed.data.id.clone()
    };

    Ok(NoteData {
        id,
        title,
        content: parsed.content.clone(),
        path: note_path.to_string(),
        notebook,
        tags: parsed.data.tags.clone(),
        created: parsed.data.created.clone(),
        modified: parsed.data.modified.clone(),
        is_trashed: false,
    })
}

/// Saves note content (title, body, tags) to disk.
pub fn save_note(
    vault_path: &str,
    note_path: &str,
    title: &str,
    content: &str,
    tags: &[String],
) -> Result<NoteData, String> {
    let resolved = resolve_vault_path(vault_path);
    let file_path = resolved.join(note_path);

    // Read existing frontmatter to preserve created + id + extra fields
    let existing_str = fs::read_to_string(&file_path).unwrap_or_default();
    let existing = parse_frontmatter(&existing_str);

    let id = if existing.data.id.is_empty() {
        Uuid::new_v4().to_string().replace('-', "")
    } else {
        existing.data.id.clone()
    };
    let created = if existing.data.created.is_empty() {
        Utc::now().to_rfc3339()
    } else {
        existing.data.created.clone()
    };
    let modified = Utc::now().to_rfc3339();

    // Handle title rename: if title changed, rename the file
    let current_filename = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let current_title = title_from_filename(&current_filename);

    let (final_path, final_file_path) = if title != current_title {
        let parent = file_path.parent().unwrap_or(&resolved);
        let sanitized = sanitize_filename(title);
        let new_filename = resolve_filename_conflict(parent, &format!("{}.md", sanitized));
        let new_file_path = parent.join(&new_filename);
        (
            new_file_path
                .strip_prefix(&resolved)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .to_string(),
            new_file_path,
        )
    } else {
        (note_path.to_string(), file_path.clone())
    };

    let markdown = serialize_note(&id, tags, &created, &modified, content, &existing.data.extra);

    // Rename file if needed before writing
    if final_file_path != file_path {
        fs::rename(&file_path, &final_file_path).map_err(|e| e.to_string())?;
    }
    fs::write(&final_file_path, &markdown).map_err(|e| e.to_string())?;

    let notebook = final_file_path
        .strip_prefix(&resolved)
        .ok()
        .and_then(|p| p.parent())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(NoteData {
        id,
        title: title.to_string(),
        content: content.to_string(),
        path: final_path,
        notebook,
        tags: tags.to_vec(),
        created,
        modified,
        is_trashed: false,
    })
}

/// Lists all notes in the vault (or filtered by notebook/tag/trash).
pub fn list_notes(
    vault_path: &str,
    notebook_filter: Option<&str>,
    tag_filter: Option<&str>,
    trash: bool,
) -> Result<Vec<NoteSummary>, String> {
    let resolved = resolve_vault_path(vault_path);
    let ignore_patterns = read_ignore_patterns(&resolved);

    let search_root = if trash {
        resolved.join(".trash")
    } else {
        resolved.clone()
    };

    if !search_root.exists() {
        return Ok(vec![]);
    }

    let mut summaries = Vec::new();

    for entry in walkdir::WalkDir::new(&search_root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_str().unwrap_or("");
            if trash {
                return true;
            }
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
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }

        // Skip .trash-meta.json-like files
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }

        let note_data = match note_from_file(&resolved, path, trash) {
            Some(n) => n,
            None => continue,
        };

        // Apply notebook filter
        if let Some(nb) = notebook_filter {
            if note_data.notebook != nb {
                continue;
            }
        }

        // Apply tag filter
        if let Some(tag) = tag_filter {
            if !note_data.tags.iter().any(|t| t == tag) {
                continue;
            }
        }

        summaries.push(note_summary_from_data(&note_data));
    }

    // Sort by modified descending
    summaries.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(summaries)
}

/// Moves a note to a different notebook directory.
pub fn move_note(
    vault_path: &str,
    from_path: &str,
    to_notebook: &str,
) -> Result<NoteData, String> {
    let resolved = resolve_vault_path(vault_path);
    let src = resolved.join(from_path);

    let dest_dir = resolved.join(to_notebook);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let filename = src
        .file_name()
        .ok_or("Invalid source path")?
        .to_str()
        .unwrap()
        .to_string();
    let new_filename = resolve_filename_conflict(&dest_dir, &filename);
    let dest = dest_dir.join(&new_filename);

    fs::rename(&src, &dest).map_err(|e| e.to_string())?;

    let rel_path = dest
        .strip_prefix(&resolved)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    get_note(vault_path, &rel_path)
}

/// Duplicates a note in the same notebook with a " copy" suffix.
pub fn duplicate_note(vault_path: &str, note_path: &str) -> Result<NoteData, String> {
    let resolved = resolve_vault_path(vault_path);
    let src = resolved.join(note_path);

    let parent = src.parent().ok_or("Invalid note path")?;
    let filename = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?;
    let title = title_from_filename(filename);

    let copy_name = resolve_filename_conflict(parent, &format!("{} copy.md", sanitize_filename(&title)));
    let dest = parent.join(&copy_name);

    fs::copy(&src, &dest).map_err(|e| e.to_string())?;

    // Update the id and modified timestamp in the copy
    let content_str = fs::read_to_string(&dest).map_err(|e| e.to_string())?;
    let parsed = parse_frontmatter(&content_str);
    let new_id = Uuid::new_v4().to_string().replace('-', "");
    let now = Utc::now().to_rfc3339();
    let markdown = serialize_note(
        &new_id,
        &parsed.data.tags,
        &parsed.data.created,
        &now,
        &parsed.content.clone(),
        &parsed.data.extra,
    );
    fs::write(&dest, &markdown).map_err(|e| e.to_string())?;

    let rel_path = dest
        .strip_prefix(&resolved)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    get_note(vault_path, &rel_path)
}

/// Soft-deletes a note (moves to .trash/).
pub fn delete_note(vault_path: &str, note_path: &str) -> Result<bool, String> {
    soft_delete(vault_path, note_path)
}

// ── Tag helpers ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    pub note_count: usize,
}

/// Lists all unique tags across the vault with note counts.
pub fn list_tags(vault_path: &str) -> Result<Vec<TagInfo>, String> {
    let resolved = resolve_vault_path(vault_path);
    let ignore_patterns = read_ignore_patterns(&resolved);
    let mut counts: HashMap<String, usize> = HashMap::new();

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
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Ok(content) = fs::read_to_string(path) {
            let parsed = parse_frontmatter(&content);
            for tag in &parsed.data.tags {
                *counts.entry(tag.clone()).or_insert(0) += 1;
            }
        }
    }

    let mut tags: Vec<TagInfo> = counts
        .into_iter()
        .map(|(name, note_count)| TagInfo { name, note_count })
        .collect();
    tags.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(tags)
}

/// Renames a tag across all notes in the vault. Returns number of notes updated.
pub fn rename_tag(
    vault_path: &str,
    old_name: &str,
    new_name: &str,
) -> Result<usize, String> {
    let resolved = resolve_vault_path(vault_path);
    let ignore_patterns = read_ignore_patterns(&resolved);
    let mut updated = 0usize;

    let entries: Vec<PathBuf> = walkdir::WalkDir::new(&resolved)
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
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path().extension().and_then(|x| x.to_str()) == Some("md")
        })
        .map(|e| e.path().to_path_buf())
        .collect();

    for path in entries {
        if let Ok(content) = fs::read_to_string(&path) {
            let mut parsed = parse_frontmatter(&content);
            if parsed.data.tags.contains(&old_name.to_string()) {
                parsed.data.tags = parsed
                    .data
                    .tags
                    .into_iter()
                    .map(|t| if t == old_name { new_name.to_string() } else { t })
                    .collect();

                let modified = Utc::now().to_rfc3339();
                let markdown = serialize_note(
                    &parsed.data.id,
                    &parsed.data.tags,
                    &parsed.data.created,
                    &modified,
                    &parsed.content.clone(),
                    &parsed.data.extra,
                );
                fs::write(&path, &markdown).map_err(|e| e.to_string())?;
                updated += 1;
            }
        }
    }

    Ok(updated)
}

/// Returns tags whose names start with `prefix` (case-insensitive).
pub fn autocomplete_tags(
    vault_path: &str,
    prefix: &str,
) -> Result<Vec<TagInfo>, String> {
    let prefix_lower = prefix.to_lowercase();
    let all = list_tags(vault_path)?;
    Ok(all
        .into_iter()
        .filter(|t| t.name.to_lowercase().starts_with(&prefix_lower))
        .collect())
}
