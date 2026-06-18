use std::fs;
use std::path::PathBuf;

use visual_song_book_lib::library::chordpro::parse_chordpro;
use visual_song_book_lib::projection::modes::audience_slide;
use visual_song_book_lib::projection::{build_slides, SlideTheme};

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
        audience.lines.iter().any(|line| !line.text.trim().is_empty()),
        "expected non-empty audience lyrics, got {:?}",
        audience.lines
    );
}
