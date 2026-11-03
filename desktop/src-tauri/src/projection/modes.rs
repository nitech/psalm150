use crate::library::chordpro::ParsedSong;
use crate::projection::{SlideLine, SlidePayload};

pub fn audience_slide(slide: &SlidePayload) -> SlidePayload {
    SlidePayload {
        index: slide.index,
        section_index: slide.section_index,
        stanza_index: slide.stanza_index,
        section_label: slide.section_label.clone(),
        lines: slide
            .lines
            .iter()
            .map(|l| SlideLine {
                text: l.text.clone(),
                chords: vec![],
            })
            .collect(),
        overlay: slide.overlay.clone(),
    }
}

pub fn stage_slide(
    slide: &SlidePayload,
    song: &ParsedSong,
    next_label: Option<String>,
    nashville: bool,
) -> StageSlide {
    StageSlide {
        index: slide.index,
        section_label: slide.section_label.clone(),
        next_section_label: next_label,
        lines: slide.lines.clone(),
        overlay: slide.overlay.clone(),
        nashville,
        key: song.meta.key.clone(),
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StageSlide {
    pub index: usize,
    pub section_label: String,
    pub next_section_label: Option<String>,
    pub lines: Vec<SlideLine>,
    pub overlay: crate::projection::SlideOverlay,
    pub nashville: bool,
    pub key: Option<String>,
}
