pub mod modes;
pub mod split;

use serde::{Deserialize, Serialize};

use crate::library::chordpro::ParsedSong;

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
    pub copyright: Option<String>,
    pub ccli: Option<String>,
}

pub fn build_slides(song: &ParsedSong, theme: &SlideTheme, transpose: i32) -> Vec<SlidePayload> {
    let mut slides = Vec::new();
    let mut index = 0usize;
    let mut stanza_index = 0usize;
    for (section_index, section) in song.sections.iter().enumerate() {
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
            stanza_index += 1;
        }
    }
    slides
}

fn transpose_chord(chord: &str, semitones: i32) -> String {
    if semitones == 0 {
        return chord.to_string();
    }
    let notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    let re = regex::Regex::new(r"^([A-G](?:#|b)?)(.*)$").unwrap();
    if let Some(cap) = re.captures(chord) {
        let root = cap.get(1).map(|m| m.as_str()).unwrap_or("C");
        let suffix = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let idx = notes
            .iter()
            .position(|n| *n == root || (*n == "C#" && root == "Db") || (*n == "D#" && root == "Eb"))
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
    use crate::library::chordpro::parse_chordpro;

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
        assert!(slides.len() >= 3, "expected multiple slides, got {slides:?}");
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
        assert_eq!(slides.iter().map(|s| s.stanza_index).collect::<Vec<_>>(), vec![0, 1, 2]);
        assert!(slides.iter().all(|s| s.section_index == 0));
    }
}
