use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SongMeta {
    pub filename: String,
    pub title: String,
    pub song_num: Option<i64>,
    pub vsb_song_id: Option<i64>,
    pub key: Option<String>,
    pub alt_keys: Option<String>,
    pub category: Option<String>,
    pub artist: Option<String>,
    pub copyright: Option<String>,
    pub ccli: Option<String>,
    pub tags: Option<String>,
    pub arrangement: Option<String>,
    pub base_song: Option<String>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedSong {
    pub meta: SongMeta,
    pub raw: String,
    pub sections: Vec<SongSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongSection {
    pub label: String,
    pub kind: SectionKind,
    pub lines: Vec<LyricLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SectionKind {
    Verse,
    Chorus,
    Bridge,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricLine {
    pub text: String,
    pub chords: Vec<ChordPlacement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChordPlacement {
    pub chord: String,
    pub position: usize,
}

pub fn parse_chordpro(content: &str, filename: &str) -> ParsedSong {
    let mut title = filename.to_string();
    let mut key = None;
    let mut song_num = None;
    let mut vsb_song_id = None;
    let mut category = None;
    let mut artist = None;
    let mut copyright = None;
    let mut ccli = None;
    let mut tags = None;
    let mut alt_keys = None;
    let mut arrangement = None;
    let mut base_song = None;

    let mut sections: Vec<SongSection> = Vec::new();
    let mut current_label = "Verse".to_string();
    let mut current_kind = SectionKind::Verse;
    let mut current_lines: Vec<LyricLine> = Vec::new();

    let mut flush_section = |sections: &mut Vec<SongSection>,
                             label: &mut String,
                             kind: &mut SectionKind,
                             lines: &mut Vec<LyricLine>| {
        if !lines.is_empty() {
            sections.push(SongSection {
                label: label.clone(),
                kind: kind.clone(),
                lines: std::mem::take(lines),
            });
        }
    };

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            current_lines.push(LyricLine {
                text: String::new(),
                chords: vec![],
            });
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
            let (directive, value) = match rest.split_once(':') {
                Some((d, v)) => (d.trim(), Some(v.trim().to_string())),
                None => (rest.trim(), None),
            };
            match directive {
                "title" if value.is_some() => title = value.unwrap(),
                "key" if value.is_some() => key = Some(value.unwrap()),
                "artist" if value.is_some() => artist = Some(value.unwrap()),
                "copyright" if value.is_some() => copyright = Some(value.unwrap()),
                "start_of_verse" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    current_label = "Verse".into();
                    current_kind = SectionKind::Verse;
                }
                "start_of_chorus" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    current_label = "Chorus".into();
                    current_kind = SectionKind::Chorus;
                }
                "start_of_bridge" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    current_label = "Bridge".into();
                    current_kind = SectionKind::Bridge;
                }
                "meta" => {
                    if let Some(raw) = value {
                        if let Some((k, v)) = raw.split_once('=') {
                            match k.trim() {
                                "song_num" => song_num = v.trim().parse().ok(),
                                "vsb_song_id" => vsb_song_id = v.trim().parse().ok(),
                                "category" => category = Some(v.trim().into()),
                                "ccli" => ccli = Some(v.trim().into()),
                                "tags" => tags = Some(v.trim().into()),
                                "alt_keys" => alt_keys = Some(v.trim().into()),
                                "arrangement" => arrangement = Some(v.trim().into()),
                                "base_song" => base_song = Some(v.trim().into()),
                                _ => {}
                            }
                        }
                    }
                }
                _ => {}
            }
            continue;
        }

        let (text, chords) = parse_chord_line(trimmed);
        current_lines.push(LyricLine { text, chords });
    }

    flush_section(
        &mut sections,
        &mut current_label,
        &mut current_kind,
        &mut current_lines,
    );

    if sections.is_empty() {
        sections.push(SongSection {
            label: "Song".into(),
            kind: SectionKind::Other,
            lines: content
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(|l| LyricLine {
                    text: l.to_string(),
                    chords: vec![],
                })
                .collect(),
        });
    }

    ParsedSong {
        meta: SongMeta {
            filename: filename.to_string(),
            title,
            song_num,
            vsb_song_id,
            key,
            alt_keys,
            category,
            artist,
            copyright,
            ccli,
            tags,
            arrangement,
            base_song,
            modified_at: None,
        },
        raw: content.to_string(),
        sections,
    }
}

