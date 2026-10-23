//! Page text to a song: section headers, chord lines over lyric lines,
//! inline `[G]` chords, key, CCLI number and copyright, with site clutter,
//! instrumental parts and repeat marks dealt with.
//!
//! The ChordPro it writes is the subset the desktop parses
//! (`library/chordpro.rs`): `{start_of_verse}` … `{end_of_verse}` per
//! section, a blank line between sections and none inside one, since a
//! blank line inside a section starts a new stanza.

use std::collections::HashSet;
use std::sync::OnceLock;

use regex::Regex;

use crate::page::{Block, Page};

/// Fewer lyric lines than this is a snippet, not a song.
const MIN_LYRIC_LINES: usize = 4;

#[derive(Debug, Clone, PartialEq)]
pub struct Song {
    pub title: String,
    pub artist: Option<String>,
    pub key: Option<String>,
    pub ccli: Option<String>,
    pub copyright: Option<String>,
    pub sections: Vec<Section>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Section {
    pub kind: Kind,
    pub label: String,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Verse,
    Chorus,
    PreChorus,
    Bridge,
    /// Tag, ending, outro and the like: written as a labelled verse.
    Other,
    /// Intro, interlude, solo: kept only if it has words.
    Instrumental,
}

impl Kind {
    fn default_label(self) -> &'static str {
        match self {
            Kind::Verse | Kind::Other | Kind::Instrumental => "Verse",
            Kind::Chorus => "Chorus",
            Kind::PreChorus => "Pre-Chorus",
            Kind::Bridge => "Bridge",
        }
    }

    fn directive(self) -> &'static str {
        match self {
            Kind::Verse | Kind::Other | Kind::Instrumental => "verse",
            Kind::Chorus => "chorus",
            Kind::PreChorus => "prechorus",
            Kind::Bridge => "bridge",
        }
    }

    /// The kind of the paragraph after a blank line, as the desktop parser
    /// decides it: a chorus or bridge is one stanza, so what follows is a
    /// verse.
    fn after_break(self) -> Kind {
        match self {
            Kind::Chorus | Kind::PreChorus | Kind::Bridge | Kind::Instrumental => Kind::Verse,
            other => other,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub text: String,
    /// Character positions in `text`, in order.
    pub chords: Vec<(usize, String)>,
}

impl Song {
    fn lyric_lines(&self) -> impl Iterator<Item = &Line> {
        self.sections.iter().flat_map(|s| s.lines.iter())
    }

    /// How likely this is the song asked for and a clean chart of it.
    pub fn score(&self, query: &str) -> f64 {
        let lines = self.lyric_lines().count() as f64;
        let chords = self.lyric_lines().filter(|l| !l.chords.is_empty()).count() as f64;
        let labelled = self
            .sections
            .iter()
            .filter(|s| s.kind != Kind::Verse || s.label != "Verse")
            .count() as f64;
        let query_words = words(query);
        let title_words = words(&self.title);
        let title_match = if query_words.is_empty() {
            0.0
        } else {
            query_words.intersection(&title_words).count() as f64 / query_words.len() as f64
        };
        let lyric_words: HashSet<String> =
            self.lyric_lines().flat_map(|l| words(&l.text)).collect();
        let lyric_match = if query_words.is_empty() {
            0.0
        } else {
            query_words.intersection(&lyric_words).count() as f64 / query_words.len() as f64
        };
        title_match.max(lyric_match) * 4.0
            + (labelled.min(4.0)) * 0.4
            + (chords / lines.max(1.0)).min(1.0) * 1.0
            + lines.min(40.0) / 20.0
    }

    /// Mirror sites copy each other: most of the same words means the same song.
    pub fn same_song(&self, other: &Song) -> bool {
        let a: HashSet<String> = self.lyric_lines().flat_map(|l| words(&l.text)).collect();
        let b: HashSet<String> = other.lyric_lines().flat_map(|l| words(&l.text)).collect();
        let union = a.union(&b).count();
        union > 0 && a.intersection(&b).count() as f64 / union as f64 > 0.6
    }

    pub fn to_chordpro(&self) -> String {
        let mut out = format!("{{title: {}}}\n", self.title);
        if let Some(artist) = &self.artist {
            out.push_str(&format!("{{artist: {artist}}}\n"));
        }
        if let Some(key) = &self.key {
            out.push_str(&format!("{{key: {key}}}\n"));
        }
        if let Some(copyright) = &self.copyright {
            out.push_str(&format!("{{copyright: {copyright}}}\n"));
        }
        if let Some(ccli) = &self.ccli {
            out.push_str(&format!("{{meta: ccli={ccli}}}\n"));
        }
        out.push('\n');
        for section in &self.sections {
            let directive = section.kind.directive();
            if section.label == section.kind.default_label() {
                out.push_str(&format!("{{start_of_{directive}}}\n"));
            } else {
                out.push_str(&format!("{{start_of_{directive}: {}}}\n", section.label));
            }
            for line in &section.lines {
                out.push_str(&render_line(line));
                out.push('\n');
            }
            out.push_str(&format!("{{end_of_{directive}}}\n\n"));
        }
        out
    }
}

fn render_line(line: &Line) -> String {
    let mut out = String::new();
    let mut chords = line.chords.iter().peekable();
    for (index, c) in line.text.chars().enumerate() {
        while let Some((_, chord)) = chords.next_if(|(pos, _)| *pos <= index) {
            out.push_str(&format!("[{chord}]"));
        }
        out.push(c);
    }
    for (_, chord) in chords {
        out.push_str(&format!("[{chord}]"));
    }
    out
}

fn interjections() -> &'static Regex {
    static INTERJECTIONS: OnceLock<Regex> = OnceLock::new();
    INTERJECTIONS.get_or_init(|| {
        Regex::new(r"(?i)\s*\((?:\s*(?:oh+|o+h|hey|yeah|yea|whoa+|woah|ooh+|ah+|hallelujah|come on|sing)[\s,!.]*)+\)").unwrap()
    })
}

