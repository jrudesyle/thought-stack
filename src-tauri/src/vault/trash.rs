use crate::vault::{
    markdown::parse_frontmatter,
    notes::NoteData,
    resolve_vault_path,
    sanitize::resolve_filename_conflict,
    TRASH_DIR, TRASH_META_FILE,
};
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashMeta {
    pub items: Vec<TrashItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: String,
    pub original_path: String,
    pub trashed_at: String,
}

fn read_trash_meta(vault_root: &std::path::Path) -> TrashMeta {
    let meta_path = vault_root.join(TRASH_DIR).join(TRASH_META_FILE);
    fs::read_to_string(&meta_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(TrashMeta { items: vec![] })
}

fn write_trash_meta(vault_root: &std::path::Path, meta: &TrashMeta) -> Result<(), String> {
    let trash_dir = vault_root.join(TRASH_DIR);
    fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;
    let meta_path = trash_dir.join(TRASH_META_FILE);
    let json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(&meta_path, json).map_err(|e| e.to_string())
}

/// Moves a `.md` file to `.trash/`, updates `.trash-meta.json`.
pub fn soft_delete(vault_path: &str, note_rel_path: &str) -> Result<bool, String> {
    let resolved = resolve_vault_path(vault_path);
    let src = resolved.join(note_rel_path);

    if !src.exists() {
        return Err(format!("Note not found: {}", note_rel_path));
    }

    let trash_dir = resolved.join(TRASH_DIR);
    fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;

    let filename = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?
        .to_string();
    let dest_filename = resolve_filename_conflict(&trash_dir, &filename);
    let dest = trash_dir.join(&dest_filename);

    // Read note id before moving
    let content = fs::read_to_string(&src).unwrap_or_default();
    let parsed = parse_frontmatter(&content);
    let note_id = parsed.data.id;

    fs::rename(&src, &dest).map_err(|e| e.to_string())?;

    // Update trash meta
    let mut meta = read_trash_meta(&resolved);
    meta.items.push(TrashItem {
        id: note_id,
        original_path: note_rel_path.to_string(),
        trashed_at: chrono::Utc::now().to_rfc3339(),
    });
    write_trash_meta(&resolved, &meta)?;

    Ok(true)
}

/// Soft-deletes an entire notebook directory to `.trash/`.
pub fn soft_delete_dir(vault_path: &str, notebook_rel_path: &str) -> Result<bool, String> {
    let resolved = resolve_vault_path(vault_path);
    let src = resolved.join(notebook_rel_path);

    if !src.exists() {
        return Err(format!("Notebook not found: {}", notebook_rel_path));
    }

    let trash_dir = resolved.join(TRASH_DIR);
    fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;

    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid notebook path")?
        .to_string();
    let dest = trash_dir.join(&name);
    fs::rename(&src, &dest).map_err(|e| e.to_string())?;

    Ok(true)
}

/// Restores a trashed note to `target_notebook` (or its original notebook).
pub fn restore_note(
    vault_path: &str,
    trash_path: &str,
    target_notebook: Option<&str>,
) -> Result<NoteData, String> {
    let resolved = resolve_vault_path(vault_path);
    let src = resolved.join(TRASH_DIR).join(
        std::path::Path::new(trash_path)
            .file_name()
            .ok_or("Invalid trash path")?,
    );

    if !src.exists() {
        return Err(format!("Trashed note not found: {}", trash_path));
    }

    // Determine restore destination
    let mut meta = read_trash_meta(&resolved);
    let filename = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let notebook = if let Some(nb) = target_notebook {
        nb.to_string()
    } else {
        // Look up original path in trash meta
        meta.items
            .iter()
            .find(|item| {
                std::path::Path::new(&item.original_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    == Some(&filename)
            })
            .and_then(|item| {
                std::path::Path::new(&item.original_path)
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| "Inbox".to_string())
    };

    let dest_dir = resolved.join(&notebook);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let dest_filename = resolve_filename_conflict(&dest_dir, &filename);
    let dest = dest_dir.join(&dest_filename);
    fs::rename(&src, &dest).map_err(|e| e.to_string())?;

    // Remove from trash meta
    meta.items.retain(|item| {
        std::path::Path::new(&item.original_path)
            .file_name()
            .and_then(|n| n.to_str())
            != Some(&filename)
    });
    write_trash_meta(&resolved, &meta)?;

    let rel_path = dest
        .strip_prefix(&resolved)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    crate::vault::notes::get_note(vault_path, &rel_path)
}

/// Permanently deletes a note from the trash.
pub fn permanent_delete(vault_path: &str, trash_path: &str) -> Result<bool, String> {
    let resolved = resolve_vault_path(vault_path);
    let filename = std::path::Path::new(trash_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid trash path")?
        .to_string();
    let file = resolved.join(TRASH_DIR).join(&filename);

    if file.exists() {
        fs::remove_file(&file).map_err(|e| e.to_string())?;
    }

    // Remove from meta
    let mut meta = read_trash_meta(&resolved);
    meta.items.retain(|item| {
        std::path::Path::new(&item.original_path)
            .file_name()
            .and_then(|n| n.to_str())
            != Some(&filename)
    });
    write_trash_meta(&resolved, &meta)?;

    Ok(true)
}

/// Permanently deletes all notes in the trash. Returns the count of deleted notes.
pub fn empty_trash(vault_path: &str) -> Result<usize, String> {
    let resolved = resolve_vault_path(vault_path);
    let trash_dir = resolved.join(TRASH_DIR);

    if !trash_dir.exists() {
        return Ok(0);
    }

    let mut count = 0usize;
    for entry in fs::read_dir(&trash_dir).map_err(|e| e.to_string())? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if fs::remove_file(&path).is_ok() {
                count += 1;
            }
        }
    }

    // Clear meta
    write_trash_meta(&resolved, &TrashMeta { items: vec![] })?;
    Ok(count)
}