fn parse_chord_line(line: &str) -> (String, Vec<ChordPlacement>) {
    let chord_re = regex::Regex::new(r"\[([^\]]+)\]").unwrap();
    let mut chords = Vec::new();
    let mut text = String::new();
    let mut last = 0;
    for cap in chord_re.captures_iter(line) {
        let m = cap.get(0).unwrap();
        text.push_str(&line[last..m.start()]);
        chords.push(ChordPlacement {
            chord: cap[1].to_string(),
            position: text.chars().count(),
        });
        last = m.end();
    }
    text.push_str(&line[last..]);
    (text, chords)
}

pub fn serialize_chordpro(song: &ParsedSong) -> String {
    let mut out = String::new();
    out.push_str(&format!("{{title: {}}}\n", song.meta.title));
    if let Some(ref key) = song.meta.key {
        out.push_str(&format!("{{key: {key}}}\n"));
    }
    if let Some(num) = song.meta.song_num {
        out.push_str(&format!("{{meta: song_num={num}}}\n"));
    }
    if let Some(id) = song.meta.vsb_song_id {
        out.push_str(&format!("{{meta: vsb_song_id={id}}}\n"));
    }
    if let Some(ref category) = song.meta.category {
        out.push_str(&format!("{{meta: category={category}}}\n"));
    }
    if let Some(ref artist) = song.meta.artist {
        out.push_str(&format!("{{artist: {artist}}}\n"));
    }
    if let Some(ref copyright) = song.meta.copyright {
        out.push_str(&format!("{{copyright: {copyright}}}\n"));
    }
    if let Some(ref ccli) = song.meta.ccli {
        out.push_str(&format!("{{meta: ccli={ccli}}}\n"));
    }
    if let Some(ref tags) = song.meta.tags {
        out.push_str(&format!("{{meta: tags={tags}}}\n"));
    }
    if let Some(ref alt) = song.meta.alt_keys {
        out.push_str(&format!("{{meta: alt_keys={alt}}}\n"));
    }
    if let Some(ref arr) = song.meta.arrangement {
        out.push_str(&format!("{{meta: arrangement={arr}}}\n"));
    }
    if let Some(ref base) = song.meta.base_song {
        out.push_str(&format!("{{meta: base_song={base}}}\n"));
    }

    for section in &song.sections {
        let directive = match section.kind {
            SectionKind::Verse => "start_of_verse",
            SectionKind::Chorus => "start_of_chorus",
            SectionKind::Bridge => "start_of_bridge",
            SectionKind::Other => "start_of_verse",
        };
        out.push_str(&format!("{{{directive}}}\n"));
        for line in &section.lines {
            if line.chords.is_empty() {
                out.push_str(&line.text);
                out.push('\n');
            } else {
                let mut rendered = line.text.clone();
                let mut offset = 0usize;
                for chord in &line.chords {
                    let pos = chord.position + offset;
                    let byte_idx = char_index_to_byte(&rendered, pos);
                    let insert = format!("[{}]", chord.chord);
                    rendered.insert_str(byte_idx, &insert);
                    offset += insert.chars().count();
                }
                out.push_str(&rendered);
                out.push('\n');
            }
        }
        out.push('\n');
    }
    out
}

fn char_index_to_byte(s: &str, char_index: usize) -> usize {
    s.char_indices()
        .nth(char_index)
        .map(|(i, _)| i)
        .unwrap_or(s.len())
}

pub fn is_chordpro_filename(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".pro") || lower.ends_with(".cho")
}

pub fn validate_songs_folder(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err("Path is not a directory".into());
    }
    Ok(())
}
