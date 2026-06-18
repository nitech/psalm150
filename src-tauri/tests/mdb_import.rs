use std::path::PathBuf;

use praise_lib::import::mdb::{read_page_setup, read_vsb_categories, read_vsb_mdb};

#[test]
fn imports_brattvaag_sample_when_present() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("brattvaag-2018-12-28.mdb");
    if !path.exists() {
        return;
    }

    let songs = read_vsb_mdb(&path).expect("read songs");
    assert!(songs.len() > 900, "expected ~963 songs, got {}", songs.len());

    let categories = read_vsb_categories(&path).expect("read categories");
    assert!(!categories.is_empty());

    let theme = read_page_setup(&path).expect("read theme");
    assert!(theme.font_size > 0.0);
}
