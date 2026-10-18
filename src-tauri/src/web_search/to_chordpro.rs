use regex::Regex;

use crate::import::vsb_to_chordpro::{
    classify_section_for_scrape, is_single_stanza_section_kind, next_non_empty_line,
    parse_scraped_chord_pair, section_kind_after_stanza_break,
};
use crate::library::chordpro::{serialize_chordpro, ParsedSong, SongMeta, SongSection};

pub fn extract_title(raw: &str) -> Option<String> {
    let first = raw.lines().find(|l| !l.trim().is_empty())?;
    let trimmed = first.trim();
    if trimmed.len() > 80 {
        return None;
    }
    Some(trimmed.to_string())
}

pub fn raw_to_chordpro(title: &str, raw: &str) -> String {
    let sections = parse_scraped_body(raw);
    let song = ParsedSong {
        meta: SongMeta {
            filename: "__web__.pro".into(),
            title: title.into(),
            ..Default::default()
        },
        raw: raw.into(),
        sections,
    };
    serialize_chordpro(&song)
}

fn parse_scraped_body(body: &str) -> Vec<SongSection> {
    let lines: Vec<&str> = body.lines().collect();
    let section_re = Regex::new(
        r"(?i)^(intro|instrumental|outro|first verse|pre-chorus|verse\s*\d*|chorus\s*\d*|bridge)\s*$",
    )
    .unwrap();
    let chord_line_re = Regex::new(
        r"^[A-G][#b]?(?:m|maj|min|sus|add|dim|aug|\d)*(?:[\s/]+[A-G][#b]?(?:m|maj|min|sus|add|dim|aug|\d)*)*$",
    )
    .unwrap();

    let mut sections = Vec::new();
    let mut current_label = "Verse".to_string();
    let mut current_kind = classify_section_for_scrape("verse");
    let mut current_lines = Vec::new();
    let mut skipping_instrumental = false;

    let flush = |sections: &mut Vec<SongSection>,
                 label: &mut String,
                 kind: &mut crate::library::chordpro::SectionKind,
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
        let trimmed = lines[i].trim();
        if trimmed.is_empty() {
            if !skipping_instrumental && is_single_stanza_section_kind(&current_kind) {
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
            if !skipping_instrumental {
                current_lines.push(crate::library::chordpro::LyricLine {
                    text: String::new(),
                    chords: vec![],
                    source_line: None,
                });
            }
            i += 1;
            continue;
        }

        if let Some(header) = section_re.captures(trimmed) {
            flush(
                &mut sections,
                &mut current_label,
                &mut current_kind,
                &mut current_lines,
            );
            let label = header.get(1).map(|m| m.as_str()).unwrap_or("verse");
            let lower = label.to_lowercase();
            skipping_instrumental = lower.starts_with("intro")
                || lower.starts_with("instrumental")
                || lower.starts_with("outro");
            if !skipping_instrumental {
                current_label = normalize_section_label(label);
                current_kind = classify_section_for_scrape(label);
            }
            i += 1;
            continue;
        }

        if skipping_instrumental {
            i += 1;
            continue;
        }

        let next = lines.get(i + 1).map(|l| l.trim()).unwrap_or("");
        let looks_like_chord_line =
            chord_line_re.is_match(trimmed) && !next.is_empty() && !section_re.is_match(next);

        if looks_like_chord_line {
            current_lines.push(parse_scraped_chord_pair(trimmed, next));
            i += 2;
            continue;
        }

        if chord_line_re.is_match(trimmed) {
            i += 1;
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

    sections
}

fn normalize_section_label(label: &str) -> String {
    let lower = label.to_lowercase();
    if lower.starts_with("first verse") {
        "Verse 1".into()
    } else {
        let mut chars = label.chars();
        match chars.next() {
            None => String::new(),
            Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::chordpro::parse_chordpro;
    use crate::projection::modes::audience_slide;
    use crate::projection::{build_slides, SlideTheme};

    const MAKE_ROOM_EXCERPT: &str = r#"First Verse
F#                        C#
 Here is where I lay it down
                    G#m
Every burden, every crown
                    B
This is my surrender
 
 
Chorus 
                F#
And I will make room for You
C#                   G#m
 To do whatever You want to
"#;

    #[test]
    fn make_room_strips_chord_only_lines_from_lyrics() {
        let chordpro = raw_to_chordpro("Make Room", MAKE_ROOM_EXCERPT);
        let parsed = parse_chordpro(&chordpro, "make-room.pro");
        let all_text: Vec<String> = parsed
            .sections
            .iter()
            .flat_map(|s| s.lines.iter().map(|l| l.text.clone()))
            .filter(|t| !t.is_empty())
            .collect();

        assert!(
            all_text
                .iter()
                .any(|t| t.contains("Here is where I lay it down")),
            "expected lyrics, got {all_text:?}"
        );
        assert!(
            !all_text.iter().any(|t| {
                t.trim()
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_uppercase())
                    && t.contains('#')
                    && !t.contains(' ')
                    || t.trim() == "F#"
            }),
            "chord-only lines should not appear as lyrics: {all_text:?}"
        );
        assert!(
            !all_text
                .iter()
                .any(|t| t.matches('#').count() >= 2 && t.len() < 30 && !t.contains("room")),
            "raw chord rows should not appear as lyrics: {all_text:?}"
        );
    }

    #[test]
    fn make_room_keeps_chords_for_stage_not_audience() {
        let chordpro = raw_to_chordpro("Make Room", MAKE_ROOM_EXCERPT);
        let parsed = parse_chordpro(&chordpro, "make-room.pro");
        let slides = build_slides(&parsed, &SlideTheme::default(), 0);
        assert!(!slides.is_empty());
        let stage = &slides[0];
        assert!(
            stage.lines.iter().any(|l| !l.chords.is_empty()),
            "stage should retain chords"
        );
        let audience = audience_slide(stage);
        assert!(audience.lines.iter().all(|l| l.chords.is_empty()));
        assert!(
            audience
                .lines
                .iter()
                .all(|l| !l.text.contains('#') || l.text.contains("room")),
            "audience should not show chord symbols"
        );
    }
}
