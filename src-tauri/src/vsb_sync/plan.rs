//! Pure three-way planning: VSB rows, ChordPro files and the hashes recorded
//! at the previous sync decide which side changed and what to do about it.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::import::mdb::VsbSongRow;

/// One song known to both sides at the end of the previous sync.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Link {
    pub song_id: i64,
    pub filename: String,
    pub row_hash: String,
    pub file_hash: String,
}

/// A ChordPro file as the planner sees it.
#[derive(Debug, Clone)]
pub struct FileSnapshot {
    pub filename: String,
    pub hash: String,
    pub vsb_song_id: Option<i64>,
    pub title: String,
    pub song_num: Option<i64>,
    /// ChordPro that `convert_song` would write for the matching row, when
    /// the caller could compute it; used to recognise songs already in step.
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Linked songs that are unchanged, or newly paired and identical.
    Keep(Link),
    /// Pair found on first contact whose contents differ; neither side is touched.
    LinkDiffering(Link),
    WriteFile {
        song_id: i64,
        filename: String,
    },
    CreateFile {
        song_id: i64,
    },
    DeleteFile {
        filename: String,
    },
    WriteRow {
        song_id: i64,
        filename: String,
        conflict: bool,
    },
    InsertRow {
        filename: String,
    },
    DeleteRow {
        song_id: i64,
    },
}

pub struct PlanInput<'a> {
    pub rows: &'a [VsbSongRow],
    pub row_hashes: &'a HashMap<i64, String>,
    pub files: &'a [FileSnapshot],
    pub links: &'a [Link],
    /// ChordPro `convert_song` produces for a row, keyed by song id.
    pub converted: &'a HashMap<i64, String>,
}

pub fn plan(input: PlanInput<'_>) -> Vec<Action> {
    let rows: HashMap<i64, &VsbSongRow> = input.rows.iter().map(|r| (r.song_id, r)).collect();
    let files: HashMap<&str, &FileSnapshot> = input
        .files
        .iter()
        .map(|f| (f.filename.as_str(), f))
        .collect();
    let mut used_rows: HashSet<i64> = HashSet::new();
    let mut used_files: HashSet<String> = HashSet::new();
    let mut actions = Vec::new();

    for link in input.links {
        let file = files
            .get(link.filename.as_str())
            .copied()
            .or_else(|| renamed_file(input.files, link, &used_files, input.links));
        let row = rows.get(&link.song_id).copied();
        used_rows.insert(link.song_id);
        if let Some(file) = file {
            used_files.insert(file.filename.clone());
        }

        match (row, file) {
            (Some(_), Some(file)) => {
                let row_changed = input.row_hashes.get(&link.song_id) != Some(&link.row_hash);
                let file_changed = file.hash != link.file_hash;
                let current = Link {
                    song_id: link.song_id,
                    filename: file.filename.clone(),
                    row_hash: input.row_hashes[&link.song_id].clone(),
                    file_hash: file.hash.clone(),
                };
                match (row_changed, file_changed) {
                    (false, false) => actions.push(Action::Keep(current)),
                    (true, false) => actions.push(Action::WriteFile {
                        song_id: link.song_id,
                        filename: file.filename.clone(),
                    }),
                    (false, true) => actions.push(Action::WriteRow {
                        song_id: link.song_id,
                        filename: file.filename.clone(),
                        conflict: false,
                    }),
                    (true, true) => {
                        if input.converted.get(&link.song_id) == Some(&file.content) {
                            actions.push(Action::Keep(current));
                        } else {
                            // Both edited: the Psalm150 side wins, the VSB file
                            // is backed up before any write.
                            actions.push(Action::WriteRow {
                                song_id: link.song_id,
                                filename: file.filename.clone(),
                                conflict: true,
                            });
                        }
                    }
                }
            }
            (None, Some(file)) => {
                if file.hash == link.file_hash {
                    actions.push(Action::DeleteFile {
                        filename: file.filename.clone(),
                    });
                } else {
                    actions.push(Action::InsertRow {
                        filename: file.filename.clone(),
                    });
                }
            }
            (Some(_), None) => {
                if input.row_hashes.get(&link.song_id) == Some(&link.row_hash) {
                    actions.push(Action::DeleteRow {
                        song_id: link.song_id,
                    });
                } else {
                    actions.push(Action::CreateFile {
                        song_id: link.song_id,
                    });
                }
            }
            (None, None) => {}
        }
    }

    // First contact: pair unlinked rows and files by the vsb_song_id the
    // importer writes, then by title and number when that is unambiguous.
    let unlinked_rows: Vec<&VsbSongRow> = input
        .rows
        .iter()
        .filter(|row| !used_rows.contains(&row.song_id))
        .collect();
    let mut unlinked_files: Vec<&FileSnapshot> = input
        .files
        .iter()
        .filter(|file| !used_files.contains(&file.filename))
        .collect();

    let pair = |row: &VsbSongRow, file: &FileSnapshot, actions: &mut Vec<Action>| {
        let link = Link {
            song_id: row.song_id,
            filename: file.filename.clone(),
            row_hash: input.row_hashes[&row.song_id].clone(),
            file_hash: file.hash.clone(),
        };
        if input.converted.get(&row.song_id) == Some(&file.content) {
            actions.push(Action::Keep(link));
        } else {
            actions.push(Action::LinkDiffering(link));
        }
    };

    let mut remaining_rows = Vec::new();
    for row in unlinked_rows {
        let by_id = unlinked_files
            .iter()
            .position(|file| file.vsb_song_id == Some(row.song_id));
        if let Some(index) = by_id {
            let file = unlinked_files.remove(index);
            pair(row, file, &mut actions);
        } else {
            remaining_rows.push(row);
        }
    }

    let title_key = |title: &str, num: Option<i64>| (title.trim().to_lowercase(), num);
    let mut row_counts: HashMap<(String, Option<i64>), usize> = HashMap::new();
    for row in &remaining_rows {
        *row_counts
            .entry(title_key(&row.title, Some(row.song_num)))
            .or_default() += 1;
    }
    let mut file_counts: HashMap<(String, Option<i64>), usize> = HashMap::new();
    for file in &unlinked_files {
        *file_counts
            .entry(title_key(&file.title, file.song_num))
            .or_default() += 1;
    }

    for row in remaining_rows {
        let key = title_key(&row.title, Some(row.song_num));
        let unique = row_counts.get(&key) == Some(&1) && file_counts.get(&key) == Some(&1);
        let found = unique
            .then(|| {
                unlinked_files
                    .iter()
                    .position(|file| title_key(&file.title, file.song_num) == key)
            })
            .flatten();
        match found {
            Some(index) => {
                let file = unlinked_files.remove(index);
                pair(row, file, &mut actions);
            }
            None => actions.push(Action::CreateFile {
                song_id: row.song_id,
            }),
        }
    }
    for file in unlinked_files {
        actions.push(Action::InsertRow {
            filename: file.filename.clone(),
        });
    }
    actions
}

