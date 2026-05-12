use crate::vault::{
    ignore::{is_ignored, read_ignore_patterns},
    resolve_vault_path,
    sanitize::sanitize_filename,
    trash::soft_delete_dir,
    SKIP_DIRS,
};
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookInfo {
    pub name: String,
    pub path: String,
    pub stack: Option<String>,
    pub note_count: usize,
}

fn count_md_files(dir: &std::path::Path) -> usize {
    walkdir::WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path().extension().and_then(|x| x.to_str()) == Some("md")
                && !e
                    .file_name()
                    .to_str()
                    .map(|n| n.starts_with('.'))
                    .unwrap_or(false)
        })
        .count()
}

/// Creates a notebook directory. If `stack` is provided, creates inside the stack directory.
pub fn create_notebook(
    vault_path: &str,
    name: &str,
    stack: Option<&str>,
) -> Result<NotebookInfo, String> {
    let resolved = resolve_vault_path(vault_path);

    let notebook_rel = if let Some(s) = stack {
        format!("{}/{}", s, name)
    } else {
        name.to_string()
    };

    let full_path = resolved.join(&notebook_rel);
    fs::create_dir_all(&full_path).map_err(|e| e.to_string())?;

    Ok(NotebookInfo {
        name: name.to_string(),
        path: notebook_rel,
        stack: stack.map(|s| s.to_string()),
        note_count: 0,
    })
}

/// Renames a notebook directory.
pub fn rename_notebook(
    vault_path: &str,
    old_rel_path: &str,
    new_name: &str,
) -> Result<NotebookInfo, String> {
    let resolved = resolve_vault_path(vault_path);
    let old_full = resolved.join(old_rel_path);
    let parent = old_full.parent().ok_or("Invalid notebook path")?;
    let new_full = parent.join(sanitize_filename(new_name));

    fs::rename(&old_full, &new_full).map_err(|e| e.to_string())?;

    let new_rel = new_full
        .strip_prefix(&resolved)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    let parent_rel = new_full
        .strip_prefix(&resolved)
        .ok()
        .and_then(|p| p.parent())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let stack = if parent_rel.is_empty() || parent_rel == "." {
        None
    } else {
        Some(parent_rel)
    };

    let note_count = count_md_files(&new_full);

    Ok(NotebookInfo {
        name: new_name.to_string(),
        path: new_rel,
        stack,
        note_count,
    })
}

/// Deletes a notebook (soft-deletes to .trash/).
pub fn delete_notebook(vault_path: &str, notebook_rel_path: &str) -> Result<bool, String> {
    soft_delete_dir(vault_path, notebook_rel_path)
}

/// Moves a notebook to a different stack (or to vault root if `target_stack` is None).
pub fn move_notebook(
    vault_path: &str,
    notebook_rel_path: &str,
    target_stack: Option<&str>,
) -> Result<NotebookInfo, String> {
    let resolved = resolve_vault_path(vault_path);
    let src = resolved.join(notebook_rel_path);

    let notebook_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid notebook path")?
        .to_string();

    let dest_parent = if let Some(stack) = target_stack {
        let stack_dir = resolved.join(stack);
        fs::create_dir_all(&stack_dir).map_err(|e| e.to_string())?;
        stack_dir
    } else {
        resolved.clone()
    };

    let dest = dest_parent.join(&notebook_name);
    fs::rename(&src, &dest).map_err(|e| e.to_string())?;

    let new_rel = dest
        .strip_prefix(&resolved)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    let note_count = count_md_files(&dest);

    Ok(NotebookInfo {
        name: notebook_name,
        path: new_rel,
        stack: target_stack.map(|s| s.to_string()),
        note_count,
    })
}

/// Lists all notebooks in the vault.
/// A "notebook" is any directory one level below vault root (or two levels deep
/// for stacked notebooks). Directories in SKIP_DIRS are excluded.
pub fn list_notebooks(vault_path: &str) -> Result<Vec<NotebookInfo>, String> {
    let resolved = resolve_vault_path(vault_path);
    let ignore_patterns = read_ignore_patterns(&resolved);
    let mut notebooks = Vec::new();

    let entries = fs::read_dir(&resolved).map_err(|e| e.to_string())?;

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
            continue;
        }
        if is_ignored(&ignore_patterns, &name) {
            continue;
        }

        // Check if this looks like a stack (contains sub-directories with notes)
        // vs a direct notebook.
        let sub_dirs: Vec<_> = fs::read_dir(&path)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| e.path().is_dir() && !e.file_name().to_str().unwrap_or("").starts_with('.'))
                    .collect()
            })
            .unwrap_or_default();

        let direct_notes = count_md_files(&path);

        if direct_notes > 0 || sub_dirs.is_empty() {
            // Treat as a direct notebook
            notebooks.push(NotebookInfo {
                name: name.clone(),
                path: name.clone(),
                stack: None,
                note_count: direct_notes,
            });
        }

        // Also list any stacked sub-notebooks
        for sub_entry in sub_dirs {
            let sub_path = sub_entry.path();
            let sub_name = sub_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let sub_rel = format!("{}/{}", name, sub_name);
            if is_ignored(&ignore_patterns, &sub_rel) {
                continue;
            }
            let note_count = count_md_files(&sub_path);
            notebooks.push(NotebookInfo {
                name: sub_name,
                path: sub_rel,
                stack: Some(name.clone()),
                note_count,
            });
        }
    }

    notebooks.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(notebooks)
}
