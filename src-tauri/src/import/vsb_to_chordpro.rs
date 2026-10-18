use std::sync::OnceLock;

use regex::Regex;
use slug::slugify;

use super::mdb::VsbSongRow;
use crate::library::chordpro::{
    parse_chordpro, serialize_chordpro, ParsedSong, SectionKind, SongSection,
};

pub fn convert_song(
    row: &VsbSongRow,
    categories: &[(i64, String)],
) -> Result<(String, String), String> {
    let category = categories
        .iter()
        .find(|(id, _)| *id == row.category_id)
        .map(|(_, name)| name.clone());

    let (key, alt_keys) = parse_keys(row.key.as_deref());
    let filename = format!("{:04}-{}.pro", row.song_num, {
        let slug = slugify(&row.title);
        if slug.is_empty() {
            "song".into()
        } else {
            slug
        }
    });

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
        (Some(parts[0].to_string()), Some(parts[1..].join(", ")))
    } else {
        (Some(trimmed.to_string()), None)
    }
}

pub fn parse_vsb_body(body: &str) -> Vec<SongSection> {
    let lines: Vec<&str> = body.lines().collect();
    static CHORD_LINE: OnceLock<Regex> = OnceLock::new();
    static SECTION: OnceLock<Regex> = OnceLock::new();
    let chord_line = Some(CHORD_LINE.get_or_init(|| {
        Regex::new(
            r"^[A-G][#b]?(?:m|maj|min|sus|add|dim|aug|\d)*(?:[\s/]+[A-G][#b]?(?:m|maj|min|sus|add|dim|aug|\d)*)*$",
        )
        .unwrap()
    }));
    let section_re = SECTION.get_or_init(|| {
        Regex::new(r"(?i)^(verse\s*\d*|chorus\s*\d*|bridge|intro|outro)\s*$").unwrap()
    });

    let mut sections = Vec::new();
    let mut current_label = "Verse".to_string();
    let mut current_kind = SectionKind::Verse;
    let mut current_lines = Vec::new();

    let flush = |sections: &mut Vec<SongSection>,
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
            if is_single_stanza_section_kind(&current_kind) {
                if let Some(next) = next_non_empty_line(&lines, i + 1) {
                    if !section_re.is_match(next) {
                        flush(
                            &mut sections,
                            &mut current_label,
                            &mut current_kind,
                            &mut current_lines,
                        );
                        current_kind = section_kind_after_stanza_break(&current_kind);
                        current_label = "Verse".into();
                        i += 1;
                        continue;
                    }
                }
            }
            current_lines.push(crate::library::chordpro::LyricLine {
                text: String::new(),
                chords: vec![],
                source_line: None,
            });
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
            // Columns are measured on the untrimmed lines: VSB aligns the chord
            // row with the lyric row, leading spaces included.
            let lyric = lines.get(i + 1).copied().unwrap_or("");
            current_lines.push(parse_vsb_chord_pair(line, lyric));
            i += 2;
            continue;
        }

        current_lines.push(crate::library::chordpro::LyricLine {
            text: trimmed.to_string(),
            chords: vec![],
            source_line: None,
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
                .map(|l| crate::library::chordpro::LyricLine {
                    text: if l.trim().is_empty() {
                        String::new()
                    } else {
                        l.trim().to_string()
                    },
                    chords: vec![],
                    source_line: None,
                })
                .collect(),
        });
    }

    sections
}

fn parse_vsb_chord_pair(chord_line: &str, lyric_line: &str) -> crate::library::chordpro::LyricLine {
    let chord_token = chord_token_re();
    let indent = lyric_line.chars().take_while(|c| c.is_whitespace()).count();
    let text = lyric_line.trim().to_string();
    let text_len = text.chars().count();
    let chords = chord_token
        .find_iter(chord_line)
        .map(|mat| {
            let column = chord_line[..mat.start()].chars().count();
            crate::library::chordpro::ChordPlacement {
                chord: mat.as_str().to_string(),
                position: column.saturating_sub(indent).min(text_len),
            }
        })
        .collect();
    crate::library::chordpro::LyricLine {
        text,
        chords,
        source_line: None,
    }
}

pub(crate) fn parse_scraped_chord_pair(
    chord_line: &str,
    lyric_line: &str,
) -> crate::library::chordpro::LyricLine {
    let chord_token = chord_token_re();
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
        text: lyric_line.trim().to_string(),
        chords,
        source_line: None,
    }
}

fn chord_token_re() -> &'static Regex {
    static CHORD_TOKEN: OnceLock<Regex> = OnceLock::new();
    CHORD_TOKEN.get_or_init(|| Regex::new(r"[A-G](#|b)?[^ \t]*").unwrap())
}

fn classify_section(label: &str) -> SectionKind {
    classify_section_for_scrape(label)
}

