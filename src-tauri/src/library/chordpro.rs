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
    Chorus2,
    Bridge,
    Intro,
    PreChorus,
    Interlude,
    Other,
}

/// Sections that should not produce congregation/stage slides.
pub fn is_projectable_section(kind: &SectionKind) -> bool {
    !matches!(kind, SectionKind::Intro | SectionKind::Interlude)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricLine {
    pub text: String,
    pub chords: Vec<ChordPlacement>,
    #[serde(default)]
    pub source_line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChordPlacement {
    pub chord: String,
    pub position: usize,
}

fn is_blank_line(line: &LyricLine) -> bool {
    line.text.is_empty() && line.chords.is_empty()
}

fn default_label_for_kind(kind: &SectionKind) -> &'static str {
    match kind {
        SectionKind::Verse => "Verse",
        SectionKind::Chorus => "Chorus",
        SectionKind::Chorus2 => "Chorus 2",
        SectionKind::Bridge => "Bridge",
        SectionKind::Intro => "Intro",
        SectionKind::PreChorus => "Pre-Chorus",
        SectionKind::Interlude => "Interlude",
        SectionKind::Other => "Verse",
    }
}

fn start_directive_for_kind(kind: &SectionKind) -> &'static str {
    match kind {
        SectionKind::Verse => "start_of_verse",
        SectionKind::Chorus => "start_of_chorus",
        SectionKind::Chorus2 => "start_of_chorus2",
        SectionKind::Bridge => "start_of_bridge",
        SectionKind::Intro => "start_of_intro",
        SectionKind::PreChorus => "start_of_prechorus",
        SectionKind::Interlude => "start_of_interlude",
        SectionKind::Other => "start_of_verse",
    }
}

fn end_directive_for_kind(kind: &SectionKind) -> &'static str {
    match kind {
        SectionKind::Verse => "end_of_verse",
        SectionKind::Chorus => "end_of_chorus",
        SectionKind::Chorus2 => "end_of_chorus2",
        SectionKind::Bridge => "end_of_bridge",
        SectionKind::Intro => "end_of_intro",
        SectionKind::PreChorus => "end_of_prechorus",
        SectionKind::Interlude => "end_of_interlude",
        SectionKind::Other => "end_of_verse",
    }
}

fn reset_to_verse(label: &mut String, kind: &mut SectionKind) {
    *label = "Verse".into();
    *kind = SectionKind::Verse;
}

fn is_single_stanza_section_kind(kind: &SectionKind) -> bool {
    matches!(
        kind,
        SectionKind::Verse
            | SectionKind::Chorus
            | SectionKind::Chorus2
            | SectionKind::Bridge
            | SectionKind::Intro
            | SectionKind::PreChorus
            | SectionKind::Interlude
            | SectionKind::Other
    )
}

fn section_kind_after_stanza_break(kind: &SectionKind) -> SectionKind {
    match kind {
        SectionKind::Chorus
        | SectionKind::Chorus2
        | SectionKind::Bridge
        | SectionKind::PreChorus => SectionKind::Verse,
        other => other.clone(),
    }
}

fn normalize_directive(name: &str) -> &str {
    match name {
        "t" => "title",
        "st" => "subtitle",
        "sov" => "start_of_verse",
        "soc" => "start_of_chorus",
        "sob" => "start_of_bridge",
        "eov" => "end_of_verse",
        "eoc" => "end_of_chorus",
        "eob" => "end_of_bridge",
        "c" => "comment",
        "ci" => "comment_italic",
        "cb" => "comment_box",
        other => other,
    }
}

fn parse_directive_line(rest: &str) -> (String, Option<String>) {
    if let Some((name, value)) = rest.split_once(':') {
        return (name.trim().to_string(), Some(value.trim().to_string()));
    }
    let mut parts = rest.splitn(2, char::is_whitespace);
    let name = parts.next().unwrap_or("").trim().to_string();
    let value = parts.next().map(|s| s.trim().to_string());
    (name, value)
}

