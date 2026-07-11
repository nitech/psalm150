use std::fs;
use std::path::PathBuf;

use praise_lib::library::chordpro::parse_chordpro;
use praise_lib::projection::modes::audience_slide;
use praise_lib::projection::split::{max_chars_per_row, split_section_into_stanzas};
use praise_lib::projection::{build_slides, SlideTheme};
use praise_lib::library::chordpro::{LyricLine, SectionKind, SongSection};

#[test]
fn imported_song_produces_audience_slides_with_lyrics() {
    let folder = PathBuf::from(r"c:\temp\vsb-import-test");
    if !folder.is_dir() {
        return;
    }

    let sample = folder.join("0966-give-thanks.pro");
    if !sample.is_file() {
        return;
    }

    let content = fs::read_to_string(&sample).expect("read sample song");
    let parsed = parse_chordpro(&content, "0966-give-thanks.pro");
    let slides = build_slides(&parsed, &SlideTheme::default(), 0);

    assert!(!slides.is_empty(), "expected at least one slide");
    let audience = audience_slide(&slides[0]);
    assert!(
        audience
            .lines
            .iter()
            .any(|line| !line.text.trim().is_empty()),
        "expected non-empty audience lyrics, got {:?}",
        audience.lines
    );
}

#[test]
fn long_verse_line_wraps_at_word_boundaries() {
    let theme = SlideTheme::default();
    let long = "Lov min Gud, Å min sjel, lov Herren min sjel og all min innerlighet, \
                lov Hans hellige navn, lov min sjel og glem ikke alle Hans goder";
    let section = SongSection {
        label: "Verse".into(),
        kind: SectionKind::Verse,
        lines: vec![LyricLine {
            text: long.into(),
            chords: vec![],
        }],
    };
    let stanzas = split_section_into_stanzas(&section, &theme);
    let rows: Vec<&str> = stanzas
        .iter()
        .flat_map(|s| s.iter())
        .flat_map(|c| c.iter())
        .map(|l| l.text.as_str())
        .collect();
    assert!(rows.len() >= 2, "expected wrapped rows, got {rows:?}");
    let max_chars = max_chars_per_row(&theme);
    for row in &rows {
        assert!(
            row.chars().count() <= max_chars + 5,
            "row exceeds width budget: {row}"
        );
    }
}

#[test]
fn audience_slides_never_contain_chord_brackets() {
    let content = r#"{title: Test}
{start_of_verse}
[Am]Praise [G]Him [C]all
"#;
    let parsed = parse_chordpro(content, "test.pro");
    let slides = build_slides(&parsed, &SlideTheme::default(), 0);
    for slide in &slides {
        let audience = audience_slide(slide);
        for line in &audience.lines {
            assert!(!line.text.contains('['), "chord bracket in audience: {}", line.text);
            assert!(line.chords.is_empty());
        }
    }
}
