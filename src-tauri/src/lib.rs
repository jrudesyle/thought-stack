mod vault;

use std::sync::Mutex;
use tauri::State;
use vault::{notes, notebooks, trash, images, conflicts, search, settings};

// ── App State ──────────────────────────────────────────────────────────────

pub struct AppState {
    pub vault_path: Mutex<String>,
}

// ── Notes commands ─────────────────────────────────────────────────────────

#[tauri::command]
fn notes_list(
    state: State<AppState>,
    notebook: Option<String>,
    tag: Option<String>,
    trash: Option<bool>,
) -> Result<Vec<notes::NoteSummary>, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    notes::list_notes(
        &vp,
        notebook.as_deref(),
        tag.as_deref(),
        trash.unwrap_or(false),
    )
}

#[tauri::command]
fn notes_get(state: State<AppState>, path: String) -> Result<notes::NoteData, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    notes::get_note(&vp, &path)
}

#[tauri::command]
fn notes_create(
    state: State<AppState>,
    notebook: String,
    title: Option<String>,
) -> Result<notes::NoteData, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    notes::create_note(&vp, &notebook, title.as_deref())
}

#[tauri::command]
fn notes_save(
    state: State<AppState>,
    path: String,
    title: String,
    content: String,
    tags: Vec<String>,
) -> Result<notes::NoteData, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    let result = notes::save_note(&vp, &path, &title, &content, &tags)?;
    // Update search index
    let _ = search::index_note(
        &vp,
        &result.id,
        &result.title,
        &result.path,
        &result.notebook,
        &result.content,
        &result.tags,
        &result.created,
        &result.modified,
    );
    Ok(result)
}

#[tauri::command]
fn notes_delete(state: State<AppState>, path: String) -> Result<bool, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    let result = trash::soft_delete(&vp, &path)?;
    let _ = search::remove_from_index(&vp, &path);
    Ok(result)
}

#[tauri::command]
fn notes_move(
    state: State<AppState>,
    from_path: String,
    to_notebook: String,
) -> Result<notes::NoteData, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    notes::move_note(&vp, &from_path, &to_notebook)
}

#[tauri::command]
fn notes_duplicate(state: State<AppState>, path: String) -> Result<notes::NoteData, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    notes::duplicate_note(&vp, &path)
}

#[tauri::command]
fn notes_restore(
    state: State<AppState>,
    trash_path: String,
    target_notebook: Option<String>,
) -> Result<notes::NoteData, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    trash::restore_note(&vp, &trash_path, target_notebook.as_deref())
}

#[tauri::command]
fn notes_permanent_delete(state: State<AppState>, trash_path: String) -> Result<bool, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    trash::permanent_delete(&vp, &trash_path)
}

#[tauri::command]
fn notes_empty_trash(state: State<AppState>) -> Result<usize, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    trash::empty_trash(&vp)
}

// ── Notebooks commands ─────────────────────────────────────────────────────

#[tauri::command]
fn notebooks_list(state: State<AppState>) -> Result<Vec<notebooks::NotebookInfo>, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    notebooks::list_notebooks(&vp)
}

#[tauri::command]
fn notebooks_create(
    state: State<AppState>,
    name: String,
    stack: Option<String>,
) -> Result<notebooks::NotebookInfo, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    notebooks::create_notebook(&vp, &name, stack.as_deref())
}

#[tauri::command]
fn notebooks_rename(
    state: State<AppState>,
    old_path: String,
    new_name: String,
) -> Result<notebooks::NotebookInfo, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    notebooks::rename_notebook(&vp, &old_path, &new_name)
}

#[tauri::command]
fn notebooks_delete(state: State<AppState>, path: String) -> Result<bool, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    notebooks::delete_notebook(&vp, &path)
}

#[tauri::command]
fn notebooks_move(
    state: State<AppState>,
    path: String,
    target_stack: Option<String>,
) -> Result<notebooks::NotebookInfo, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    notebooks::move_notebook(&vp, &path, target_stack.as_deref())
}

// ── Tags commands ──────────────────────────────────────────────────────────

#[tauri::command]
fn tags_list(state: State<AppState>) -> Result<Vec<notes::TagInfo>, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    notes::list_tags(&vp)
}

#[tauri::command]
fn tags_rename(
    state: State<AppState>,
    old_name: String,
    new_name: String,
) -> Result<usize, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    notes::rename_tag(&vp, &old_name, &new_name)
}

#[tauri::command]
fn tags_autocomplete(state: State<AppState>, prefix: String) -> Result<Vec<notes::TagInfo>, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    notes::autocomplete_tags(&vp, &prefix)
}

// ── Search commands ────────────────────────────────────────────────────────

#[tauri::command]
fn search_query(
    state: State<AppState>,
    q: String,
    notebook: Option<String>,
    tag: Option<String>,
) -> Result<Vec<search::SearchResult>, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    search::query_index(&vp, &q, notebook.as_deref(), tag.as_deref())
}

#[tauri::command]
fn search_rebuild_index(state: State<AppState>) -> Result<usize, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    search::rebuild_index(&vp)
}

// ── System commands ────────────────────────────────────────────────────────

#[tauri::command]
fn system_get_vault_path(state: State<AppState>) -> String {
    state.vault_path.lock().unwrap().clone()
}

