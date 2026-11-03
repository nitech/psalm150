//! ChordPro → Visual Song Book row fields: the reverse of
//! `import::vsb_to_chordpro`, written so that a row we write parses back into
//! the same sections and chord columns.

use sha2::{Digest, Sha256};

use crate::import::mdb::VsbSongRow;
use crate::library::chordpro::{LyricLine, ParsedSong, SectionKind, SongSection};

/// Column widths of the VSB `Songs` table.
const TITLE_MAX: usize = 50;
const KEY_MAX: usize = 200;
const PERSON_MAX: usize = 100;

/// The editable columns of one VSB `Songs` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VsbFields {
    pub title: String,
    pub song_num: Option<i64>,
    pub key: Option<String>,
    pub author: Option<String>,
    pub copyright: Option<String>,
    pub category_id: i64,
    pub body: String,
}

impl VsbFields {
    pub fn from_row(row: &VsbSongRow) -> Self {
        Self {
            title: row.title.clone(),
            song_num: Some(row.song_num),
            key: row.key.clone().filter(|key| !key.trim().is_empty()),
            author: row.author.clone(),
            copyright: row.copyright.clone(),
            category_id: row.category_id,
            body: row.body.clone(),
        }
    }

    /// `Search` column as VSB fills it: upper-cased title plus the first line
    /// of every stanza, one per line.
    pub fn search_text(&self) -> String {
        let mut firsts = Vec::new();
        let mut at_stanza_start = true;
        for line in self.body.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                at_stanza_start = true;
                continue;
            }
            if at_stanza_start && !looks_like_chord_row(trimmed) {
                firsts.push(trimmed.to_string());
                at_stanza_start = false;
            }
        }
        let mut search = self.title.trim().to_string();
        if let Some(first) = firsts.first() {
            search.push(' ');
            search.push_str(first);
        }
        for line in firsts.iter().skip(1) {
            search.push_str("\r\n");
            search.push_str(line);
        }
        search.to_uppercase()
    }
}

/// Hash of the columns sync cares about; line endings and trailing spaces are
/// normalised so a driver round trip does not look like an edit.
pub fn row_hash(row: &VsbSongRow) -> String {
    let fields = VsbFields::from_row(row);
    let mut hasher = Sha256::new();
    for part in [
        fields.title.trim().to_string(),
        fields.song_num.map(|n| n.to_string()).unwrap_or_default(),
        fields.key.unwrap_or_default().trim().to_string(),
        fields.author.unwrap_or_default().trim().to_string(),
        fields.copyright.unwrap_or_default().trim().to_string(),
        fields.category_id.to_string(),
        normalise_body(&fields.body),
    ] {
        hasher.update(part.as_bytes());
        hasher.update([0u8]);
    }
    format!("{:x}", hasher.finalize())
}

fn normalise_body(body: &str) -> String {
    body.lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim_end()
        .to_string()
}

/// Build row fields from a parsed ChordPro song. `categories` maps VSB
/// category ids to names; an unknown category keeps `fallback_category`.
pub fn fields_from_song(
    song: &ParsedSong,
    categories: &[(i64, String)],
    fallback_category: i64,
) -> VsbFields {
    let meta = &song.meta;
    let key = match (&meta.key, &meta.alt_keys) {
        (Some(key), Some(alt)) if !alt.trim().is_empty() => Some(format!(
            "{key} / {}",
            alt.split(',')
                .map(str::trim)
                .collect::<Vec<_>>()
                .join(" / ")
        )),
        (Some(key), _) => Some(key.clone()),
        (None, _) => None,
    };
    let category_id = meta
        .category
        .as_deref()
        .and_then(|name| {
            categories
                .iter()
                .find(|(_, candidate)| candidate.eq_ignore_ascii_case(name.trim()))
                .map(|(id, _)| *id)
        })
        .unwrap_or(fallback_category);
    VsbFields {
        title: truncate(meta.title.trim(), TITLE_MAX),
        song_num: meta.song_num.filter(|n| (1..=i16::MAX as i64).contains(n)),
        key: key.map(|k| truncate(&k, KEY_MAX)),
        author: meta.artist.as_deref().map(|a| truncate(a, PERSON_MAX)),
        copyright: meta.copyright.as_deref().map(|c| truncate(c, PERSON_MAX)),
        category_id,
        body: sections_to_body(&song.sections),
    }
}

