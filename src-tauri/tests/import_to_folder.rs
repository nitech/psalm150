use std::path::PathBuf;

use visual_song_book_lib::import::mdb::read_vsb_categories;
use visual_song_book_lib::import::import_mdb_to_folder;

#[test]
fn imports_temp_brattvaag_mdb_when_present() {
    let mdb = PathBuf::from(r"c:\temp\brattvaag-2018-12-28.mdb");
    if !mdb.exists() {
        return;
    }

    let out = PathBuf::from(r"c:\temp\vsb-import-test");
    std::fs::create_dir_all(&out).expect("create output dir");

    let categories = read_vsb_categories(&mdb).expect("read categories");
    let report = import_mdb_to_folder(&mdb, &out, &categories).expect("import");

    assert!(report.written > 900, "expected ~963 songs, got {}", report.written);
    assert!(out.read_dir().unwrap().any(|e| e.unwrap().path().extension().is_some_and(|x| x == "pro")));
}