fn unquote_label(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        value[1..value.len() - 1].to_string()
    } else {
        value.to_string()
    }
}

fn parse_section_label(value: Option<&str>, default: &str) -> String {
    let Some(value) = value else {
        return default.to_string();
    };
    let value = value.trim();
    if value.is_empty() {
        return default.to_string();
    }
    if let Some(rest) = value.strip_prefix("label=") {
        return unquote_label(rest);
    }
    unquote_label(value)
}

fn directive_name_from_line(trimmed: &str) -> Option<String> {
    let rest = trimmed.strip_prefix('{')?.strip_suffix('}')?;
    let (name, _) = parse_directive_line(rest);
    Some(normalize_directive(&name).to_string())
}

fn is_section_boundary_directive(name: &str) -> bool {
    matches!(
        name,
        "start_of_verse"
            | "start_of_chorus"
            | "start_of_chorus2"
            | "start_of_bridge"
            | "start_of_intro"
            | "start_of_prechorus"
            | "start_of_interlude"
            | "end_of_verse"
            | "end_of_chorus"
            | "end_of_chorus2"
            | "end_of_bridge"
            | "end_of_intro"
            | "end_of_prechorus"
            | "end_of_interlude"
            | "eov"
            | "eoc"
            | "eob"
    )
}

fn is_comment_directive(name: &str) -> bool {
    matches!(name, "comment" | "comment_italic" | "comment_box")
}

fn next_non_empty_line<'a>(lines: &[&'a str], start: usize) -> Option<&'a str> {
    lines
        .iter()
        .skip(start)
        .map(|line| line.trim())
        .find(|line| !line.is_empty())
}

