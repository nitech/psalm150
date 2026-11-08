pub mod modes;
pub mod split;

use serde::{Deserialize, Serialize};

use crate::library::chordpro::{is_projectable_section, ParsedSong, SectionKind};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideTheme {
    pub font_name: String,
    pub font_size: f32,
    pub font_bold: bool,
    pub font_italic: bool,
    pub foreground: String,
    pub background: String,
    pub margin_top: u32,
    pub margin_left: u32,
    pub margin_right: u32,
    pub margin_bottom: u32,
    /// Target projector resolution used when splitting long sections into slides.
    #[serde(default = "default_projection_width")]
    pub projection_width: u32,
    #[serde(default = "default_projection_height")]
    pub projection_height: u32,
    pub show_title_overlay: bool,
    pub show_key_overlay: bool,
    pub show_copyright_overlay: bool,
    pub show_ccli_overlay: bool,
    /// The footer's text (song number and key, stanza counter) in percent of
    /// the screen's height: one size whatever the song's words are fitted to.
    #[serde(default = "default_footer_size")]
    pub footer_size: f32,
}

pub fn default_footer_size() -> f32 {
    4.0
}

fn default_projection_width() -> u32 {
    1920
}

fn default_projection_height() -> u32 {
    1080
}

impl Default for SlideTheme {
    fn default() -> Self {
        Self {
            font_name: "Arial Rounded MT Bold".into(),
            font_size: 28.0,
            font_bold: true,
            font_italic: false,
            foreground: "#ffffff".into(),
            background: "#000000".into(),
            margin_top: 40,
            margin_left: 48,
            margin_right: 48,
            margin_bottom: 48,
            projection_width: default_projection_width(),
            projection_height: default_projection_height(),
            show_title_overlay: true,
            show_key_overlay: true,
            show_copyright_overlay: true,
            show_ccli_overlay: false,
            footer_size: default_footer_size(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectionState {
    pub filename: Option<String>,
    pub title: Option<String>,
    pub key: Option<String>,
    pub ccli: Option<String>,
    pub nashville: bool,
    pub slides: Vec<SlidePayload>,
    pub current_index: usize,
    pub blank: bool,
    pub transpose_semitones: i32,
    pub hold_slide_id: Option<String>,
    /// Stanza indices in the order they are sung (see `suggested_order`).
    /// The arrow keys and the phone remote step through this, so a chorus
    /// written once comes back after every verse.
    #[serde(default)]
    pub order: Vec<usize>,
    /// Where in `order` the stanza on screen is.
    #[serde(default)]
    pub order_position: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlidePayload {
    pub index: usize,
    /// Index of the song section this slide belongs to (verse, chorus, etc.).
    #[serde(default)]
    pub section_index: usize,
    /// Index of the stanza (blank-line block) within the song.
    #[serde(default)]
    pub stanza_index: usize,
    pub section_label: String,
    pub lines: Vec<SlideLine>,
    pub overlay: SlideOverlay,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideLine {
    pub text: String,
    pub chords: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SlideOverlay {
    pub title: Option<String>,
    pub key: Option<String>,
    pub song_num: Option<i64>,
    pub copyright: Option<String>,
    pub ccli: Option<String>,
}

pub fn build_slides(song: &ParsedSong, theme: &SlideTheme, transpose: i32) -> Vec<SlidePayload> {
    build_slides_with_kinds(song, theme, transpose).0
}

/// The slides, and the section kind of each stanza (indexed by `stanza_index`).
pub fn build_slides_with_kinds(
    song: &ParsedSong,
    theme: &SlideTheme,
    transpose: i32,
) -> (Vec<SlidePayload>, Vec<SectionKind>) {
    let sections = expand_chorus_sections(&song.sections);
    let mut kinds = Vec::new();
    let mut slides = Vec::new();
    let mut index = 0usize;
    let mut stanza_index = 0usize;
    for (section_index, section) in sections.iter().enumerate() {
        if !is_projectable_section(&section.kind) {
            continue;
        }
        for stanza_slides in split::split_section_into_stanzas(section, theme) {
            for chunk in stanza_slides {
                let overlay = SlideOverlay {
                    title: if theme.show_title_overlay {
                        Some(song.meta.title.clone())
                    } else {
                        None
                    },
                    key: if theme.show_key_overlay {
                        song.meta.key.clone()
                    } else {
                        None
                    },
                    song_num: if theme.show_title_overlay {
                        song.meta.song_num
                    } else {
                        None
                    },
                    copyright: if theme.show_copyright_overlay {
                        song.meta.copyright.clone()
                    } else {
                        None
                    },
                    ccli: if theme.show_ccli_overlay {
                        song.meta.ccli.clone()
                    } else {
                        None
                    },
                };
                slides.push(SlidePayload {
                    index,
                    section_index,
                    stanza_index,
                    section_label: section.label.clone(),
                    lines: chunk
                        .into_iter()
                        .map(|line| SlideLine {
                            text: line.text,
                            chords: line
                                .chords
                                .into_iter()
                                .map(|c| transpose_chord(&c.chord, transpose))
                                .collect(),
                        })
                        .collect(),
                    overlay,
                });
                index += 1;
            }
            kinds.push(section.kind.clone());
            stanza_index += 1;
        }
    }
    (slides, kinds)
}

/// The order the stanzas are usually sung in. A song whose only chorus is
/// written once gets it after every verse that follows it (and after every
/// verse when the chorus comes first): verse 1, chorus, verse 2, chorus…
/// A pre-chorus written just before that chorus comes along with it. Songs
/// that write their choruses out, or have none, are sung as written.
pub fn suggested_order(kinds: &[SectionKind]) -> Vec<usize> {
    let as_written: Vec<usize> = (0..kinds.len()).collect();
    let choruses: Vec<usize> = kinds
        .iter()
        .enumerate()
        .filter(|(_, kind)| matches!(kind, SectionKind::Chorus | SectionKind::Chorus2))
        .map(|(index, _)| index)
        .collect();
    if choruses.len() != 1 {
        return as_written;
    }
    let chorus = choruses[0];
    let lead_in = (chorus > 0 && kinds[chorus - 1] == SectionKind::PreChorus).then(|| chorus - 1);
    let mut order = Vec::with_capacity(kinds.len() * 2);
    for index in as_written {
        order.push(index);
        if index > chorus {
            order.extend(lead_in);
            order.push(chorus);
        }
    }
    order
}

impl ProjectionState {
    fn stanza_of(&self, slide: usize) -> Option<usize> {
        self.slides.get(slide).map(|slide| slide.stanza_index)
    }

    fn first_slide_of(&self, stanza: usize) -> Option<usize> {
        self.slides
            .iter()
            .position(|slide| slide.stanza_index == stanza)
    }

    fn last_slide_of(&self, stanza: usize) -> Option<usize> {
        self.slides
            .iter()
            .rposition(|slide| slide.stanza_index == stanza)
    }

    /// Where in `order` slide `index`'s stanza is: the first time it comes at
    /// or after the current position, else its first time at all. So the
    /// chorus picked after verse 2 is the chorus after verse 2.
    fn locate(&self, index: usize) -> usize {
        let Some(stanza) = self.stanza_of(index) else {
            return 0;
        };
        let from = self.order_position.min(self.order.len());
        self.order[from..]
            .iter()
            .position(|&s| s == stanza)
            .map(|offset| from + offset)
            .or_else(|| self.order.iter().position(|&s| s == stanza))
            .unwrap_or(0)
    }

    /// Makes `order` and `order_position` agree with the slide on screen.
    fn sync_order(&mut self) {
        if self.order.is_empty() {
            let mut order: Vec<usize> =
                self.slides.iter().map(|slide| slide.stanza_index).collect();
            order.dedup();
            self.order = order;
        }
        if self.order.get(self.order_position).copied() != self.stanza_of(self.current_index) {
            self.order_position = self.locate(self.current_index);
        }
    }

    /// The slide that "next" shows, without moving there (the stage's next label).
    pub fn next_slide_index(&self) -> Option<usize> {
        let stanza = self.stanza_of(self.current_index)?;
        if self.stanza_of(self.current_index + 1) == Some(stanza) {
            return Some(self.current_index + 1);
        }
        if self.order.get(self.order_position) != Some(&stanza) {
            return (self.current_index + 1 < self.slides.len()).then_some(self.current_index + 1);
        }
        self.order
            .get(self.order_position + 1)
            .and_then(|&next| self.first_slide_of(next))
    }

    /// Shows slide `index` (a stanza picked by number or click).
    pub fn go_to_slide(&mut self, index: usize) {
        self.sync_order();
        self.current_index = index;
        self.order_position = self.locate(index);
    }

    /// Shows the first slide of the stanza at `position` in `order`.
    pub fn go_to_order_position(&mut self, position: usize) -> bool {
        self.sync_order();
        let Some(first) = self
            .order
            .get(position)
            .and_then(|&stanza| self.first_slide_of(stanza))
        else {
            return false;
        };
        let changed = first != self.current_index || position != self.order_position;
        self.current_index = first;
        self.order_position = position;
        changed
    }

    /// The next or previous slide: within the stanza, then on through `order`.
    pub fn step_slide(&mut self, forward: bool) -> bool {
        self.sync_order();
        let Some(stanza) = self.stanza_of(self.current_index) else {
            return false;
        };
        let current = self.current_index;
        if forward {
            if self.stanza_of(current + 1) == Some(stanza) {
                self.current_index += 1;
                return true;
            }
            return self.go_to_order_position(self.order_position + 1);
        }
        if current > 0 && self.stanza_of(current - 1) == Some(stanza) {
            self.current_index -= 1;
            return true;
        }
        let Some(position) = self.order_position.checked_sub(1) else {
            return false;
        };
        let Some(last) = self
            .order
            .get(position)
            .and_then(|&stanza| self.last_slide_of(stanza))
        else {
            return false;
        };
        self.current_index = last;
        self.order_position = position;
        true
    }

    /// The first slide of the next or previous stanza in `order`.
    pub fn step_stanza(&mut self, forward: bool) -> bool {
        self.sync_order();
        let position = if forward {
            self.order_position + 1
        } else {
            match self.order_position.checked_sub(1) {
                Some(position) => position,
                None => return false,
            }
        };
        self.go_to_order_position(position)
    }

    /// After a rebuild (a saved correction): keep the place in `order`.
    pub fn keep_order_position(&mut self, old: &ProjectionState) {
        self.order_position = old.order_position.min(self.order.len().saturating_sub(1));
        self.sync_order();
    }
}

/// The sections as written, the way the song server's web client shows them:
/// a second chorus (`{start_of_chorus2}`) is a chorus of its own where it is
/// written, and so is every chorus before it. An empty chorus (a slot) repeats
/// the last chorus of its kind with words, the first one when none came yet; an
/// empty chorus2 falls back to the chorus.
fn expand_chorus_sections(
    sections: &[crate::library::chordpro::SongSection],
) -> Vec<crate::library::chordpro::SongSection> {
    use crate::library::chordpro::{SectionKind, SongSection};

    let has_words = |section: &SongSection| section.lines.iter().any(|l| !l.text.is_empty());
    let first = |kind: SectionKind| {
        sections
            .iter()
            .find(|section| section.kind == kind && has_words(section))
    };
    let mut last_chorus: Option<&SongSection> = None;
    let mut last_alt: Option<&SongSection> = None;

    sections
        .iter()
        .map(|section| {
            let is_alt = match section.kind {
                SectionKind::Chorus => false,
                SectionKind::Chorus2 => true,
                _ => return section.clone(),
            };
            if has_words(section) {
                if is_alt {
                    last_alt = Some(section);
                } else {
                    last_chorus = Some(section);
                }
                return section.clone();
            }
            let chorus = last_chorus.or_else(|| first(SectionKind::Chorus));
            let source = if is_alt {
                last_alt.or_else(|| first(SectionKind::Chorus2)).or(chorus)
            } else {
                chorus
            };
            SongSection {
                lines: source.map_or_else(|| section.lines.clone(), |s| s.lines.clone()),
                ..section.clone()
            }
        })
        .collect()
}

fn transpose_chord(chord: &str, semitones: i32) -> String {
    if semitones == 0 {
        return chord.to_string();
    }
    let notes = [
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    ];
    let re = regex::Regex::new(r"^([A-G](?:#|b)?)(.*)$").unwrap();
    if let Some(cap) = re.captures(chord) {
        let root = cap.get(1).map(|m| m.as_str()).unwrap_or("C");
        let suffix = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let idx = notes
            .iter()
            .position(|n| {
                *n == root || (*n == "C#" && root == "Db") || (*n == "D#" && root == "Eb")
            })
            .unwrap_or(0) as i32;
        let new_idx = (idx + semitones).rem_euclid(12) as usize;
        return format!("{}{}", notes[new_idx], suffix);
    }
    chord.to_string()
}

pub fn blank_payload() -> SlidePayload {
    SlidePayload {
        index: 0,
        section_index: 0,
        stanza_index: 0,
        section_label: "Blank".into(),
        lines: vec![],
        overlay: SlideOverlay::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::chordpro::{parse_chordpro, SectionKind};
    use crate::projection::modes::{audience_slide, stage_slide};

    #[test]
    fn build_slides_assigns_distinct_section_indices_for_repeated_labels() {
        let content = r#"{title: Test}
{start_of_verse}
Line one
{start_of_verse}
Line two
{start_of_chorus}
Chorus line
{start_of_verse}
Line three
"#;
        let parsed = parse_chordpro(content, "test.pro");
        let slides = build_slides(&parsed, &SlideTheme::default(), 0);
        assert!(
            parsed.sections.len() >= 3,
            "expected multiple sections, got {:?}",
            parsed.sections.iter().map(|s| &s.label).collect::<Vec<_>>()
        );
        assert!(
            slides.len() >= 3,
            "expected multiple slides, got {slides:?}"
        );
        let indices: Vec<usize> = slides.iter().map(|s| s.section_index).collect();
        assert_eq!(
            indices,
            (0..parsed.sections.len()).collect::<Vec<_>>(),
            "section_index should match section order"
        );
    }

    #[test]
    fn build_slides_assigns_one_stanza_index_per_blank_line_block() {
        let content = r#"{title: Test}
{start_of_verse}
Stanza one line

Stanza two line

Stanza three line
"#;
        let parsed = parse_chordpro(content, "test.pro");
        let slides = build_slides(&parsed, &SlideTheme::default(), 0);
        assert_eq!(slides.len(), 3);
        assert_eq!(
            slides.iter().map(|s| s.stanza_index).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        assert_eq!(
            slides.iter().map(|s| s.section_index).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
    }

    #[test]
    fn every_chorus_shows_where_it_is_written() {
        // As the song server shows it: the chorus and the second chorus both,
        // in place (song 956 lost both while chorus2 was read as a template).
        let content = r#"{title: Two Choruses}
{start_of_verse}
Verse one
{end_of_verse}
{start_of_chorus}
Main chorus line
{end_of_chorus}
{start_of_verse}
Verse two
{end_of_verse}
{start_of_chorus2: Chorus2}
Alt chorus line
{end_of_chorus2}
"#;
        let parsed = parse_chordpro(content, "test.pro");
        let slides = build_slides(&parsed, &SlideTheme::default(), 0);
        let texts: Vec<&str> = slides.iter().map(|s| s.lines[0].text.as_str()).collect();
        assert_eq!(
            texts,
            vec!["Verse one", "Main chorus line", "Verse two", "Alt chorus line"]
        );
    }

    #[test]
    fn an_empty_chorus_repeats_the_last_one() {
        let content = r#"{title: Slots}
{start_of_chorus}
Main chorus line
{start_of_verse}
Verse
{start_of_chorus}
{start_of_chorus2}
Alt chorus line
"#;
        let parsed = parse_chordpro(content, "test.pro");
        let expanded = expand_chorus_sections(&parsed.sections);
        let texts: Vec<&str> = expanded
            .iter()
            .filter(|s| !s.lines.is_empty())
            .map(|s| s.lines[0].text.as_str())
            .collect();
        assert_eq!(
            texts,
            vec![
                "Main chorus line",
                "Verse",
                "Main chorus line",
                "Alt chorus line"
            ]
        );
    }

    #[test]
    fn audience_strips_chords_stage_keeps_them() {
        let content = r#"{title: Chord Test}
{start_of_verse}
[Am]Hello [G]world
"#;
        let parsed = parse_chordpro(content, "test.pro");
        let slides = build_slides(&parsed, &SlideTheme::default(), 0);
        let slide = &slides[0];
        let audience = audience_slide(slide);
        assert!(
            audience.lines.iter().all(|l| l.chords.is_empty()),
            "audience should have no chords"
        );
        assert_eq!(audience.lines[0].text, "Hello world");
        assert!(
            !audience.lines[0].text.contains('['),
            "audience text should not contain chord brackets"
        );
        let stage = stage_slide(slide, &parsed, None, false);
        assert!(
            !stage.lines[0].chords.is_empty(),
            "stage should retain chords"
        );
    }

    #[test]
    fn overlay_includes_song_num() {
        let content = r#"{title: Numbered}
{meta: song_num=227}
{key: G}
{start_of_verse}
Line
"#;
        let parsed = parse_chordpro(content, "227.pro");
        let slides = build_slides(&parsed, &SlideTheme::default(), 0);
        assert_eq!(slides[0].overlay.song_num, Some(227));
        assert_eq!(slides[0].overlay.title.as_deref(), Some("Numbered"));
        assert_eq!(slides[0].overlay.key.as_deref(), Some("G"));
    }

    fn kinds_of(content: &str) -> Vec<SectionKind> {
        let parsed = parse_chordpro(content, "test.pro");
        build_slides_with_kinds(&parsed, &SlideTheme::default(), 0).1
    }

    #[test]
    fn a_chorus_written_once_follows_every_later_verse() {
        let kinds = kinds_of(
            "{start_of_verse}\nV1\n{end_of_verse}\n{start_of_chorus}\nC\n{end_of_chorus}\n{start_of_verse}\nV2\n{end_of_verse}\n{start_of_verse}\nV3\n{end_of_verse}\n",
        );
        assert_eq!(suggested_order(&kinds), vec![0, 1, 2, 1, 3, 1]);
    }

    #[test]
    fn a_chorus_first_comes_back_after_each_verse() {
        let kinds = kinds_of(
            "{start_of_chorus}\nC\n{end_of_chorus}\n{start_of_verse}\nV1\n{end_of_verse}\n{start_of_verse}\nV2\n{end_of_verse}\n",
        );
        assert_eq!(suggested_order(&kinds), vec![0, 1, 0, 2, 0]);
    }

    #[test]
    fn a_pre_chorus_comes_along_with_its_chorus() {
        use SectionKind::*;
        assert_eq!(
            suggested_order(&[Verse, PreChorus, Chorus, Verse]),
            vec![0, 1, 2, 3, 1, 2]
        );
    }

    #[test]
    fn songs_with_written_out_choruses_or_none_are_sung_as_written() {
        use SectionKind::*;
        assert_eq!(
            suggested_order(&[Verse, Chorus, Verse, Chorus]),
            vec![0, 1, 2, 3]
        );
        assert_eq!(suggested_order(&[Verse, Verse, Verse]), vec![0, 1, 2]);
        assert_eq!(suggested_order(&[Verse, Chorus]), vec![0, 1]);
    }

    fn state_for(stanzas: &[usize], order: Vec<usize>) -> ProjectionState {
        let slides = stanzas
            .iter()
            .enumerate()
            .map(|(index, &stanza_index)| SlidePayload {
                index,
                section_index: stanza_index,
                stanza_index,
                section_label: String::new(),
                lines: vec![],
                overlay: SlideOverlay::default(),
            })
            .collect();
        ProjectionState {
            slides,
            order,
            ..Default::default()
        }
    }

    #[test]
    fn stepping_follows_the_order_and_the_slides_within_a_stanza() {
        // Stanza 1 (the chorus) has two slides.
        let mut state = state_for(&[0, 1, 1, 2], vec![0, 1, 2, 1]);
        let mut seen = vec![state.current_index];
        while state.step_slide(true) {
            seen.push(state.current_index);
        }
        assert_eq!(seen, vec![0, 1, 2, 3, 1, 2]);
        assert_eq!(state.order_position, 3);
        assert!(state.step_slide(false));
        assert_eq!(state.current_index, 1);
        assert!(state.step_slide(false));
        assert_eq!((state.current_index, state.order_position), (3, 2));
        assert!(state.step_stanza(false));
        assert_eq!((state.current_index, state.order_position), (1, 1));
    }

    #[test]
    fn picking_a_stanza_finds_its_next_place_in_the_order() {
        let mut state = state_for(&[0, 1, 2, 3], vec![0, 1, 2, 1, 3, 1]);
        state.go_to_slide(2);
        assert_eq!(state.order_position, 2);
        state.go_to_slide(1);
        assert_eq!(state.order_position, 3);
        state.go_to_slide(0);
        assert_eq!(state.order_position, 0);
        assert!(state.step_stanza(true));
        assert_eq!((state.current_index, state.order_position), (1, 1));
    }

    #[test]
    fn intro_and_interlude_produce_no_slides() {
        let content = r#"{title: Test}
{start_of_intro}
[G]Intro only
{end_of_intro}
{start_of_interlude}
Instrumental break
{end_of_interlude}
{start_of_prechorus}
Pre chorus sung
{end_of_prechorus}
{start_of_verse}
Verse line
"#;
        let parsed = parse_chordpro(content, "test.pro");
        let slides = build_slides(&parsed, &SlideTheme::default(), 0);
        let texts: Vec<&str> = slides
            .iter()
            .flat_map(|s| s.lines.iter().map(|l| l.text.as_str()))
            .collect();
        assert!(!texts.iter().any(|t| t.contains("Intro only")));
        assert!(!texts.iter().any(|t| t.contains("Instrumental break")));
        assert!(texts.contains(&"Pre chorus sung"));
        assert!(texts.contains(&"Verse line"));
    }
}
