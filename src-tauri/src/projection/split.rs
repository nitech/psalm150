use crate::library::chordpro::{LyricLine, SongSection};
use crate::projection::SlideTheme;

const LINE_HEIGHT_RATIO: f32 = 1.28;
const LINE_GAP_RATIO: f32 = 0.35;
const CHAR_WIDTH_RATIO: f32 = 0.55;
const SCREEN_PADDING: u32 = 64;
const OVERLAY_RESERVE: u32 = 88;

pub fn split_section(section: &SongSection, theme: &SlideTheme) -> Vec<Vec<LyricLine>> {
    if section.lines.is_empty() {
        return vec![];
    }

    let mut chunks = Vec::new();
    for block in split_into_blocks(&section.lines) {
        chunks.extend(split_block_by_height(&block, theme));
    }
    chunks
}

/// Blank lines in a section mark stanza boundaries — each block becomes its own slide(s).
fn split_into_blocks(lines: &[LyricLine]) -> Vec<Vec<LyricLine>> {
    let mut blocks = Vec::new();
    let mut current = Vec::new();

    for line in lines {
        if line.text.is_empty() {
            if !current.is_empty() {
                blocks.push(std::mem::take(&mut current));
            }
        } else {
            current.push(line.clone());
        }
    }

    if !current.is_empty() {
        blocks.push(current);
    }

    blocks
}

fn split_block_by_height(block: &[LyricLine], theme: &SlideTheme) -> Vec<Vec<LyricLine>> {
    if block.is_empty() {
        return vec![];
    }

    let max_units = max_visual_units(theme);
    if section_visual_units(block, theme) <= max_units {
        return vec![block.to_vec()];
    }

    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut current_units = 0usize;

    for line in block {
        let line_units = line_visual_units(line, theme);
        if !current.is_empty() && current_units + line_units > max_units {
            chunks.push(std::mem::take(&mut current));
            current_units = 0;
        }
        current_units += line_units;
        current.push(line.clone());
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    chunks
}

fn max_visual_units(theme: &SlideTheme) -> usize {
    let font = theme.font_size.max(12.0);
    let overlay = if theme.show_title_overlay
        || theme.show_key_overlay
        || theme.show_copyright_overlay
        || theme.show_ccli_overlay
    {
        OVERLAY_RESERVE
    } else {
        0
    };

    let available_height = theme
        .projection_height
        .saturating_sub(theme.margin_top)
        .saturating_sub(theme.margin_bottom)
        .saturating_sub(SCREEN_PADDING * 2)
        .saturating_sub(overlay) as f32;

    let unit_height = font * (LINE_HEIGHT_RATIO + LINE_GAP_RATIO);
    if unit_height <= 0.0 {
        return 4;
    }

    let units = (available_height / unit_height).floor() as usize;
    units.clamp(2, 24)
}

fn section_visual_units(lines: &[LyricLine], theme: &SlideTheme) -> usize {
    lines
        .iter()
        .map(|line| line_visual_units(line, theme))
        .sum()
}

fn line_visual_units(line: &LyricLine, theme: &SlideTheme) -> usize {
    let font = theme.font_size.max(12.0);
    let available_width = theme
        .projection_width
        .saturating_sub(theme.margin_left)
        .saturating_sub(theme.margin_right)
        .saturating_sub(SCREEN_PADDING * 2) as f32;
    let chars_per_row = ((available_width / (font * CHAR_WIDTH_RATIO)).floor() as usize).max(8);
    let text_len = line.text.chars().count().max(1);
    (text_len + chars_per_row - 1) / chars_per_row
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::chordpro::{SectionKind, SongSection};

    fn line(text: &str) -> LyricLine {
        LyricLine {
            text: text.into(),
            chords: vec![],
        }
    }

    fn section(lines: Vec<&str>) -> SongSection {
        SongSection {
            label: "Verse".into(),
            kind: SectionKind::Verse,
            lines: lines.into_iter().map(line).collect(),
        }
    }

    #[test]
    fn blank_lines_split_into_separate_slides() {
        let theme = SlideTheme::default();
        let section = section(vec![
            "Lov min Gud, Å min sjel",
            "",
            "Å min sjel",
            "",
            "Solen står opp",
            "og en ny dag begynner",
        ]);
        let chunks = split_section(&section, &theme);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].len(), 1);
        assert_eq!(chunks[0][0].text, "Lov min Gud, Å min sjel");
        assert_eq!(chunks[1].len(), 1);
        assert_eq!(chunks[1][0].text, "Å min sjel");
        assert_eq!(chunks[2].len(), 2);
    }

    #[test]
    fn short_section_stays_on_one_slide() {
        let theme = SlideTheme::default();
        let chunks = split_section(
            &section(vec!["Give thanks with a grateful heart", "Give thanks to the Holy One"]),
            &theme,
        );
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].len(), 2);
    }

    #[test]
    fn long_section_splits_across_slides() {
        let theme = SlideTheme {
            font_size: 64.0,
            projection_height: 720,
            ..SlideTheme::default()
        };
        let lines: Vec<String> = (0..16)
            .map(|i| format!("This is verse line number {i} with extra words to wrap"))
            .collect();
        let section = SongSection {
            label: "Verse".into(),
            kind: SectionKind::Verse,
            lines: lines.iter().map(|s| line(s)).collect(),
        };

        let chunks = split_section(&section, &theme);
        assert!(chunks.len() > 1, "expected overflow split, got {} chunk(s)", chunks.len());

        for chunk in &chunks {
            assert!(
                section_visual_units(chunk, &theme) <= max_visual_units(&theme) + 2,
                "chunk exceeded visual budget"
            );
        }
    }

    #[test]
    fn wrapped_line_counts_toward_slide_budget() {
        let theme = SlideTheme {
            font_size: 48.0,
            projection_width: 1280,
            projection_height: 720,
            ..SlideTheme::default()
        };
        let long = "word ".repeat(40);
        let units = line_visual_units(&line(&long), &theme);
        assert!(units >= 3, "expected wrapped line to consume multiple units, got {units}");
    }
}
