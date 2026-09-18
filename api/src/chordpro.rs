use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SongMetadata {
    pub title: String,
    pub song_number: Option<String>,
    pub authors: String,
    pub language: Option<String>,
}

pub fn metadata(source: &str) -> SongMetadata {
    let mut title = None;
    let mut song_number = None;
    let mut language = None;
    let mut authors = Vec::new();

    for line in source.lines().take(100) {
        let Some((name, value)) = directive(line) else {
            continue;
        };

        match name.as_str() {
            "title" | "t" if title.is_none() => title = Some(value),
            "number" | "song_number" if song_number.is_none() => song_number = Some(value),
            "language" | "lang" if language.is_none() => language = Some(value),
            "artist" | "composer" | "lyricist" | "author" if !value.is_empty() => {
                if !authors.iter().any(|existing| existing == &value) {
                    authors.push(value);
                }
            }
            _ => {}
        }
    }

    SongMetadata {
        title: title
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Untitled song".into()),
        song_number: song_number.filter(|value| !value.is_empty()),
        authors: authors.join(", "),
        language: language.filter(|value| !value.is_empty()),
    }
}

pub fn content_hash(source: &str) -> String {
    hex::encode(Sha256::digest(source.as_bytes()))
}

pub fn export_filename(title: &str, id: uuid::Uuid) -> String {
    let slug = title
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join("-");
    let slug = if slug.is_empty() { "song" } else { &slug };
    format!("{slug}-{}.pro", &id.simple().to_string()[..8])
}

fn directive(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    let inner = line.strip_prefix('{')?.strip_suffix('}')?;
    let (name, value) = inner.split_once(':')?;
    Some((name.trim().to_ascii_lowercase(), value.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_common_metadata() {
        let source = "{title: Great Is Thy Faithfulness}\n{composer: Thomas Chisholm}\n{lyricist: Thomas Chisholm}\n{language: en}\n\nGreat is thy faithfulness";
        let parsed = metadata(source);

        assert_eq!(parsed.title, "Great Is Thy Faithfulness");
        assert_eq!(parsed.authors, "Thomas Chisholm");
        assert_eq!(parsed.language.as_deref(), Some("en"));
    }

    #[test]
    fn creates_stable_hashes() {
        assert_eq!(content_hash("song"), content_hash("song"));
        assert_ne!(content_hash("song"), content_hash("Song"));
    }
}
