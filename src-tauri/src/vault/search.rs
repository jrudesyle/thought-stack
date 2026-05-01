use crate::vault::{
    markdown::parse_frontmatter,
    resolve_vault_path,
    sanitize::title_from_filename,
    SKIP_DIRS, VAULT_META_DIR,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

const CACHE_DB_NAME: &str = "cache.db";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub note_id: String,
    pub title: String,
    pub snippet: String,
    pub notebook: String,
    pub tags: Vec<String>,
    pub modified: String,
    pub rank: f64,
}

fn db_path(vault_path: &str) -> PathBuf {
    resolve_vault_path(vault_path)
        .join(VAULT_META_DIR)
        .join(CACHE_DB_NAME)
}

fn open_db(vault_path: &str) -> Result<Connection, String> {
    let resolved = resolve_vault_path(vault_path);
    let meta_dir = resolved.join(VAULT_META_DIR);
    fs::create_dir_all(&meta_dir).map_err(|e| e.to_string())?;

    let path = meta_dir.join(CACHE_DB_NAME);

    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS notes_index (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            path        TEXT NOT NULL UNIQUE,
            notebook    TEXT NOT NULL,
            body_text   TEXT NOT NULL DEFAULT '',
            tags        TEXT NOT NULL DEFAULT '',
            created     TEXT NOT NULL,
            modified    TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title,
            body_text,
            tags,
            content='notes_index',
            content_rowid='rowid'
        );

        CREATE TRIGGER IF NOT EXISTS notes_index_ai
            AFTER INSERT ON notes_index BEGIN
                INSERT INTO notes_fts(rowid, title, body_text, tags)
                    VALUES (new.rowid, new.title, new.body_text, new.tags);
            END;

        CREATE TRIGGER IF NOT EXISTS notes_index_ad
            AFTER DELETE ON notes_index BEGIN
                INSERT INTO notes_fts(notes_fts, rowid, title, body_text, tags)
                    VALUES('delete', old.rowid, old.title, old.body_text, old.tags);
            END;

        CREATE TRIGGER IF NOT EXISTS notes_index_au
            AFTER UPDATE ON notes_index BEGIN
                INSERT INTO notes_fts(notes_fts, rowid, title, body_text, tags)
                    VALUES('delete', old.rowid, old.title, old.body_text, old.tags);
                INSERT INTO notes_fts(rowid, title, body_text, tags)
                    VALUES (new.rowid, new.title, new.body_text, new.tags);
            END;
        ",
    )
    .map_err(|e| e.to_string())?;

    Ok(conn)
}

/// Searches the FTS5 index for notes matching `query`.
pub fn query_index(
    vault_path: &str,
    query: &str,
    notebook_filter: Option<&str>,
    tag_filter: Option<&str>,
) -> Result<Vec<SearchResult>, String> {
    let conn = open_db(vault_path)?;

    let fts_query = format!("{}*", query.replace('\'', "''"));

    let sql = if notebook_filter.is_some() || tag_filter.is_some() {
        "SELECT ni.id, ni.title, ni.path, ni.notebook, ni.tags, ni.modified,
                snippet(notes_fts, 1, '<b>', '</b>', '…', 20) AS snip,
                notes_fts.rank AS rank
         FROM notes_fts
         JOIN notes_index ni ON notes_fts.rowid = ni.rowid
         WHERE notes_fts MATCH ?1
           AND (?2 IS NULL OR ni.notebook = ?2)
           AND (?3 IS NULL OR ni.tags LIKE ?4)
         ORDER BY rank
         LIMIT 50"
    } else {
        "SELECT ni.id, ni.title, ni.path, ni.notebook, ni.tags, ni.modified,
                snippet(notes_fts, 1, '<b>', '</b>', '…', 20) AS snip,
                notes_fts.rank AS rank
         FROM notes_fts
         JOIN notes_index ni ON notes_fts.rowid = ni.rowid
         WHERE notes_fts MATCH ?1
         ORDER BY rank
         LIMIT 50"
    };

    let tag_like = tag_filter.map(|t| format!("%{}%", t));

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let results = if notebook_filter.is_some() || tag_filter.is_some() {
        stmt.query_map(
            params![
                fts_query,
                notebook_filter,
                tag_filter,
                tag_like.as_deref()
            ],
            row_to_result,
        )
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map(params![fts_query], row_to_result)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect()
    };

    Ok(results)
}

fn row_to_result(row: &rusqlite::Row) -> rusqlite::Result<SearchResult> {
    let tags_str: String = row.get(4)?;
    let tags: Vec<String> = if tags_str.is_empty() {
        vec![]
    } else {
        tags_str.split(',').map(|s| s.trim().to_string()).collect()
    };
    let rank: f64 = row.get(7)?;

    Ok(SearchResult {
        note_id: row.get(0)?,
        title: row.get(1)?,
        snippet: row.get(6)?,
        notebook: row.get(3)?,
        tags,
        modified: row.get(5)?,
        rank: -rank, // FTS5 rank is negative; negate for ascending relevance
    })
}

/// Rebuilds the entire FTS5 index from the vault's Markdown files.
pub fn rebuild_index(vault_path: &str) -> Result<usize, String> {
    // Delete and recreate db to start fresh
    let path = db_path(vault_path);
    if path.exists() {
        let _ = fs::remove_file(&path);
    }

    let conn = open_db(vault_path)?;
    let resolved = resolve_vault_path(vault_path);
    let mut count = 0usize;

    for entry in walkdir::WalkDir::new(&resolved)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_str().unwrap_or("");
            !SKIP_DIRS.contains(&name)
        })
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let file_path = entry.path();
        if file_path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if file_path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }

        if let Ok(content) = fs::read_to_string(file_path) {
            let parsed = parse_frontmatter(&content);
            let rel = file_path
                .strip_prefix(&resolved)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let notebook = file_path
                .strip_prefix(&resolved)
                .ok()
                .and_then(|p| p.parent())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let title = title_from_filename(
                file_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(""),
            );
            let tags = parsed.data.tags.join(", ");

            let _ = conn.execute(
                "INSERT OR REPLACE INTO notes_index
                    (id, title, path, notebook, body_text, tags, created, modified)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    parsed.data.id,
                    title,
                    rel,
                    notebook,
                    parsed.content,
                    tags,
                    parsed.data.created,
                    parsed.data.modified,
                ],
            );
            count += 1;
        }
    }

    // Optimize the FTS5 index
    let _ = conn.execute("INSERT INTO notes_fts(notes_fts) VALUES('optimize')", []);

    Ok(count)
}

/// Indexes or updates a single note in the search index.
pub fn index_note(
    vault_path: &str,
    note_id: &str,
    title: &str,
    rel_path: &str,
    notebook: &str,
    body_text: &str,
    tags: &[String],
    created: &str,
    modified: &str,
) -> Result<(), String> {
    let conn = open_db(vault_path)?;
    let tags_str = tags.join(", ");
    conn.execute(
        "INSERT OR REPLACE INTO notes_index
            (id, title, path, notebook, body_text, tags, created, modified)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            note_id, title, rel_path, notebook, body_text, tags_str, created, modified,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Removes a note from the search index by its path.
pub fn remove_from_index(vault_path: &str, rel_path: &str) -> Result<(), String> {
    let conn = open_db(vault_path)?;
    conn.execute("DELETE FROM notes_index WHERE path = ?1", params![rel_path])
        .map_err(|e| e.to_string())?;
    Ok(())
}
