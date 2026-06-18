use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::library::chordpro::ParsedSong;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateWarning {
    pub kind: String,
    pub message: String,
    pub filenames: Vec<String>,
}

pub fn find_duplicates(songs: &[ParsedSong]) -> Vec<DuplicateWarning> {
    let mut warnings = Vec::new();
    let mut by_num: HashMap<i64, Vec<String>> = HashMap::new();
    let mut by_title: HashMap<String, Vec<String>> = HashMap::new();

    for song in songs {
        if let Some(num) = song.meta.song_num {
            by_num
                .entry(num)
                .or_default()
                .push(song.meta.filename.clone());
        }
        by_title
            .entry(song.meta.title.to_lowercase())
            .or_default()
            .push(song.meta.filename.clone());
    }

    for (num, files) in by_num {
        if files.len() > 1 {
            warnings.push(DuplicateWarning {
                kind: "song_num".into(),
                message: format!("Duplicate song number {num}"),
                filenames: files,
            });
        }
    }

    for (title, files) in by_title {
        if files.len() > 1 {
            warnings.push(DuplicateWarning {
                kind: "title".into(),
                message: format!("Duplicate title '{title}'"),
                filenames: files,
            });
        }
    }

    warnings
}