#[tauri::command]
fn system_set_vault_path(
    app: tauri::AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<serde_json::Value, String> {
    *state.vault_path.lock().unwrap() = path.clone();

    // On Android, persist the vault path so it survives app restarts.
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        if let Ok(data_dir) = app.path().app_data_dir() {
            let config_file = data_dir.join("vault_path.txt");
            let _ = std::fs::write(&config_file, &path);
            log::info!("Persisted vault path to {:?}", config_file);
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = app; // suppress unused warning on desktop

    Ok(serde_json::json!({ "success": true }))
}

/// Returns the available vault storage locations.
/// On Android: both internal (private) and external (visible in Files app) paths.
/// On desktop: returns empty (desktop uses the folder picker dialog).
#[derive(serde::Serialize)]
struct VaultOptions {
    internal: String,
    external: Option<String>,
}

#[tauri::command]
fn system_get_vault_options(app: tauri::AppHandle) -> Result<VaultOptions, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let internal = data_dir.join("ThoughtStack").to_string_lossy().to_string();

        // External path is always at this predictable location — no permissions needed.
        // MainActivity.kt calls getExternalFilesDir() at startup to ensure the
        // parent directory chain is created by Android before we use it.
        let external = "/sdcard/Android/data/com.thoughtstack.app/files/ThoughtStack".to_string();
        let _ = std::fs::create_dir_all(&external);
        log::info!("vault options — internal: {:?}, external: {:?}", internal, external);

        return Ok(VaultOptions { internal, external: Some(external) });
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(VaultOptions { internal: String::new(), external: None })
    }
}

#[tauri::command]
async fn system_pick_vault_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    // Android doesn't support folder picker dialogs — use app data dir instead.
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let data_dir = app.path().app_data_dir().map_err(|e| {
            log::error!("app_data_dir failed: {e}");
            e.to_string()
        })?;
        let vault = data_dir.join("ThoughtStack");
        log::info!("Android vault path: {:?}", vault);
        std::fs::create_dir_all(&vault).map_err(|e| {
            log::error!("create_dir_all failed: {e}");
            e.to_string()
        })?;
        // Persist immediately so the path survives restarts.
        let vault_str = vault.to_string_lossy().to_string();
        let config_file = data_dir.join("vault_path.txt");
        let _ = std::fs::write(&config_file, &vault_str);
        log::info!("Persisted vault path: {:?}", vault_str);
        return Ok(Some(vault_str));
    }

    // Desktop: show native folder picker.
    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_dialog::DialogExt;
        let folder = app.dialog().file().blocking_pick_folder();
        Ok(folder.map(|p| p.to_string()))
    }
}

#[tauri::command]
fn system_get_settings(state: State<AppState>) -> Result<settings::AppSettings, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    settings::get_settings(&vp)
}

#[tauri::command]
fn system_update_settings(
    state: State<AppState>,
    updates: serde_json::Value,
) -> Result<settings::AppSettings, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    settings::update_settings(&vp, updates)
}

// ── Images commands ────────────────────────────────────────────────────────

#[tauri::command]
fn images_save(
    state: State<AppState>,
    notebook: String,
    image_data: Vec<u8>,
    mime_type: String,
) -> Result<serde_json::Value, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    let rel_path = images::save_image(&vp, &notebook, &image_data, &mime_type)?;
    Ok(serde_json::json!({ "path": rel_path }))
}

// ── Conflicts commands ─────────────────────────────────────────────────────

#[tauri::command]
fn conflicts_detect(state: State<AppState>) -> Result<Vec<conflicts::ConflictFile>, String> {
    let vp = state.vault_path.lock().unwrap().clone();
    conflicts::detect_conflicts(&vp)
}

// ── App entry point ────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "android")]
    android_logger::init_once(
        android_logger::Config::default()
            .with_max_level(log::LevelFilter::Debug)
            .with_tag("thoughtstack"),
    );

    log::info!("thoughtstack run() starting");

    // On Android the vault lives in the app data dir; resolved at runtime via system_pick_vault_folder.
    // On desktop, default to ~/ThoughtStack so first launch works without a picker.
    #[cfg(target_os = "android")]
    let default_vault = String::new(); // Will be set by the JS side on first launch

    #[cfg(not(target_os = "android"))]
    let default_vault = dirs::home_dir()
        .map(|h| h.join("ThoughtStack").to_string_lossy().to_string())
        .unwrap_or_else(|| "~/ThoughtStack".to_string());

    log::info!("default_vault = {:?}", default_vault);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            vault_path: Mutex::new(default_vault),
        })
        .setup(|app| {
            // On Android, load persisted vault path from disk if available.
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                if let Ok(data_dir) = app.path().app_data_dir() {
                    let config_file = data_dir.join("vault_path.txt");
                    if let Ok(saved_path) = std::fs::read_to_string(&config_file) {
                        let saved_path = saved_path.trim().to_string();
                        if !saved_path.is_empty() {
                            log::info!("Loaded persisted vault path: {:?}", saved_path);
                            *app.state::<AppState>().vault_path.lock().unwrap() = saved_path;
                        }
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            notes_list,
            notes_get,
            notes_create,
            notes_save,
            notes_delete,
            notes_move,
            notes_duplicate,
            notes_restore,
            notes_permanent_delete,
            notes_empty_trash,
            notebooks_list,
            notebooks_create,
            notebooks_rename,
            notebooks_delete,
            notebooks_move,
            tags_list,
            tags_rename,
            tags_autocomplete,
            search_query,
            search_rebuild_index,
            system_get_vault_path,
            system_set_vault_path,
            system_pick_vault_folder,
            system_get_vault_options,
            system_get_settings,
            system_update_settings,
            images_save,
            conflicts_detect,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log::error!("tauri run() failed: {e:?}");
            panic!("error while running tauri application: {e:?}");
        });
}