/// How much of a search is in `text`: the share of the query's words found.
pub fn query_match(query: &str, text: &str) -> f64 {
    let query = words(query);
    if query.is_empty() {
        return 0.0;
    }
    query.intersection(&words(text)).count() as f64 / query.len() as f64
}

fn words(text: &str) -> HashSet<String> {
    text.split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|w| w.chars().count() > 1)
        .map(|w| w.to_lowercase().replace('\'', ""))
        .collect()
}

/// The best song among a page's blocks, titled from the page (or the
/// query when the page does not say).
pub fn parse(page: &Page, query: &str) -> Option<Song> {
    let title = page.title.clone().unwrap_or_else(|| title_case(query));
    let known: Vec<&str> = [Some(title.as_str()), page.artist.as_deref()]
        .into_iter()
        .flatten()
        .collect();
    page.blocks
        .iter()
        .filter_map(|block| parse_block(block, &title, page.artist.clone(), &known))
        .max_by(|a, b| a.score(query).total_cmp(&b.score(query)))
}

fn title_case(text: &str) -> String {
    text.split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map_or(String::new(), |f| f.to_uppercase().chain(c).collect())
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// One block as a song, or `None` when it is not one: too short, or prose
/// (long lines are paragraphs, not lyrics).
pub fn parse_block(
    block: &Block,
    title: &str,
    artist: Option<String>,
    known: &[&str],
) -> Option<Song> {
    let body = parse_text(&block.text, known);
    let lines: Vec<&Line> = body.sections.iter().flat_map(|s| s.lines.iter()).collect();
    if lines.len() < MIN_LYRIC_LINES {
        return None;
    }
    let long = lines.iter().filter(|l| l.text.chars().count() > 90).count();
    if long * 10 > lines.len() {
        return None;
    }
    Some(Song {
        title: title.to_string(),
        artist,
        key: body.key,
        ccli: body.ccli,
        copyright: body.copyright,
        sections: body.sections,
    })
}

#[derive(Debug, Default)]
pub struct Body {
    pub sections: Vec<Section>,
    pub key: Option<String>,
    pub ccli: Option<String>,
    pub copyright: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
enum Row {
    Blank,
    Header {
        kind: Kind,
        label: String,
        rest: Option<String>,
    },
    /// Copy an earlier section here: "Repeat chorus", "(Chorus)".
    Repeat {
        label: String,
    },
    Chords,
    Inline(Line),
    Lyric(String),
    Key(String),
    Ccli(String),
    Copyright(String),
    Clutter,
}

/// `known`: the title and artist, which pages repeat above the song.
pub fn parse_text(text: &str, known: &[&str]) -> Body {
    let raw: Vec<&str> = text.lines().collect();
    let rows: Vec<Row> = raw.iter().map(|line| classify(line)).collect();
    let stanza_gap = stanza_gap(&raw, &rows);
    let known: Vec<String> = known
        .iter()
        .map(|k| normalise(k))
        .filter(|k| !k.is_empty())
        .collect();

    let mut body = Body::default();
    let mut current = Section {
        kind: Kind::Verse,
        label: "Verse".into(),
        lines: vec![],
    };
    let mut explicit = false;
    let mut blank_run = 0;
    let mut i = 0;
    while i < rows.len() {
        let row = &rows[i];
        if *row == Row::Blank {
            blank_run += 1;
            i += 1;
            continue;
        }
        if blank_run >= stanza_gap && !current.lines.is_empty() {
            let next = current.kind.after_break();
            flush(&mut body.sections, &mut current, explicit);
            current = Section {
                kind: next,
                label: next.default_label().into(),
                lines: vec![],
            };
            explicit = false;
        }
        blank_run = 0;
        match row {
            Row::Blank => {}
            Row::Header { kind, label, rest } => {
                flush(&mut body.sections, &mut current, explicit);
                current = Section {
                    kind: *kind,
                    label: label.clone(),
                    lines: vec![],
                };
                explicit = true;
                if let Some(rest) = rest {
                    current.lines.push(Line {
                        text: rest.clone(),
                        chords: vec![],
                    });
                }
            }
            Row::Repeat { label } => {
                flush(&mut body.sections, &mut current, explicit);
                if let Some(earlier) = body
                    .sections
                    .iter()
                    .rev()
                    .find(|s| s.label.eq_ignore_ascii_case(label))
                    .cloned()
                {
                    body.sections.push(earlier);
                }
                current = Section {
                    kind: Kind::Verse,
                    label: "Verse".into(),
                    lines: vec![],
                };
                explicit = false;
            }
            Row::Chords => {
                // A chord line over a lyric line; a chord line on its own is
                // music between the words.
                if let Some(Row::Lyric(lyric)) = rows.get(i + 1) {
                    if body.sections.is_empty()
                        && current.lines.is_empty()
                        && is_known(lyric, &known)
                    {
                        i += 2;
                        continue;
                    }
                    current.lines.push(pair(raw[i], raw[i + 1], lyric));
                    i += 2;
                    continue;
                }
            }
            Row::Inline(line) => current.lines.push(line.clone()),
            Row::Lyric(text) => {
                let before_song = body.sections.is_empty() && current.lines.is_empty();
                if before_song && is_known(text, &known) {
                    i += 1;
                    continue;
                }
                if let Some((number, rest)) = numbered_verse(text) {
                    // Hymn books number their verses: "2. When through ..."
                    flush(&mut body.sections, &mut current, explicit);
                    current = Section {
                        kind: Kind::Verse,
                        label: format!("Verse {number}"),
                        lines: vec![],
                    };
                    explicit = true;
                    current.lines.push(Line {
                        text: rest,
                        chords: vec![],
                    });
                    i += 1;
                    continue;
                }
                current.lines.push(Line {
                    text: text.clone(),
                    chords: vec![],
                });
            }
            Row::Key(key) => {
                body.key.get_or_insert_with(|| key.clone());
            }
            Row::Ccli(number) => {
                body.ccli.get_or_insert_with(|| number.clone());
            }
            Row::Copyright(text) => {
                body.copyright.get_or_insert_with(|| text.clone());
            }
            Row::Clutter => {}
        }
        i += 1;
    }
    flush(&mut body.sections, &mut current, explicit);
    drop_preamble(&mut body.sections);
    name_repeated_stanzas(&mut body.sections);
    body
}

/// Lyrics without any headers (a lyrics database, many lyric sites): a
/// stanza sung more than once is the chorus, the others are verses.
fn name_repeated_stanzas(sections: &mut [Section]) {
    if sections
        .iter()
        .any(|s| s.kind != Kind::Verse || s.label != "Verse")
    {
        return;
    }
    let texts: Vec<Vec<String>> = sections.iter().map(lyrics_of).collect();
    let repeated: Vec<bool> = texts
        .iter()
        .map(|text| text.len() >= 2 && texts.iter().filter(|other| *other == text).count() > 1)
        .collect();
    if !repeated.iter().any(|r| *r) {
        return;
    }
    for (section, repeated) in sections.iter_mut().zip(repeated) {
        if repeated {
            section.kind = Kind::Chorus;
            section.label = "Chorus".into();
        }
    }
}

/// Text above the first header of a chart is the page talking (credits,
/// view switches, notes), not a verse without a name: drop it when it has
/// no chords and the rest of the song does.
fn drop_preamble(sections: &mut Vec<Section>) {
    let has_chords = |s: &Section| s.lines.iter().any(|l| !l.chords.is_empty());
    let Some(first_named) = sections
        .iter()
        .position(|s| s.kind != Kind::Verse || s.label != "Verse")
    else {
        return;
    };
    if !sections[first_named..].iter().any(has_chords) {
        return;
    }
    let mut index = 0;
    sections.retain(|section| {
        let keep = index >= first_named || has_chords(section);
        index += 1;
        keep
    });
}

/// Put the section in the song, or drop it: empty, or an instrumental part
/// with no words. A header with nothing under it ("Chorus") repeats the
/// last section of that name.
fn flush(sections: &mut Vec<Section>, current: &mut Section, explicit: bool) {
    let mut section = std::mem::replace(
        current,
        Section {
            kind: Kind::Verse,
            label: "Verse".into(),
            lines: vec![],
        },
    );
    section.lines.retain(|l| !l.text.trim().is_empty());
    if section.lines.is_empty() {
        if explicit && section.kind != Kind::Instrumental {
            if let Some(earlier) = sections
                .iter()
                .rev()
                .find(|s| s.label == section.label && !s.lines.is_empty())
                .cloned()
            {
                sections.push(earlier);
            }
        }
        return;
    }
    if section.kind == Kind::Instrumental {
        section.kind = Kind::Other;
    }
    // A paragraph without a header that repeats an earlier section is that
    // section again: the second half of "Chorus x2" written out, say.
    if !explicit {
        let text = lyrics_of(&section);
        if let Some(earlier) = sections.iter().find(|s| lyrics_of(s) == text) {
            section.kind = earlier.kind;
            section.label = earlier.label.clone();
        }
    }
    sections.push(section);
}

fn lyrics_of(section: &Section) -> Vec<String> {
    section.lines.iter().map(|l| normalise(&l.text)).collect()
}

/// How many blank lines end a stanza. Usually one; but a site that puts
/// every line in its own paragraph has a blank line after nearly every
/// line, and then only a double gap (or none at all) means anything.
fn stanza_gap(raw: &[&str], rows: &[Row]) -> usize {
    let content = rows
        .iter()
        .filter(|r| !matches!(r, Row::Blank | Row::Clutter))
        .count();
    let mut single = 0;
    let mut double = 0;
    let mut run = 0;
    for line in raw {
        if line.trim().is_empty() {
            run += 1;
        } else {
            match run {
                0 => {}
                1 => single += 1,
                _ => double += 1,
            }
            run = 0;
        }
    }
    if content > 0 && (single + double) * 10 >= content * 6 {
        if double > 0 {
            2
        } else {
            usize::MAX
        }
    } else {
        1
    }
}

fn normalise(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// The title, the artist or "Title - Artist" repeated above the song.
fn is_known(text: &str, known: &[String]) -> bool {
    let text = normalise(text);
    let text = text.trim_start_matches("by ").to_string();
    !text.is_empty()
        && known
            .iter()
            .any(|k| text == *k || (text.contains(k.as_str()) && text.len() <= k.len() + 30))
}

fn numbered_verse(text: &str) -> Option<(u32, String)> {
    static NUMBERED: OnceLock<Regex> = OnceLock::new();
    let re = NUMBERED.get_or_init(|| Regex::new(r"^(\d{1,2})[.)]\s+(\S.*)$").unwrap());
    let caps = re.captures(text)?;
    Some((caps[1].parse().ok()?, caps[2].to_string()))
}

/// A chord line and the lyric line under it as one line with chords.
/// Chords sit at their column over the lyric; with the lyric's indent taken
/// off, and those past its end at the end.
fn pair(chord_line: &str, lyric_raw: &str, lyric: &str) -> Line {
    let indent = lyric_raw.chars().take_while(|c| c.is_whitespace()).count();
    let len = lyric.chars().count();
    let mut chords = Vec::new();
    let mut token = String::new();
    let mut start = 0;
    for (column, c) in chord_line.chars().chain(std::iter::once(' ')).enumerate() {
        if c.is_whitespace() {
            if !token.is_empty() {
                let chord = token.trim_matches(|c| c == '(' || c == ')').to_string();
                if is_chord(&chord) {
                    chords.push((start, chord));
                }
                token.clear();
            }
        } else {
            if token.is_empty() {
                start = column;
            }
            token.push(c);
        }
    }
    let letters: Vec<char> = lyric.chars().collect();
    let chords = chords
        .into_iter()
        .map(|(col, chord): (usize, String)| {
            (
                snap_to_word(&letters, col.saturating_sub(indent).min(len)),
                chord,
            )
        })
        .collect();
    Line {
        text: lyric.to_string(),
        chords,
    }
}

/// A chord one letter into a word ("s[G]plendor") is a chart drawn a column
/// off: it belongs on the word ("[G]splendor"). Further in, it marks a
/// syllable and stays.
fn snap_to_word(letters: &[char], pos: usize) -> usize {
    let at = |i: usize| letters.get(i).copied().unwrap_or(' ');
    if pos >= 1
        && at(pos).is_alphabetic()
        && at(pos - 1).is_alphabetic()
        && (pos == 1 || at(pos - 2).is_whitespace())
    {
        pos - 1
    } else {
        pos
    }
}

fn chord_re() -> &'static Regex {
    static CHORD: OnceLock<Regex> = OnceLock::new();
    CHORD.get_or_init(|| {
        Regex::new(
            r"^[A-H](?:#|b|♯|♭)?(?:maj|min|mi|m|M|dim|aug|sus|add|°|ø|\+|-)?\d{0,2}(?:(?:sus|add|maj|M|b|#|\+|-|no)\d{1,2}|sus)*(?:/[A-H](?:#|b|♯|♭)?)?$",
        )
        .unwrap()
    })
}

pub fn is_chord(token: &str) -> bool {
    chord_re().is_match(token)
}

/// Marks that may sit on a chord line beside the chords.
fn chord_line_mark(token: &str) -> bool {
    static MARK: OnceLock<Regex> = OnceLock::new();
    let re = MARK.get_or_init(|| {
        Regex::new(
            r"(?i)^(?:\|+:?|:?\|+|-+|/+|\.+|%|\*|x\d+|\d+x|\(x?\d+x?\)|\(|\)|n\.?c\.?|riff|\d+)$",
        )
        .unwrap()
    });
    re.is_match(token)
}

fn is_chord_line(line: &str) -> bool {
    let mut chords = 0;
    for token in line.split_whitespace() {
        let bare = token.trim_matches(|c| c == '(' || c == ')' || c == '|');
        if is_chord(bare) {
            chords += 1;
        } else if !chord_line_mark(token) {
            return false;
        }
    }
    chords > 0
}

/// A line that is all inline chords and words: `[G]Amazing [C]grace`.
fn inline_chords(line: &str) -> Option<Line> {
    if !line.contains('[') {
        return None;
    }
    let mut text = String::new();
    let mut chords = Vec::new();
    let mut rest = line;
    while let Some(open) = rest.find('[') {
        let close = rest[open..].find(']')? + open;
        let chord = rest[open + 1..close].trim();
        if !is_chord(chord) {
            return None;
        }
        text.push_str(&rest[..open]);
        chords.push((text.chars().count(), chord.to_string()));
        rest = &rest[close + 1..];
    }
    text.push_str(rest);
    if chords.is_empty() {
        return None;
    }
    // Trimming the start moves every chord left by the same amount.
    let lead = text.chars().take_while(|c| c.is_whitespace()).count();
    let text = text.trim().to_string();
    let len = text.chars().count();
    let chords = chords
        .into_iter()
        .map(|(p, c)| (p.saturating_sub(lead).min(len), c))
        .collect();
    Some(Line { text, chords })
}

fn header(line: &str) -> Option<Row> {
    static BRACKETED: OnceLock<Regex> = OnceLock::new();
    static PLAIN: OnceLock<Regex> = OnceLock::new();
    static REPEAT: OnceLock<Regex> = OnceLock::new();
    const ORDINAL: &str =
        r"(?:(?P<ord>first|second|third|fourth|fifth|last|final|1st|2nd|3rd|4th|5th)\s+)?";
    const NAME: &str = r"(?P<name>pre[\s-]?chorus|post[\s-]?chorus|chorus|refrain|refreng|ref|verse|vers|part|bridge|bro|tag|ending|outro|intro|interlude|instrumental|mellomspill|forspill|etterspill|vamp|turnaround|coda|solo|hook|slutt)";
    const REPEAT_MARK: &str = r"(?:\(?\s*(?:x\s*\d+|\d+\s*x|repeat|rep\.?)\s*\)?)";
    let bracketed = BRACKETED.get_or_init(|| {
        Regex::new(&format!(r"(?i)^[\[\(\{{]\s*{ORDINAL}{NAME}\.?\s*(?P<num>\d+[a-z]?)?(?:[^\p{{L}}\]\)\}}][^\]\)\}}]*)?[\]\)\}}]\s*:?\s*{REPEAT_MARK}?\s*$")).unwrap()
    });
    let plain = PLAIN.get_or_init(|| {
        Regex::new(&format!(r"(?i)^{ORDINAL}{NAME}\.?\s*(?P<num>\d+[a-z]?)?\s*{REPEAT_MARK}?\s*(?::\s*(?P<rest>.*))?$")).unwrap()
    });
    let repeat = REPEAT.get_or_init(|| {
        Regex::new(&format!(
            r"(?i)^\(?\s*(?:repeat|rep\.?|gjenta)\s+(?:the\s+)?{NAME}\b\.?\s*(?P<num>\d+)?.*$"
        ))
        .unwrap()
    });
    let trimmed = line.trim();
    if let Some(caps) = repeat.captures(trimmed) {
        let (_, label) = section_name(&caps["name"], caps.name("num").map(|m| m.as_str()), None);
        return Some(Row::Repeat { label });
    }
    let caps = bracketed
        .captures(trimmed)
        .or_else(|| plain.captures(trimmed))?;
    let (kind, label) = section_name(
        &caps["name"],
        caps.name("num").map(|m| m.as_str()),
        caps.name("ord").map(|m| m.as_str()),
    );
    let rest = caps
        .name("rest")
        .map(|m| m.as_str().trim().to_string())
        .filter(|rest| !rest.is_empty() && !is_chord_line(rest));
    Some(Row::Header { kind, label, rest })
}

fn section_name(name: &str, number: Option<&str>, ordinal: Option<&str>) -> (Kind, String) {
    let name = name.to_lowercase().replace([' ', '-'], "");
    let (kind, base) = match name.as_str() {
        "verse" | "vers" | "part" => (Kind::Verse, "Verse"),
        "chorus" | "refrain" | "refreng" | "ref" => (Kind::Chorus, "Chorus"),
        "prechorus" => (Kind::PreChorus, "Pre-Chorus"),
        "bridge" | "bro" => (Kind::Bridge, "Bridge"),
        "postchorus" => (Kind::Other, "Post-Chorus"),
        "tag" => (Kind::Other, "Tag"),
        "ending" | "slutt" => (Kind::Other, "Ending"),
        "outro" | "etterspill" => (Kind::Other, "Outro"),
        "vamp" => (Kind::Other, "Vamp"),
        "coda" => (Kind::Other, "Coda"),
        "hook" => (Kind::Other, "Hook"),
        "intro" | "forspill" => (Kind::Instrumental, "Intro"),
        "solo" => (Kind::Instrumental, "Solo"),
        _ => (Kind::Instrumental, "Interlude"),
    };
    let number = number.map(|n| n.to_string()).or_else(|| {
        ordinal.and_then(|o| match o.to_lowercase().as_str() {
            "first" | "1st" => Some("1".to_string()),
            "second" | "2nd" => Some("2".to_string()),
            "third" | "3rd" => Some("3".to_string()),
            "fourth" | "4th" => Some("4".to_string()),
            "fifth" | "5th" => Some("5".to_string()),
            _ => None,
        })
    });
    let label = match number {
        Some(n) => format!("{base} {n}"),
        None => base.to_string(),
    };
    (kind, label)
}

fn classify(line: &str) -> Row {
    static KEY: OnceLock<Regex> = OnceLock::new();
    static CCLI: OnceLock<Regex> = OnceLock::new();
    static CLUTTER: OnceLock<Regex> = OnceLock::new();
    static REPEAT_TAIL: OnceLock<Regex> = OnceLock::new();
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Row::Blank;
    }
    if let Some(row) = header(trimmed) {
        return row;
    }
    let key = KEY.get_or_init(|| {
        Regex::new(
            r"(?i)^(?:original\s+)?key\s*(?:of)?\s*[:\-=]?\s*((?-i:[A-H](?:#|b)?m?))(?:\s|$)",
        )
        .unwrap()
    });
    if let Some(caps) = key.captures(trimmed) {
        return Row::Key(caps[1].to_string());
    }
    let ccli = CCLI.get_or_init(|| {
        Regex::new(r"(?i)\bccli\b(?:\s*song)?\s*(?:#|no\.?|number|nr\.?)?\s*:?\s*(\d{4,8})")
            .unwrap()
    });
    if let Some(caps) = ccli.captures(trimmed) {
        return Row::Ccli(caps[1].to_string());
    }
    if trimmed.starts_with('©') || trimmed.to_lowercase().starts_with("copyright") {
        let text = trimmed.trim_start_matches('©').trim();
        let text = text
            .strip_prefix("Copyright")
            .or_else(|| text.strip_prefix("copyright"))
            .unwrap_or(text);
        let text = text.trim_start_matches(|c: char| c == '©' || c == ':' || c.is_whitespace());
        return if text.is_empty() {
            Row::Clutter
        } else {
            Row::Copyright(text.to_string())
        };
    }
    if is_chord_line(trimmed) {
        return Row::Chords;
    }
    if let Some(line) = inline_chords(trimmed) {
        return Row::Inline(line);
    }
    let clutter = CLUTTER.get_or_init(|| {
        Regex::new(concat!(
            // Site controls: the whole line, give or take two words.
            r"(?i)^(?:print|transpose|download|advertisement|share|sign (?:up|in)|log ?in|submit|report|correct|rate|related|see also|chords|lyrics|tabs?|how to play|view_module\w*)\b(?:\s+\S+){0,2}\s*:?$",
            // Notes for players and credits: a line that starts with them.
            r"|(?i)^(?:capo\b|tempo\b|bpm\b|time signature\b|tuning\b|difficulty\b|strumming\b|written by\b|writers?\s*:|words and music\b|music by\b|lyrics by\b|composers?\s*:|authors?\s*:|publisher\b|all rights reserved\b|used by permission\b|lyrics licensed\b|powered by\b|chords? by\b|for non-commercial\b|you may also like\b|more songs\b|\d+\s+(?:views|comments)\b)",
        ))
        .unwrap()
    });
    let lower = trimmed.to_lowercase();
    // Words that only ever appear in notes for players and in site adverts.
    let player_note = [
        "capo",
        "tuning",
        "half step",
        "whole step",
        "half-step",
        "tabbed by",
        "chords by",
        "strumming pattern",
        "guitarist",
        "social media",
        "download",
        "learn to play",
        "lesson",
        "discount",
        "% off",
        "click ",
        "subscribe",
        "newsletter",
        "cookie",
        "chords & lyrics",
        "chords and lyrics",
    ]
    .iter()
    .any(|word| lower.contains(word));
    if player_note || clutter.is_match(trimmed) || lower.contains("http") || lower.contains("www.")
    {
        return Row::Clutter;
    }
    let repeat_tail = REPEAT_TAIL.get_or_init(|| {
        Regex::new(r"(?i)\s*[\(\[]?\s*(?:x\s*\d|\d\s*x|repeat)\s*[\)\]]?\s*$").unwrap()
    });
    let text = repeat_tail.replace(trimmed, "").trim().to_string();
    // Shouts transcribed from recordings ("Here in Your love (hey)") are not
    // sung by a congregation; echoes such as "(I surrender)" stay.
    let text = interjections().replace_all(&text, "").trim().to_string();
    if text.is_empty() {
        return Row::Clutter;
    }
    Row::Lyric(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(text: &str, pre: bool) -> String {
        let block = Block {
            text: text.into(),
            preformatted: pre,
        };
        parse_block(&block, "Test", None, &["Test", "Some Artist"])
            .unwrap()
            .to_chordpro()
    }

    #[test]
    fn pairs_chord_lines_with_lyrics_at_their_columns() {
        let chart = "Verse 1\nG        C          G\nAmazing grace how sweet the sound\n    D\nThat saved a wretch like me\n";
        let out = song(&format!("{chart}I once was lost\nBut now am found"), true);
        assert!(out.contains("{start_of_verse: Verse 1}\n[G]Amazing [C]grace how sw[G]eet the sound\nThat[D] saved a wretch like me\n"), "{out}");
    }

    #[test]
    fn recognises_many_header_styles_and_drops_instrumental_parts() {
        let text = "[Intro]\nG  C  G  D\n\n[Verse 1]\nLine one here\nLine two here\n\n[Chorus]\nSing it now\nSing it loud\n\nPre Chorus:\nRising up\nHigher still\n\nVerse 2:\nLine three here\nLine four here\n\n(Chorus)\n\nTag\nForever more x2";
        let out = song(text, false);
        assert!(!out.contains("Intro"), "{out}");
        assert!(
            out.contains("{start_of_verse: Verse 1}\nLine one here"),
            "{out}"
        );
        assert!(
            out.contains("{start_of_chorus}\nSing it now\nSing it loud\n{end_of_chorus}"),
            "{out}"
        );
        assert!(out.contains("{start_of_prechorus}\nRising up"), "{out}");
        assert!(out.contains("{start_of_verse: Verse 2}"), "{out}");
        assert_eq!(
            out.matches("Sing it loud").count(),
            2,
            "the repeated chorus is written out: {out}"
        );
        assert!(
            out.contains("{start_of_verse: Tag}\nForever more\n"),
            "{out}"
        );
    }

    #[test]
    fn repeat_lines_copy_the_section() {
        let out = song("Chorus\nOh how I love\nYour name Lord\nYour name\n\nVerse 2\nAnother line\nAnd one more\n\nRepeat Chorus", false);
        assert_eq!(out.matches("Oh how I love").count(), 2, "{out}");
    }

    #[test]
    fn keeps_metadata_and_drops_clutter() {
        let text = "Test\nby Some Artist\nKey: G\nCapo 2\nPrint\nG     D\nWords of the song\nMore of the words\nAnd more of them\nThe last line\nCCLI Song # 7115744\n© 2017 Integrity Music\nhttps://example.com";
        let block = Block {
            text: text.into(),
            preformatted: true,
        };
        let song = parse_block(
            &block,
            "Test",
            Some("Some Artist".into()),
            &["Test", "Some Artist"],
        )
        .unwrap();
        assert_eq!(song.key.as_deref(), Some("G"));
        assert_eq!(song.ccli.as_deref(), Some("7115744"));
        assert_eq!(song.copyright.as_deref(), Some("2017 Integrity Music"));
        let out = song.to_chordpro();
        assert!(
            out.starts_with("{title: Test}\n{artist: Some Artist}\n{key: G}\n"),
            "{out}"
        );
        assert!(
            out.contains("{start_of_verse}\n[G]Words [D]of the song\n"),
            "{out}"
        );
        assert!(
            !out.contains("Capo")
                && !out.contains("Print")
                && !out.contains("http")
                && !out.contains("by Some"),
            "{out}"
        );
    }

    #[test]
    fn a_paragraph_per_line_does_not_split_every_line() {
        let text = "Line one\n\nLine two\n\nLine three\n\nLine four\n\n\nLine five\n\nLine six";
        let out = song(text, false);
        assert_eq!(out.matches("{start_of_verse}").count(), 2, "{out}");
    }

    #[test]
    fn inline_chords_and_hymn_numbers() {
        let out = song("1. [G]Amazing [C]grace how sweet\nThe sound that saved\n\n2. 'Twas grace that taught\nMy heart to fear", false);
        // Inline chords are read before hymn numbers, so verse 1 keeps its
        // number in the words; verse 2 is a plain numbered line.
        assert!(out.contains("[G]Amazing [C]grace"), "{out}");
        assert!(
            out.contains("{start_of_verse: Verse 2}\n'Twas grace that taught"),
            "{out}"
        );
    }

    #[test]
    fn rejects_prose_and_snippets() {
        let prose = "This song was written in 2017 when the band was touring through Africa and the songwriter felt very inspired by the people.\n".repeat(6);
        assert!(parse_block(
            &Block {
                text: prose,
                preformatted: false
            },
            "T",
            None,
            &[]
        )
        .is_none());
        assert!(parse_block(
            &Block {
                text: "One\nTwo".into(),
                preformatted: false
            },
            "T",
            None,
            &[]
        )
        .is_none());
    }

    #[test]
    fn ultimate_guitar_fixture_from_chordsheetjs() {
        // ChordSheetJS's test/fixtures/ultimate_guitar_chordsheet.txt (the
        // reference library for chord sheets) and its expected ChordPro,
        // less the leading space it keeps on " Tortor".
        let text = "[Verse 1]\nC     G               Am\nLorem ipsum dolor sit amet,\nC           G          F\nconsectetur adipiscing elit.\n\n\n[Chorus]\n        Am      C     F                        C\n Tortor posuere ac ut consequat semper viverra nam.\nC            G                  F\nNon nisi est sit amet facilisis magna etiam tempor orci.\n\n\n[Instrumental]\nF  C Dm\n\n\n[Solo]\nC  G  Am\n\n\n[Chorus]\n\n[Outro]\nF C Dm";
        let out = song(text, true);
        assert!(out.contains("{start_of_verse: Verse 1}\n[C]Lorem [G]ipsum dolor sit [Am]amet,\n[C]consectetur [G]adipiscing [F]elit.\n{end_of_verse}"), "{out}");
        assert!(out.contains("{start_of_chorus}\nTortor [Am]posuere [C]ac ut [F]consequat semper viverra [C]nam.\n[C]Non nisi est [G]sit amet facilisis [F]magna etiam tempor orci.\n{end_of_chorus}"), "{out}");
        assert_eq!(out.matches("Tortor").count(), 2, "{out}");
        assert!(
            !out.contains("Instrumental") && !out.contains("Solo") && !out.contains("Outro"),
            "{out}"
        );
    }

    #[test]
    fn chords_one_letter_into_a_word_move_to_its_start() {
        let out = song("Verse 1\n     G                   Em7\nThe splendor of a King, clothed in majesty,\nLine two\nLine three\nLine four", true);
        assert!(
            out.contains("The [G]splendor of a King, [Em7]clothed"),
            "{out}"
        );
    }

    #[test]
    fn repeated_stanzas_without_headers_are_the_chorus() {
        let out = song("Verse one a\nVerse one b\n\nChorus a\nChorus b\n\nVerse two a\nVerse two b\n\nChorus a\nChorus b", false);
        assert_eq!(out.matches("{start_of_chorus}").count(), 2, "{out}");
        assert_eq!(out.matches("{start_of_verse}").count(), 2, "{out}");
    }

    #[test]
    fn part_headers_and_shouts() {
        let out = song("[Part 1]\nMy Jesus my Savior\nLord there is none like You\nHere in Your love (hey)\nNow I surrender (I surrender)", false);
        assert!(out.contains("{start_of_verse: Verse 1}\nMy Jesus"), "{out}");
        assert!(
            out.contains("Here in Your love\nNow I surrender (I surrender)\n"),
            "{out}"
        );
    }

    #[test]
    fn chords() {
        for chord in [
            "G", "Am", "F#m7", "Bb", "Csus4", "D/F#", "Gmaj7", "Em7b5", "Asus", "C2", "Dadd9", "H",
            "Bm/A",
        ] {
            assert!(is_chord(chord), "{chord}");
        }
        for word in ["Amazing", "And", "Be", "Grace", "A-men", "Christ"] {
            assert!(!is_chord(word), "{word}");
        }
        assert!(is_chord_line("G  D/F#  Em  C  | x2"));
        assert!(!is_chord_line("Am I the one"));
    }
}