/// Drop blank lines at section edges — ChordPro files often have an extra newline
/// before the next `{start_of_*}` directive, which would otherwise double the gap in the UI.
fn trim_section_boundary_lines(lines: &mut Vec<LyricLine>) {
    while lines.first().is_some_and(is_blank_line) {
        lines.remove(0);
    }
    while lines.last().is_some_and(is_blank_line) {
        lines.pop();
    }
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

    let flush_section = |sections: &mut Vec<SongSection>,
                             label: &mut String,
                             kind: &mut SectionKind,
                             lines: &mut Vec<LyricLine>| {
        trim_section_boundary_lines(lines);
        if !lines.is_empty() || *kind == SectionKind::Chorus {
            sections.push(SongSection {
                label: label.clone(),
                kind: kind.clone(),
                lines: std::mem::take(lines),
            });
        }
    };

    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if is_single_stanza_section_kind(&current_kind) {
                if let Some(next) = next_non_empty_line(&lines, i + 1) {
                    let is_boundary = directive_name_from_line(next)
                        .is_some_and(|name| is_section_boundary_directive(&name));
                    if !is_boundary {
                        flush_section(
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
            current_lines.push(LyricLine {
                text: String::new(),
                chords: vec![],
                source_line: Some(i),
            });
            i += 1;
            continue;
        }
        if trimmed.starts_with('#') {
            i += 1;
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
            let (raw_name, value) = parse_directive_line(rest);
            let directive = normalize_directive(&raw_name);
            if is_comment_directive(directive) || directive == "subtitle" {
                i += 1;
                continue;
            }
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
                    current_label = parse_section_label(value.as_deref(), "Verse");
                    current_kind = SectionKind::Verse;
                }
                "start_of_chorus" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    current_label = parse_section_label(value.as_deref(), "Chorus");
                    current_kind = SectionKind::Chorus;
                }
                "start_of_chorus2" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    current_label = parse_section_label(value.as_deref(), "Chorus 2");
                    current_kind = SectionKind::Chorus2;
                }
                "start_of_bridge" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    current_label = parse_section_label(value.as_deref(), "Bridge");
                    current_kind = SectionKind::Bridge;
                }
                "start_of_intro" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    current_label = parse_section_label(value.as_deref(), "Intro");
                    current_kind = SectionKind::Intro;
                }
                "start_of_prechorus" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    current_label = parse_section_label(value.as_deref(), "Pre-Chorus");
                    current_kind = SectionKind::PreChorus;
                }
                "start_of_interlude" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    current_label = parse_section_label(value.as_deref(), "Interlude");
                    current_kind = SectionKind::Interlude;
                }
                "end_of_verse" | "eov" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    reset_to_verse(&mut current_label, &mut current_kind);
                }
                "end_of_chorus" | "eoc" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    reset_to_verse(&mut current_label, &mut current_kind);
                }
                "end_of_chorus2" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    reset_to_verse(&mut current_label, &mut current_kind);
                }
                "end_of_bridge" | "eob" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    reset_to_verse(&mut current_label, &mut current_kind);
                }
                "end_of_intro" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    reset_to_verse(&mut current_label, &mut current_kind);
                }
                "end_of_prechorus" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    reset_to_verse(&mut current_label, &mut current_kind);
                }
                "end_of_interlude" => {
                    flush_section(
                        &mut sections,
                        &mut current_label,
                        &mut current_kind,
                        &mut current_lines,
                    );
                    reset_to_verse(&mut current_label, &mut current_kind);
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
            i += 1;
            continue;
        }

        let (text, chords) = parse_chord_line(trimmed);
        current_lines.push(LyricLine {
            text,
            chords,
            source_line: Some(i),
        });
        i += 1;
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
                .filter(|l| {
                    let t = l.trim();
                    !t.is_empty() && !t.starts_with('#') && !t.starts_with('{')
                })
                .map(|l| LyricLine {
                    text: l.to_string(),
                    chords: vec![],
                    source_line: None,
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
        let base = start_directive_for_kind(&section.kind);
        let default = default_label_for_kind(&section.kind);
        if section.label == default {
            out.push_str(&format!("{{{base}}}\n"));
        } else {
            out.push_str(&format!("{{{base}: {}}}\n", section.label));
        }
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
        out.push_str(&format!("{{{}}}\n", end_directive_for_kind(&section.kind)));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn end_of_chorus_closes_section_before_following_verse() {
        let content = r#"{title: Test}
{start_of_chorus}
Chorus line one
{end_of_chorus}
Solen står opp
og en ny dag begynner
"#;
        let parsed = parse_chordpro(content, "test.pro");
        assert_eq!(parsed.sections.len(), 2);
        assert_eq!(parsed.sections[0].kind, SectionKind::Chorus);
        assert_eq!(parsed.sections[0].lines[0].text, "Chorus line one");
        assert_eq!(parsed.sections[1].kind, SectionKind::Verse);
        assert_eq!(parsed.sections[1].lines[0].text, "Solen står opp");
    }

    #[test]
    fn serialize_emits_end_directives_after_sections() {
        let content = r#"{title: Test}
{start_of_chorus}
Chorus line
{end_of_chorus}
{start_of_verse}
Verse line
{end_of_verse}
"#;
        let parsed = parse_chordpro(content, "test.pro");
        let serialized = serialize_chordpro(&parsed);
        assert!(serialized.contains("{end_of_chorus}\n"));
        assert!(serialized.contains("{end_of_verse}\n"));
        let reparsed = parse_chordpro(&serialized, "test.pro");
        assert_eq!(reparsed.sections.len(), parsed.sections.len());
        assert_eq!(reparsed.sections[0].kind, SectionKind::Chorus);
        assert_eq!(reparsed.sections[1].kind, SectionKind::Verse);
    }

    #[test]
    fn chorus_without_end_marker_closes_at_stanza_boundary() {
        let content = r#"{title: 10 000/titusen grunner}
{start_of_chorus}
Lov min Gud, Å min sjel
Å min sjel

Solen står opp
og en ny dag begynner
"#;
        let parsed = parse_chordpro(content, "titusen.pro");
        assert_eq!(parsed.sections.len(), 2);
        assert_eq!(parsed.sections[0].kind, SectionKind::Chorus);
        assert_eq!(parsed.sections[1].kind, SectionKind::Verse);
        assert_eq!(parsed.sections[1].lines[0].text, "Solen står opp");

        let serialized = serialize_chordpro(&parsed);
        assert!(serialized.contains("{end_of_chorus}\n"));
    }

    #[test]
    fn verse_paragraphs_split_into_separate_sections() {
        let content = r#"{title: 10 000/titusen grunner}
{start_of_chorus}
Lov min Gud, Å min sjel
{end_of_chorus}

{start_of_verse}
Solen står opp
og en ny dag begynner

Du er rik på kjærlighet,
sen til vrede

Og på den dagen,
min styrke forsvinner.
{end_of_verse}
"#;
        let parsed = parse_chordpro(content, "titusen.pro");
        assert_eq!(parsed.sections.len(), 4);
        assert_eq!(parsed.sections[0].kind, SectionKind::Chorus);
        assert_eq!(parsed.sections[1].kind, SectionKind::Verse);
        assert_eq!(parsed.sections[1].lines[0].text, "Solen står opp");
        assert_eq!(parsed.sections[2].kind, SectionKind::Verse);
        assert_eq!(parsed.sections[2].lines[0].text, "Du er rik på kjærlighet,");
        assert_eq!(parsed.sections[3].kind, SectionKind::Verse);
        assert_eq!(parsed.sections[3].lines[0].text, "Og på den dagen,");

        let serialized = serialize_chordpro(&parsed);
        assert_eq!(
            serialized.matches("{start_of_verse}").count(),
            3,
            "each verse paragraph should serialize as its own verse block"
        );
    }

    #[test]
    fn hash_comments_are_skipped() {
        let content = r#"{title: Test}
{start_of_verse}
# maintainer note
Line one
"#;
        let parsed = parse_chordpro(content, "test.pro");
        assert_eq!(parsed.sections.len(), 1);
        assert_eq!(parsed.sections[0].lines.len(), 1);
        assert_eq!(parsed.sections[0].lines[0].text, "Line one");
    }

    #[test]
    fn comment_directives_are_skipped() {
        let content = r#"{title: Test}
{start_of_verse}
{comment: Play softly}
Line one
{c: Another note}
"#;
        let parsed = parse_chordpro(content, "test.pro");
        assert_eq!(parsed.sections[0].lines.len(), 1);
        assert_eq!(parsed.sections[0].lines[0].text, "Line one");
    }

    #[test]
    fn short_directive_aliases() {
        let content = r#"{t: Alias Title}
{sov}
Verse line
"#;
        let parsed = parse_chordpro(content, "test.pro");
        assert_eq!(parsed.meta.title, "Alias Title");
        assert_eq!(parsed.sections[0].kind, SectionKind::Verse);
        assert_eq!(parsed.sections[0].lines[0].text, "Verse line");
    }

    #[test]
    fn section_label_from_colon_and_attribute() {
        let content = r#"{title: Test}
{start_of_verse: Verse 2}
Line
{start_of_verse label="Verse 3"}
Other line
"#;
        let parsed = parse_chordpro(content, "test.pro");
        assert_eq!(parsed.sections[0].label, "Verse 2");
        assert_eq!(parsed.sections[1].label, "Verse 3");
    }

    #[test]
    fn intro_prechorus_and_interlude_parsed() {
        let content = r#"{title: Test}
{start_of_intro}
[G]Intro chords only
{end_of_intro}
{start_of_prechorus}
Pre chorus line
{end_of_prechorus}
{start_of_verse}
Verse line
"#;
        let parsed = parse_chordpro(content, "test.pro");
        assert_eq!(parsed.sections.len(), 3);
        assert_eq!(parsed.sections[0].kind, SectionKind::Intro);
        assert_eq!(parsed.sections[1].kind, SectionKind::PreChorus);
        assert_eq!(parsed.sections[1].lines[0].text, "Pre chorus line");
        assert_eq!(parsed.sections[2].kind, SectionKind::Verse);
    }
}