/// A linked file may have been renamed: the server appends a stable id to
/// its export names, and imported files carry `vsb_song_id`.
fn renamed_file<'a>(
    files: &'a [FileSnapshot],
    link: &Link,
    used: &HashSet<String>,
    links: &[Link],
) -> Option<&'a FileSnapshot> {
    let linked_name = |name: &str| links.iter().any(|l| l.filename == name);
    let candidates = files
        .iter()
        .filter(|file| !used.contains(&file.filename) && !linked_name(&file.filename));
    if let Some(suffix) = server_id_suffix(&link.filename) {
        if let Some(file) = candidates
            .clone()
            .find(|file| server_id_suffix(&file.filename) == Some(suffix))
        {
            return Some(file);
        }
    }
    candidates
        .clone()
        .find(|file| file.vsb_song_id == Some(link.song_id))
}

fn server_id_suffix(filename: &str) -> Option<&str> {
    let stem = filename.strip_suffix(".pro")?;
    let (_, suffix) = stem.rsplit_once('-')?;
    (suffix.len() == 8 && suffix.chars().all(|c| c.is_ascii_hexdigit())).then_some(suffix)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: i64, title: &str) -> VsbSongRow {
        VsbSongRow {
            song_id: id,
            song_num: id,
            title: title.into(),
            body: "x".into(),
            key: None,
            author: None,
            copyright: None,
            category_id: 0,
        }
    }

    fn file(
        name: &str,
        hash: &str,
        id: Option<i64>,
        title: &str,
        num: Option<i64>,
    ) -> FileSnapshot {
        FileSnapshot {
            filename: name.into(),
            hash: hash.into(),
            vsb_song_id: id,
            title: title.into(),
            song_num: num,
            content: format!("content-{hash}"),
        }
    }

    fn link(id: i64, name: &str, row_hash: &str, file_hash: &str) -> Link {
        Link {
            song_id: id,
            filename: name.into(),
            row_hash: row_hash.into(),
            file_hash: file_hash.into(),
        }
    }

    fn run(
        rows: &[VsbSongRow],
        hashes: &[(i64, &str)],
        files: &[FileSnapshot],
        links: &[Link],
        converted: &[(i64, &str)],
    ) -> Vec<Action> {
        let row_hashes = hashes.iter().map(|(id, h)| (*id, h.to_string())).collect();
        let converted = converted
            .iter()
            .map(|(id, c)| (*id, c.to_string()))
            .collect();
        plan(PlanInput {
            rows,
            row_hashes: &row_hashes,
            files,
            links,
            converted: &converted,
        })
    }

    #[test]
    fn one_sided_edits_flow_to_the_other_side() {
        let rows = [row(1, "A"), row(2, "B")];
        let files = [
            file("a.pro", "fa", Some(1), "A", Some(1)),
            file("b.pro", "fb2", Some(2), "B", Some(2)),
        ];
        let links = [link(1, "a.pro", "ra", "fa"), link(2, "b.pro", "rb", "fb")];
        let actions = run(&rows, &[(1, "ra2"), (2, "rb")], &files, &links, &[]);
        assert_eq!(
            actions,
            vec![
                Action::WriteFile {
                    song_id: 1,
                    filename: "a.pro".into()
                },
                Action::WriteRow {
                    song_id: 2,
                    filename: "b.pro".into(),
                    conflict: false
                },
            ]
        );
    }

    #[test]
    fn deletions_only_propagate_when_the_survivor_is_unchanged() {
        let rows = [row(2, "B")];
        let files = [file("a.pro", "fa", Some(1), "A", Some(1))];
        let links = [link(1, "a.pro", "ra", "fa"), link(2, "b.pro", "rb", "fb")];
        let actions = run(&rows, &[(2, "rb")], &files, &links, &[]);
        assert_eq!(
            actions,
            vec![
                Action::DeleteFile {
                    filename: "a.pro".into()
                },
                Action::DeleteRow { song_id: 2 },
            ]
        );

        let actions = run(&rows, &[(2, "rb-edited")], &files[..0], &links[1..], &[]);
        assert_eq!(actions, vec![Action::CreateFile { song_id: 2 }]);
    }

    #[test]
    fn both_sides_edited_resolves_to_psalm150_unless_identical() {
        let rows = [row(1, "A")];
        let files = [file("a.pro", "fa2", Some(1), "A", Some(1))];
        let links = [link(1, "a.pro", "ra", "fa")];
        let actions = run(&rows, &[(1, "ra2")], &files, &links, &[]);
        assert!(matches!(
            actions[0],
            Action::WriteRow { conflict: true, .. }
        ));

        let actions = run(&rows, &[(1, "ra2")], &files, &links, &[(1, "content-fa2")]);
        assert!(matches!(actions[0], Action::Keep(_)));
    }

    #[test]
    fn first_contact_pairs_by_id_then_unique_title() {
        let rows = [row(1, "A"), row(2, "Same"), row(3, "New in VSB")];
        let files = [
            file("x.pro", "fx", Some(1), "Renamed", None),
            file("same.pro", "fs", None, "same ", Some(2)),
            file("local.pro", "fl", None, "Only local", None),
        ];
        let actions = run(
            &rows,
            &[(1, "r1"), (2, "r2"), (3, "r3")],
            &files,
            &[],
            &[(1, "content-fx")],
        );
        assert_eq!(
            actions,
            vec![
                Action::Keep(link(1, "x.pro", "r1", "fx")),
                Action::LinkDiffering(link(2, "same.pro", "r2", "fs")),
                Action::CreateFile { song_id: 3 },
                Action::InsertRow {
                    filename: "local.pro".into()
                },
            ]
        );
    }

    #[test]
    fn server_renames_keep_the_link() {
        let rows = [row(1, "A")];
        let files = [file(
            "new-title-1a2b3c4d.pro",
            "fa",
            None,
            "New title",
            None,
        )];
        let links = [link(1, "old-title-1a2b3c4d.pro", "ra", "fa")];
        let actions = run(&rows, &[(1, "ra")], &files, &links, &[]);
        assert_eq!(
            actions,
            vec![Action::Keep(link(1, "new-title-1a2b3c4d.pro", "ra", "fa"))]
        );
    }
}
