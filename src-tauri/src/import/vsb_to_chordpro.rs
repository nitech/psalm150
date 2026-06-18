use regex::Regex;
use slug::slugify;

use super::mdb::VsbSongRow;
use crate::library::chordpro::{parse_chordpro, serialize_chordpro, ParsedSong, SectionKind, SongSection};

pub fn convert_song(
    row: &VsbSongRow,
    categories: &[(i64, String)],
) -> Result<(String, String), String> {
    let category = categories
        .iter()
        .find(|(id, _)| *id == row.category_id)
        .map(|(_, name)| name.clone());

    let (key, alt_keys) = parse_keys(row.key.as_deref());
    let filename = format!(
        "{:04}-{}.pro",
        row.song_num,
        {
            let slug = slugify(&row.title);
            if slug.is_empty() {
                "song".into()
            } else {
                slug
            }
        }
    );

    let sections = parse_vsb_body(&row.body);
    let mut song = ParsedSong {
        meta: crate::library::chordpro::SongMeta {
            filename: filename.clone(),
            title: row.title.clone(),
            song_num: Some(row.song_num),
            vsb_song_id: Some(row.song_id),
            key,
            alt_keys,
            category,
            artist: row.author.clone(),
            copyright: row.copyright.clone(),
            ccli: None,
            tags: None,
            arrangement: Some("congregation".into()),
            base_song: None,
            modified_at: None,
        },
        raw: row.body.clone(),
        sections,
    };

    if song.sections.is_empty() {
        return Err("empty body".into());
    }

    let content = serialize_chordpro(&song);
    song.raw = content.clone();
    let _ = parse_chordpro(&content, &filename);
    Ok((filename, content))
}

fn parse_keys(raw: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(raw) = raw else {
        return (None, None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return (None, None);
    }
    let parts: Vec<&str> = trimmed.split('/').map(str::trim).collect();
    if parts.len() > 1 {
        (
            Some(parts[0].to_string()),
            Some(parts[1..].join(", ")),
        )
    } else {
        (Some(trimmed.to_string()), None)
    }
}

pub fn parse_vsb_body(body: &str) -> Vec<SongSection> {
    let lines: Vec<&str> = body.lines().collect();
    let chord_line = Regex::new(
        r"^[A-G][#b]?(?:m|maj|min|sus|add|dim|aug|\d)*(?:[\s/]+[A-G][#b]?(?:m|maj|min|sus|add|dim|aug|\d)*)*$",
    )
    .ok();
    let section_re =
        Regex::new(r"(?i)^(verse\s*\d*|chorus\s*\d*|bridge|intro|outro)\s*$").unwrap();

    let mut sections = Vec::new();
    let mut current_label = "Verse".to_string();
    let mut current_kind = SectionKind::Verse;
    let mut current_lines = Vec::new();

    let mut flush = |sections: &mut Vec<SongSection>,
                     label: &mut String,
                     kind: &mut SectionKind,
                     lines: &mut Vec<_>| {
        if !lines.is_empty() {
            sections.push(SongSection {
                label: label.clone(),
                kind: kind.clone(),
                lines: std::mem::take(lines),
            });
        }
    };

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        if trimmed.is_empty() {
            i += 1;
            continue;
        }

        if let Some(cap) = section_re.captures(trimmed) {
            flush(
                &mut sections,
                &mut current_label,
                &mut current_kind,
                &mut current_lines,
            );
            let label = cap.get(1).map(|m| m.as_str()).unwrap_or("verse");
            current_label = capitalize_label(label);
            current_kind = classify_section(label);
            i += 1;
            continue;
        }

        let next = lines.get(i + 1).map(|l| l.trim()).unwrap_or("");
        let looks_like_chord_line = chord_line
            .as_ref()
            .map(|re| re.is_match(trimmed) && !next.is_empty())
            .unwrap_or(false);

        if looks_like_chord_line {
            let lyric = next;
            current_lines.push(parse_vsb_chord_pair(trimmed, lyric));
            i += 2;
            continue;
        }

        current_lines.push(crate::library::chordpro::LyricLine {
            text: trimmed.to_string(),
            chords: vec![],
        });
        i += 1;
    }

    flush(
        &mut sections,
        &mut current_label,
        &mut current_kind,
        &mut current_lines,
    );

    if sections.is_empty() && !body.trim().is_empty() {
        sections.push(SongSection {
            label: "Song".into(),
            kind: SectionKind::Other,
            lines: body
                .split("\r\n")
                .flat_map(|block| block.lines())
                .filter(|l| !l.trim().is_empty())
                .map(|l| crate::library::chordpro::LyricLine {
                    text: l.trim().to_string(),
                    chords: vec![],
                })
                .collect(),
        });
    }

    sections
}

fn parse_vsb_chord_pair(chord_line: &str, lyric_line: &str) -> crate::library::chordpro::LyricLine {
    let chord_token = Regex::new(r"[A-G](#|b)?[^ \t]*").unwrap();
    let mut chords = Vec::new();
    for mat in chord_token.find_iter(chord_line) {
        let pos = lyric_line
            .chars()
            .take(mat.start().min(lyric_line.len()))
            .count();
        chords.push(crate::library::chordpro::ChordPlacement {
            chord: mat.as_str().to_string(),
            position: pos,
        });
    }
    crate::library::chordpro::LyricLine {
        text: lyric_line.to_string(),
        chords,
    }
}

fn classify_section(label: &str) -> SectionKind {
    let lower = label.to_lowercase();
    if lower.starts_with("chorus") {
        SectionKind::Chorus
    } else if lower.starts_with("bridge") {
        SectionKind::Bridge
    } else if lower.starts_with("verse") {
        SectionKind::Verse
    } else {
        SectionKind::Other
    }
}

fn capitalize_label(label: &str) -> String {
    let mut chars = label.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_lyrics_only_body() {
        let body = "Line one\nLine two\n\nLine three";
        let sections = parse_vsb_body(body);
        assert!(!sections.is_empty());
        assert!(sections[0].lines.len() >= 2);
    }

    #[test]
    fn converts_chord_chart_body() {
        let body = "chorus\n         Dm                    A\nFall til ro og kjenn at jeg er Herre";
        let sections = parse_vsb_body(body);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].kind, SectionKind::Chorus);
        assert!(!sections[0].lines[0].chords.is_empty());
    }

    #[test]
    fn golden_chord_chart_conversion() {
        let row = VsbSongRow {
            song_id: 4711,
            song_num: 1016,
            title: "Worthy is the Lamb".into(),
            body: "chorus\n         Dm                    A\nFall til ro og kjenn at jeg er Herre".into(),
            key: Some("D / E".into()),
            author: Some("Author".into()),
            copyright: Some("© Test".into()),
            category_id: 1,
        };
        let categories = vec![(1, "General".into())];
        let (filename, content) = convert_song(&row, &categories).expect("convert");
        assert_eq!(filename, "1016-worthy-is-the-lamb.pro");
        assert!(content.contains("{meta: song_num=1016}"));
        assert!(content.contains("{meta: vsb_song_id=4711}"));
        assert!(content.contains("{meta: alt_keys=E}"));
        assert!(content.contains("{meta: category=General}"));
    }
}
