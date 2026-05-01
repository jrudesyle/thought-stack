use crate::vault::resolve_vault_path;
use std::fs;

const IMAGES_DIR: &str = ".images";

static MIME_TO_EXT: &[(&str, &str)] = &[
    ("image/png", ".png"),
    ("image/jpeg", ".jpg"),
    ("image/gif", ".gif"),
    ("image/webp", ".webp"),
];

fn mime_to_ext(mime: &str) -> &'static str {
    MIME_TO_EXT
        .iter()
        .find(|(m, _)| *m == mime)
        .map(|(_, e)| *e)
        .unwrap_or(".png")
}

fn generate_image_filename(mime_type: &str) -> String {
    let ext = mime_to_ext(mime_type);
    let id = uuid::Uuid::new_v4().to_string().replace('-', "");
    format!("{}{}", &id[..12], ext)
}

/// Saves image bytes to `.images/` inside the notebook directory.
/// Returns the relative path for use in Markdown: `.images/abc123.png`
pub fn save_image(
    vault_path: &str,
    notebook: &str,
    image_data: &[u8],
    mime_type: &str,
) -> Result<String, String> {
    let resolved = resolve_vault_path(vault_path);
    let images_dir = resolved.join(notebook).join(IMAGES_DIR);
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let filename = generate_image_filename(mime_type);
    let file_path = images_dir.join(&filename);
    fs::write(&file_path, image_data).map_err(|e| e.to_string())?;

    Ok(format!("{}/{}", IMAGES_DIR, filename))
}

/// Extracts image filenames referenced in Markdown content.
/// Matches `![alt](.images/filename)` patterns.
pub fn extract_image_references(markdown_content: &str) -> Vec<String> {
    use regex::Regex;
    let re = Regex::new(r"!\[[^\]]*\]\(\.images/([^)]+)\)").expect("valid regex");
    re.captures_iter(markdown_content)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
        .collect()
}

/// Moves image files from one notebook's `.images/` to another's.
pub fn move_images(
    vault_path: &str,
    source_notebook: &str,
    target_notebook: &str,
    filenames: &[String],
) -> Vec<String> {
    if filenames.is_empty() {
        return vec![];
    }

    let resolved = resolve_vault_path(vault_path);
    let src_dir = resolved.join(source_notebook).join(IMAGES_DIR);
    let dest_dir = resolved.join(target_notebook).join(IMAGES_DIR);

    let _ = fs::create_dir_all(&dest_dir);

    let mut moved = Vec::new();

    for filename in filenames {
        let src = src_dir.join(filename);
        let dest = dest_dir.join(filename);

        if src.exists() {
            if dest.exists() {
                moved.push(filename.clone());
                continue;
            }
            if fs::rename(&src, &dest).is_ok() {
                moved.push(filename.clone());
            }
        }
    }

    moved
}
