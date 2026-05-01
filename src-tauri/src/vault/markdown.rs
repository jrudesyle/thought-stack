use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontmatterData {
    pub id: String,
    pub tags: Vec<String>,
    pub created: String,
    pub modified: String,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct ParsedNote {
    pub data: FrontmatterData,
    pub content: String,
}

/// Parses YAML frontmatter from a Markdown file's content.
/// Returns an empty FrontmatterData if frontmatter is missing or malformed.
pub fn parse_frontmatter(file_content: &str) -> ParsedNote {
    if file_content.starts_with("---") {
        if let Some(end) = file_content[3..].find("\n---") {
            let yaml_str = &file_content[3..end + 3];
            let body_start = end + 3 + 4; // skip closing \n---
            let content = if body_start < file_content.len() {
                file_content[body_start..].trim_start_matches('\n').to_string()
            } else {
                String::new()
            };

            let data = parse_yaml_frontmatter(yaml_str);
            return ParsedNote { data, content };
        }
    }

    ParsedNote {
        data: FrontmatterData {
            id: String::new(),
            tags: Vec::new(),
            created: String::new(),
            modified: String::new(),
            extra: HashMap::new(),
        },
        content: file_content.to_string(),
    }
}

fn parse_yaml_frontmatter(yaml_str: &str) -> FrontmatterData {
    let value: serde_yaml::Value = serde_yaml::from_str(yaml_str).unwrap_or(serde_yaml::Value::Null);
    let map = match &value {
        serde_yaml::Value::Mapping(m) => m,
        _ => {
            return FrontmatterData {
                id: String::new(),
                tags: Vec::new(),
                created: String::new(),
                modified: String::new(),
                extra: HashMap::new(),
            }
        }
    };

    let get_str = |key: &str| -> String {
        map.get(serde_yaml::Value::String(key.to_string()))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    let tags: Vec<String> = map
        .get(serde_yaml::Value::String("tags".to_string()))
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    // Collect extra unknown fields as serde_json::Value (skip known keys)
    let known = ["id", "tags", "created", "modified"];
    let mut extra = HashMap::new();
    for (k, v) in map.iter() {
        if let serde_yaml::Value::String(key) = k {
            if !known.contains(&key.as_str()) {
                if let Ok(json_val) = serde_json::to_value(v) {
                    extra.insert(key.clone(), json_val);
                }
            }
        }
    }

    FrontmatterData {
        id: get_str("id"),
        tags,
        created: get_str("created"),
        modified: get_str("modified"),
        extra,
    }
}

/// Serializes a note back to Markdown with YAML frontmatter.
pub fn serialize_note(
    id: &str,
    tags: &[String],
    created: &str,
    modified: &str,
    content: &str,
    extra: &HashMap<String, serde_json::Value>,
) -> String {
    let mut yaml = format!(
        "id: {}\ntags:\n{}\ncreated: '{}'\nmodified: '{}'",
        id,
        tags.iter()
            .map(|t| format!("  - {}", t))
            .collect::<Vec<_>>()
            .join("\n"),
        created,
        modified,
    );

    // Append extra preserved fields
    for (key, val) in extra {
        if let Ok(s) = serde_yaml::to_string(val) {
            yaml.push_str(&format!("\n{}: {}", key, s.trim()));
        }
    }

    if content.is_empty() {
        format!("---\n{}\n---\n", yaml)
    } else {
        format!("---\n{}\n---\n\n{}", yaml, content)
    }
}