fn truncate(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

/// Sections to a VSB body: stanzas separated by blank lines, a header line
/// for anything that is not a plain verse, chord rows above lyric rows.
pub fn sections_to_body(sections: &[SongSection]) -> String {
    let mut out: Vec<String> = Vec::new();
    for section in sections {
        let lines = trim_blank_edges(&section.lines);
        if lines.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(String::new());
        }
        if let Some(header) = section_header(section) {
            out.push(header);
        }
        for line in lines {
            if line.text.is_empty() && line.chords.is_empty() {
                if out.last().is_some_and(|last| !last.is_empty()) {
                    out.push(String::new());
                }
                continue;
            }
            if !line.chords.is_empty() {
                out.push(chord_row(line));
            }
            out.push(line.text.clone());
        }
    }
    while out.last().is_some_and(|line| line.is_empty()) {
        out.pop();
    }
    out.join("\r\n")
}

fn trim_blank_edges(lines: &[LyricLine]) -> &[LyricLine] {
    let blank = |line: &LyricLine| line.text.trim().is_empty() && line.chords.is_empty();
    let start = lines.iter().position(|l| !blank(l)).unwrap_or(lines.len());
    let end = lines
        .iter()
        .rposition(|l| !blank(l))
        .map_or(start, |i| i + 1);
    &lines[start..end]
}

fn section_header(section: &SongSection) -> Option<String> {
    match section.kind {
        SectionKind::Chorus => Some("chorus".into()),
        SectionKind::Chorus2 => Some("chorus 2".into()),
        SectionKind::Bridge => Some("bridge".into()),
        SectionKind::Intro => Some("intro".into()),
        SectionKind::Verse => {
            let label = section.label.trim().to_lowercase();
            let numbered = label
                .strip_prefix("verse")
                .map(|rest| {
                    !rest.trim().is_empty() && rest.trim().chars().all(|c| c.is_ascii_digit())
                })
                .unwrap_or(false);
            numbered.then(|| format!("verse {}", label["verse".len()..].trim()))
        }
        _ => None,
    }
}

/// Chord names placed at their lyric columns, at least one space apart.
fn chord_row(line: &LyricLine) -> String {
    let mut chords = line.chords.clone();
    chords.sort_by_key(|chord| chord.position);
    let mut row = String::new();
    for chord in chords {
        let current = row.chars().count();
        let column = if current == 0 {
            chord.position
        } else {
            chord.position.max(current + 1)
        };
        row.extend(std::iter::repeat_n(' ', column - current));
        row.push_str(&chord.chord);
    }
    row
}

fn looks_like_chord_row(line: &str) -> bool {
    line.split_whitespace().all(|token| {
        let mut chars = token.chars();
        matches!(chars.next(), Some('A'..='G'))
            && token.len() <= 10
            && !token
                .chars()
                .any(|c| c.is_lowercase() && !"mbjsuadi".contains(c))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::vsb_to_chordpro::{convert_song, parse_vsb_body};
    use crate::library::chordpro::parse_chordpro;

    fn row(body: &str) -> VsbSongRow {
        VsbSongRow {
            song_id: 7,
            song_num: 12,
            title: "Fall til ro".into(),
            body: body.into(),
            key: Some("D / E".into()),
            author: Some("Someone".into()),
            copyright: None,
            category_id: 1,
        }
    }

    #[test]
    fn chordpro_round_trips_through_a_vsb_body() {
        let original = "chorus\r\n         Dm                    A\r\nFall til ro og kjenn at jeg er Herre\r\n\r\nLine two\r\nLine three";
        let categories = vec![(1, "General".to_string())];
        let (filename, content) = convert_song(&row(original), &categories).unwrap();
        let song = parse_chordpro(&content, &filename);
        let fields = fields_from_song(&song, &categories, 0);

        assert_eq!(fields.body, original);
        assert_eq!(fields.key.as_deref(), Some("D / E"));
        assert_eq!(fields.category_id, 1);
        assert_eq!(fields.song_num, Some(12));

        let reparsed = parse_vsb_body(&fields.body);
        assert_eq!(reparsed[0].lines[0].chords[0].position, 9);
    }

    #[test]
    fn search_text_uses_title_and_stanza_openings() {
        let fields = VsbFields::from_row(&row("First line\nsecond\n\n   D\nThird stanza"));
        assert_eq!(
            fields.search_text(),
            "FALL TIL RO FIRST LINE\r\nTHIRD STANZA"
        );
    }

    #[test]
    fn row_hash_ignores_line_endings() {
        let a = row("One\r\nTwo  ");
        let b = row("One\nTwo");
        assert_eq!(row_hash(&a), row_hash(&b));
        assert_ne!(row_hash(&a), row_hash(&row("One\nThree")));
    }
}
