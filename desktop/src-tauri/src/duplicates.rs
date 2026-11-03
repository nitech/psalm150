use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;

use serde::{Deserialize, Serialize};

use crate::library::chordpro::ParsedSong;
use crate::library::files::content_hash;

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
        if let Some(num) = song.meta.song_num.filter(|num| *num > 0) {
            by_num
                .entry(num)
                .or_default()
                .push(song.meta.filename.clone());
        }
        let title = normalize(&song.meta.title);
        if !title.is_empty() {
            by_title
                .entry(title)
                .or_default()
                .push(song.meta.filename.clone());
        }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCandidate {
    pub filename: String,
    pub title: String,
    pub song_num: Option<i64>,
    pub key: Option<String>,
    pub modified_at: Option<String>,
    pub content_hash: String,
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub id: String,
    pub reasons: Vec<String>,
    pub candidates: Vec<DuplicateCandidate>,
    pub reviewed: bool,
}

pub fn review_pair_id(left_hash: &str, right_hash: &str) -> String {
    let mut hashes = [left_hash, right_hash];
    hashes.sort();
    content_hash(&format!("{}\n{}", hashes[0], hashes[1]))
}

fn normalize(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn normalized_lyrics(song: &ParsedSong) -> String {
    normalize(
        &song
            .sections
            .iter()
            .flat_map(|section| section.lines.iter().map(|line| line.text.as_str()))
            .collect::<Vec<_>>()
            .join(" "),
    )
}

fn find_root(parent: &mut [usize], mut index: usize) -> usize {
    while parent[index] != index {
        parent[index] = parent[parent[index]];
        index = parent[index];
    }
    index
}

fn union(parent: &mut [usize], left: usize, right: usize) {
    let left = find_root(parent, left);
    let right = find_root(parent, right);
    if left != right {
        parent[right] = left;
    }
}

fn add_matches(
    values: impl IntoIterator<Item = (String, usize)>,
    reason: &str,
    parent: &mut [usize],
    pair_reasons: &mut HashMap<(usize, usize), BTreeSet<String>>,
) {
    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (value, index) in values {
        if !value.is_empty() {
            groups.entry(value).or_default().push(index);
        }
    }
    for indexes in groups.into_values().filter(|indexes| indexes.len() > 1) {
        for left_pos in 0..indexes.len() {
            for right_pos in (left_pos + 1)..indexes.len() {
                let left = indexes[left_pos].min(indexes[right_pos]);
                let right = indexes[left_pos].max(indexes[right_pos]);
                union(parent, left, right);
                pair_reasons
                    .entry((left, right))
                    .or_default()
                    .insert(reason.to_string());
            }
        }
    }
}

pub fn find_duplicate_groups(
    songs: &[ParsedSong],
    reviewed_ids: &HashSet<String>,
) -> Vec<DuplicateGroup> {
    let mut parent = (0..songs.len()).collect::<Vec<_>>();
    let mut pair_reasons: HashMap<(usize, usize), BTreeSet<String>> = HashMap::new();

    add_matches(
        songs.iter().enumerate().filter_map(|(index, song)| {
            song.meta
                .song_num
                .filter(|num| *num > 0)
                .map(|num| (num.to_string(), index))
        }),
        "Same song number",
        &mut parent,
        &mut pair_reasons,
    );
    add_matches(
        songs
            .iter()
            .enumerate()
            .map(|(index, song)| (normalize(&song.meta.title), index)),
        "Same normalized title",
        &mut parent,
        &mut pair_reasons,
    );
    add_matches(
        songs
            .iter()
            .enumerate()
            .map(|(index, song)| (normalized_lyrics(song), index)),
        "Identical lyrics without chords",
        &mut parent,
        &mut pair_reasons,
    );

    let mut members: HashMap<usize, Vec<usize>> = HashMap::new();
    for index in 0..songs.len() {
        let root = find_root(&mut parent, index);
        members.entry(root).or_default().push(index);
    }

    let mut groups = members
        .into_values()
        .filter(|members| members.len() > 1)
        .map(|members| {
            let member_set = members.iter().copied().collect::<HashSet<_>>();
            let reasons = pair_reasons
                .iter()
                .filter(|((left, right), _)| {
                    member_set.contains(left) && member_set.contains(right)
                })
                .flat_map(|(_, reasons)| reasons.iter().cloned())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            let mut candidates = members
                .into_iter()
                .map(|index| {
                    let song = &songs[index];
                    DuplicateCandidate {
                        filename: song.meta.filename.clone(),
                        title: song.meta.title.clone(),
                        song_num: song.meta.song_num,
                        key: song.meta.key.clone(),
                        modified_at: song.meta.modified_at.clone(),
                        content_hash: content_hash(&song.raw),
                        raw: song.raw.clone(),
                    }
                })
                .collect::<Vec<_>>();
            candidates.sort_by(|a, b| a.filename.cmp(&b.filename));
            let identity = candidates
                .iter()
                .map(|candidate| format!("{}:{}", candidate.filename, candidate.content_hash))
                .collect::<Vec<_>>()
                .join("\n");
            let id = content_hash(&identity);
            let reviewed = candidates.iter().enumerate().all(|(left, candidate)| {
                candidates.iter().skip(left + 1).all(|other| {
                    reviewed_ids.contains(&review_pair_id(
                        &candidate.content_hash,
                        &other.content_hash,
                    ))
                })
            });
            DuplicateGroup {
                reviewed,
                id,
                reasons,
                candidates,
            }
        })
        .collect::<Vec<_>>();
    groups.sort_by(|a, b| a.candidates[0].filename.cmp(&b.candidates[0].filename));
    groups
}

fn reviews_path(app: &tauri::AppHandle, folder_hash: &str) -> Result<std::path::PathBuf, String> {
    Ok(crate::config::library_root(app, folder_hash)?.join("duplicate-reviews.json"))
}

pub fn load_reviews(app: &tauri::AppHandle, folder_hash: &str) -> Result<HashSet<String>, String> {
    let path = reviews_path(app, folder_hash)?;
    if !path.exists() {
        return Ok(HashSet::new());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn mark_reviewed(
    app: &tauri::AppHandle,
    folder_hash: &str,
    group_id: &str,
) -> Result<(), String> {
    let path = reviews_path(app, folder_hash)?;
    let mut reviews = load_reviews(app, folder_hash)?;
    reviews.insert(group_id.to_string());
    fs::write(
        path,
        serde_json::to_vec_pretty(&reviews).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod group_tests {
    use super::*;
    use crate::library::chordpro::parse_chordpro;

    #[test]
    fn overlapping_matches_form_one_group_and_empty_values_do_not_match() {
        let songs = vec![
            parse_chordpro("{title: Same}\n{meta: song_num=1}\n[C]Hello world", "a.pro"),
            parse_chordpro("{title: same}\n{meta: song_num=2}\n[D]Different", "b.pro"),
            parse_chordpro("{title: Third}\n{meta: song_num=2}\n[E]More", "c.pro"),
            parse_chordpro("{title: }\n", "empty-a.pro"),
            parse_chordpro("{title: }\n", "empty-b.pro"),
        ];
        let groups = find_duplicate_groups(&songs, &HashSet::new());
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].candidates.len(), 3);
        assert!(groups[0].reasons.contains(&"Same song number".to_string()));
        assert!(groups[0]
            .reasons
            .contains(&"Same normalized title".to_string()));
    }

    #[test]
    fn lyrics_ignore_chords_and_whitespace() {
        let songs = vec![
            parse_chordpro("{title: A}\n[C]Hello   world", "a.pro"),
            parse_chordpro("{title: B}\n[D]hello world", "b.pro"),
        ];
        let groups = find_duplicate_groups(&songs, &HashSet::new());
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].reasons, vec!["Identical lyrics without chords"]);
    }
}
