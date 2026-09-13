use std::path::PathBuf;

use psalm150_lib::import::import_mdb_to_folder;
use psalm150_lib::import::mdb::read_vsb_categories;

#[test]
fn imports_repository_mdb_without_overwriting_existing_files() {
    let mdb = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("brattvaag-2018-12-28.mdb");
    if !mdb.exists() {
        return;
    }

    let out = tempfile::tempdir().expect("create output dir");

    let categories = read_vsb_categories(&mdb).expect("read categories");
    let report = import_mdb_to_folder(&mdb, out.path(), &categories).expect("import");

    assert!(
        report.written > 900,
        "expected ~963 songs, got {}",
        report.written
    );
    assert!(out.path().read_dir().unwrap().any(|e| e
        .unwrap()
        .path()
        .extension()
        .is_some_and(|x| x == "pro")));

    let repeated = import_mdb_to_folder(&mdb, out.path(), &categories).expect("repeat import");
    assert_eq!(repeated.written, 0);
    assert!(repeated.skipped > 900);
}
