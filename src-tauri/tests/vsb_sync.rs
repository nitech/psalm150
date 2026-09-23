//! Writes to a temporary copy of the sample VSB database through the Access
//! ODBC driver. Skipped when the driver is not installed.

use std::fs;
use std::path::{Path, PathBuf};

use psalm150_lib::import::mdb::read_vsb_mdb;
use psalm150_lib::library::chordpro::parse_chordpro;
use psalm150_lib::vsb_sync::fields::{fields_from_song, row_hash};
use psalm150_lib::vsb_sync::writer::open_writer;
use psalm150_lib::vsb_sync::{self, LibraryTarget, SyncRun};

fn fixture_copy(dir: &Path) -> PathBuf {
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("brattvaag-2018-12-28.mdb");
    let copy = dir.join("songs.mdb");
    fs::copy(source, &copy).unwrap();
    copy
}

#[test]
fn writer_round_trips_unicode_and_long_bodies() {
    let dir = tempfile::tempdir().unwrap();
    let mdb = fixture_copy(dir.path());
    let mut writer = match open_writer(&mdb) {
        Ok(writer) => writer,
        Err(error) => {
            eprintln!("skipping: {error}");
            return;
        }
    };

    let long_verse = "Lov min Gud, å min sjel – ære være Ham\n".repeat(200);
    let content = format!(
        "{{title: Æ Ø Å test}}\n{{key: D}}\n{{meta: alt_keys=E}}\n{{artist: Søster Berit}}\n\n{{start_of_chorus}}\n[D]Syng for [A]Herren\n{{end_of_chorus}}\n\n{long_verse}"
    );
    let song = parse_chordpro(&content, "test.pro");
    let fields = fields_from_song(&song, &[], 0);
    let id = writer.insert(&fields).unwrap();
    drop(writer);

    let rows = read_vsb_mdb(&mdb).unwrap();
    let row = rows
        .iter()
        .find(|row| row.song_id == id)
        .expect("inserted row");
    assert_eq!(row.title, "Æ Ø Å test");
    assert_eq!(row.key.as_deref(), Some("D / E"));
    assert_eq!(row.author.as_deref(), Some("Søster Berit"));
    assert!(row
        .body
        .starts_with("chorus\r\nD        A\r\nSyng for Herren"));
    assert!(row.body.len() > 4000);
    let before = row_hash(row);

    let mut writer = open_writer(&mdb).unwrap();
    let mut changed = fields.clone();
    changed.title = "Endret tittel".into();
    writer.update(id, &changed).unwrap();
    drop(writer);
    let rows = read_vsb_mdb(&mdb).unwrap();
    let row = rows.iter().find(|row| row.song_id == id).unwrap();
    assert_eq!(row.title, "Endret tittel");
    assert_ne!(row_hash(row), before);

    let mut writer = open_writer(&mdb).unwrap();
    writer.delete(id).unwrap();
    drop(writer);
    assert!(read_vsb_mdb(&mdb)
        .unwrap()
        .iter()
        .all(|row| row.song_id != id));
}

#[test]
fn second_run_is_quiet_and_edits_reach_vsb() {
    let dir = tempfile::tempdir().unwrap();
    let mdb = fixture_copy(dir.path());
    if let Err(error) = open_writer(&mdb) {
        eprintln!("skipping: {error}");
        return;
    }
    let songs = dir.path().join("songs");
    fs::create_dir_all(&songs).unwrap();
    psalm150_lib::import::import_mdb_to_folder(
        &mdb,
        &songs,
        &psalm150_lib::import::mdb::read_vsb_categories(&mdb).unwrap(),
    )
    .unwrap();
    let backups = dir.path().join("backups");
    let manifest = std::collections::HashMap::new();
    let progress = |_| {};
    let run = |links: &[vsb_sync::plan::Link]| {
        vsb_sync::run(
            SyncRun {
                mdb_path: &mdb,
                songs_folder: &songs,
                target: LibraryTarget::Server {
                    manifest: &manifest,
                },
                backup_dir: &backups,
                progress: &progress,
                open_writer: &open_writer,
            },
            links,
        )
        .unwrap()
    };

    let first = run(&[]);
    assert!(first.report.linked > 900, "linked {}", first.report.linked);
    assert_eq!(first.report.rows_written + first.report.rows_inserted, 0);
    assert!(first.server_ops.is_empty());

    let second = run(&first.links);
    assert_eq!(second.report.summary(), "Everything is in step");

    // Edit one imported song in Psalm150; the row follows, then all is quiet.
    let link = &second.links[0];
    let path = songs.join(&link.filename);
    let text = fs::read_to_string(&path).unwrap();
    fs::write(&path, text.replacen("{title: ", "{title: Edited ", 1)).unwrap();
    let third = run(&second.links);
    assert_eq!(third.report.rows_written, 1, "{:?}", third.report);
    assert!(third.report.backup.is_some());
    let row = read_vsb_mdb(&mdb)
        .unwrap()
        .into_iter()
        .find(|row| row.song_id == link.song_id)
        .unwrap();
    assert!(row.title.starts_with("Edited "));

    let fourth = run(&third.links);
    assert_eq!(fourth.report.summary(), "Everything is in step");
}
