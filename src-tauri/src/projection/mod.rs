pub mod modes;
pub mod split;

use serde::{Deserialize, Serialize};

use crate::library::chordpro::{is_projectable_section, ParsedSong};

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
    pub song_num: Option<i64>,
    pub copyright: Option<String>,
    pub ccli: Option<String>,
}

pub fn build_slides(song: &ParsedSong, theme: &SlideTheme, transpose: i32) -> Vec<SlidePayload> {
    let sections = expand_chorus_sections(&song.sections);
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
            stanza_index += 1;
        }
    }
    slides
}

/// Chorus2 sections are alternate-chorus templates. When a song defines chorus2,
/// the main chorus block before it is also a template; performance slots after
/// chorus2 alternate between main and alternate content.
fn expand_chorus_sections(sections: &[crate::library::chordpro::SongSection]) -> Vec<crate::library::chordpro::SongSection> {
    use crate::library::chordpro::{SectionKind, SongSection};

    let chorus2_idx = sections.iter().position(|s| s.kind == SectionKind::Chorus2);
    let Some(alt_idx) = chorus2_idx else {
        return sections.to_vec();
    };

    let main_chorus = sections
        .iter()
        .take(alt_idx)
        .find(|s| s.kind == SectionKind::Chorus)
        .cloned();
    let alt_chorus = sections.get(alt_idx).cloned();

    let mut use_alt = false;
    let mut result = Vec::new();

    for (idx, section) in sections.iter().enumerate() {
        match section.kind {
            SectionKind::Chorus2 => {}
            SectionKind::Chorus if idx < alt_idx => {}
            SectionKind::Chorus => {
                let source = if use_alt {
                    alt_chorus.as_ref().or(main_chorus.as_ref())
                } else {
                    main_chorus.as_ref()
                };
                if let Some(src) = source {
                    let lines = if section.lines.iter().any(|l| !l.text.is_empty()) {
                        section.lines.clone()
                    } else {
                        src.lines.clone()
                    };
                    result.push(SongSection {
                        label: section.label.clone(),
                        kind: if use_alt && alt_chorus.is_some() {
                            SectionKind::Chorus2
                        } else {
                            SectionKind::Chorus
                        },
                        lines,
                    });
                }
                use_alt = !use_alt;
            }
            _ => result.push(section.clone()),
        }
    }

    result
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
    fn expand_chorus_alternates_main_and_alt_after_chorus2_defined() {
        let content = r#"{title: Alt Chorus Test}
{start_of_verse}
Verse one
{start_of_chorus}
Main chorus line
{start_of_chorus2}
Alt chorus line
{start_of_verse}
Verse two
{start_of_chorus}
{start_of_chorus}
"#;
        let parsed = parse_chordpro(content, "test.pro");
        let slides = build_slides(&parsed, &SlideTheme::default(), 0);
        let chorus_texts: Vec<String> = slides
            .iter()
            .filter(|s| s.section_label.starts_with("Chorus"))
            .map(|s| s.lines[0].text.clone())
            .collect();
        assert_eq!(chorus_texts, vec!["Main chorus line", "Alt chorus line"]);
    }

    #[test]
    fn chorus2_definition_does_not_produce_slides() {
        let content = r#"{title: Test}
{start_of_chorus}
Main only
{start_of_chorus2}
Alt template only
{start_of_verse}
Verse
"#;
        let parsed = parse_chordpro(content, "test.pro");
        let expanded = expand_chorus_sections(&parsed.sections);
        assert!(
            !expanded.iter().any(|s| s.kind == SectionKind::Chorus2 && s.lines.iter().any(|l| l.text.contains("Alt template")))
                || expanded.len() < parsed.sections.len(),
            "chorus2 template should not appear as its own performance section before a chorus slot"
        );
        let slides = build_slides(&parsed, &SlideTheme::default(), 0);
        let texts: Vec<&str> = slides
            .iter()
            .flat_map(|s| s.lines.iter().map(|l| l.text.as_str()))
            .collect();
        assert!(!texts.contains(&"Alt template only"));
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