pub(crate) fn classify_section_for_scrape(label: &str) -> SectionKind {
    let lower = label.to_lowercase();
    if lower.starts_with("chorus 2") || lower.starts_with("chorus2") {
        SectionKind::Chorus2
    } else if lower.starts_with("chorus") {
        SectionKind::Chorus
    } else if lower.starts_with("bridge") {
        SectionKind::Bridge
    } else if lower.starts_with("verse") || lower.starts_with("first verse") {
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

pub(crate) fn is_single_stanza_section_kind(kind: &SectionKind) -> bool {
    matches!(
        kind,
        SectionKind::Verse
            | SectionKind::Chorus
            | SectionKind::Chorus2
            | SectionKind::Bridge
            | SectionKind::Other
    )
}

pub(crate) fn section_kind_after_stanza_break(kind: &SectionKind) -> SectionKind {
    match kind {
        SectionKind::Chorus | SectionKind::Chorus2 | SectionKind::Bridge => SectionKind::Verse,
        other => other.clone(),
    }
}

pub(crate) fn next_non_empty_line<'a>(lines: &[&'a str], start: usize) -> Option<&'a str> {
    lines
        .iter()
        .skip(start)
        .map(|line| line.trim())
        .find(|line| !line.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_lyrics_only_body() {
        let body = "Line one\nLine two\n\nLine three";
        let sections = parse_vsb_body(body);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].lines.len(), 2);
        assert_eq!(sections[0].lines[0].text, "Line one");
        assert_eq!(sections[0].lines[1].text, "Line two");
        assert_eq!(sections[1].lines[0].text, "Line three");
    }

    #[test]
    fn blank_lines_split_verses_into_separate_sections() {
        let body = "verse 1\nFirst line\n\nSecond stanza line";
        let sections = parse_vsb_body(body);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].kind, SectionKind::Verse);
        assert_eq!(sections[0].lines[0].text, "First line");
        assert_eq!(sections[1].kind, SectionKind::Verse);
        assert_eq!(sections[1].lines[0].text, "Second stanza line");

        let song = ParsedSong {
            meta: crate::library::chordpro::SongMeta {
                filename: "test.pro".into(),
                title: "Test".into(),
                song_num: None,
                vsb_song_id: None,
                key: None,
                alt_keys: None,
                category: None,
                artist: None,
                copyright: None,
                ccli: None,
                tags: None,
                arrangement: None,
                base_song: None,
                modified_at: None,
            },
            raw: body.into(),
            sections,
        };
        let content = serialize_chordpro(&song);
        let reparsed = parse_chordpro(&content, "test.pro");
        let verses: Vec<_> = reparsed
            .sections
            .iter()
            .filter(|s| s.kind == SectionKind::Verse)
            .collect();
        assert_eq!(verses.len(), 2);
        assert_eq!(verses[0].lines[0].text, "First line");
        assert_eq!(verses[1].lines[0].text, "Second stanza line");
    }

    #[test]
    fn converts_chord_chart_body() {
        let body = "chorus\n         Dm                    A\nFall til ro og kjenn at jeg er Herre";
        let sections = parse_vsb_body(body);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].kind, SectionKind::Chorus);
        let chords = &sections[0].lines[0].chords;
        assert_eq!(chords.len(), 2);
        assert_eq!((chords[0].chord.as_str(), chords[0].position), ("Dm", 9));
        assert_eq!((chords[1].chord.as_str(), chords[1].position), ("A", 31));
    }

    #[test]
    fn chord_columns_follow_lyric_indentation() {
        let body = "      D\n   the love of Jesus";
        let line = &parse_vsb_body(body)[0].lines[0];
        assert_eq!(line.text, "the love of Jesus");
        assert_eq!(line.chords[0].position, 3);
    }

    #[test]
    fn parses_chorus2_section() {
        let body = "chorus\nMain line\nchorus 2\nAlt line";
        let sections = parse_vsb_body(body);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].kind, SectionKind::Chorus);
        assert_eq!(sections[1].kind, SectionKind::Chorus2);
    }

    #[test]
    fn chorus_label_applies_to_one_stanza_only() {
        let body =
            "chorus\nLov min Gud, Å min sjel\nÅ min sjel\n\nSolen står opp\nog en ny dag begynner";
        let sections = parse_vsb_body(body);
        assert_eq!(
            sections.len(),
            2,
            "sections: {:?}",
            sections
                .iter()
                .map(|s| (&s.kind, s.lines.len()))
                .collect::<Vec<_>>()
        );
        assert_eq!(sections[0].kind, SectionKind::Chorus);
        assert_eq!(sections[1].kind, SectionKind::Verse);
        assert_eq!(sections[1].lines[0].text, "Solen står opp");

        let song = ParsedSong {
            meta: crate::library::chordpro::SongMeta {
                filename: "test.pro".into(),
                title: "Test".into(),
                song_num: None,
                vsb_song_id: None,
                key: None,
                alt_keys: None,
                category: None,
                artist: None,
                copyright: None,
                ccli: None,
                tags: None,
                arrangement: None,
                base_song: None,
                modified_at: None,
            },
            raw: body.into(),
            sections,
        };
        let content = serialize_chordpro(&song);
        assert!(content.contains("{end_of_chorus}\n"));
        let reparsed = parse_chordpro(&content, "test.pro");
        assert_eq!(reparsed.sections[0].kind, SectionKind::Chorus);
        assert_eq!(reparsed.sections[1].kind, SectionKind::Verse);
    }

    #[test]
    fn golden_chord_chart_conversion() {
        let row = VsbSongRow {
            song_id: 4711,
            song_num: 1016,
            title: "Worthy is the Lamb".into(),
            body: "chorus\n         Dm                    A\nFall til ro og kjenn at jeg er Herre"
                .into(),
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
