pub mod mdb;
pub mod vsb_to_chordpro;

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::config;
use crate::db::Database;
use crate::import::mdb::read_vsb_mdb;
use crate::import::vsb_to_chordpro::convert_song;
use crate::library::scan::scan_songs_folder;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportReport {
    pub written: usize,
    pub skipped: usize,
    pub warnings: Vec<String>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportProgress {
    pub current: usize,
    pub total: usize,
    pub song_title: String,
}

pub struct ImportCallbacks<'a> {
    pub on_progress: Option<&'a dyn Fn(ImportProgress)>,
    pub should_cancel: Option<&'a dyn Fn() -> bool>,
}

impl Default for ImportCallbacks<'_> {
    fn default() -> Self {
        Self {
            on_progress: None,
            should_cancel: None,
        }
    }
}

pub fn import_mdb_to_folder(
    mdb_path: &Path,
    songs_folder: &Path,
    categories: &[(i64, String)],
) -> Result<ImportReport, String> {
    import_mdb_to_folder_with_callbacks(mdb_path, songs_folder, categories, ImportCallbacks::default())
}

pub fn import_mdb_to_folder_with_callbacks(
    mdb_path: &Path,
    songs_folder: &Path,
    categories: &[(i64, String)],
    callbacks: ImportCallbacks<'_>,
) -> Result<ImportReport, String> {
    let rows = read_vsb_mdb(mdb_path)?;
    let total = rows.len();
    let mut written = 0usize;
    let mut skipped = 0usize;
    let mut warnings = Vec::new();
    let mut cancelled = false;

    for (index, row) in rows.into_iter().enumerate() {
        if callbacks
            .should_cancel
            .as_ref()
            .is_some_and(|check| check())
        {
            cancelled = true;
            break;
        }

        if let Some(on_progress) = callbacks.on_progress.as_ref() {
            on_progress(ImportProgress {
                current: index + 1,
                total,
                song_title: row.title.clone(),
            });
        }

        match convert_song(&row, categories) {
            Ok((filename, content)) => {
                let path = songs_folder.join(&filename);
                if path.exists() {
                    warnings.push(format!("Overwriting existing file: {filename}"));
                }
                std::fs::write(&path, content).map_err(|e| e.to_string())?;
                written += 1;
            }
            Err(err) => {
                skipped += 1;
                warnings.push(format!("Skipped {}: {err}", row.title));
            }
        }
    }

    Ok(ImportReport {
        written,
        skipped,
        warnings,
        cancelled,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use crate::import::mdb::read_vsb_categories;

    #[test]
    fn import_can_be_cancelled_when_sample_mdb_present() {
        let mdb = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("brattvaag-2018-12-28.mdb");
        if !mdb.exists() {
            return;
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let categories = read_vsb_categories(&mdb).expect("read categories");
        let processed = AtomicUsize::new(0);
        let report = import_mdb_to_folder_with_callbacks(
            &mdb,
            dir.path(),
            &categories,
            ImportCallbacks {
                on_progress: None,
                should_cancel: Some(&|| processed.fetch_add(1, Ordering::SeqCst) > 5),
            },
        )
        .expect("import");

        assert!(report.cancelled);
        assert!(report.written <= 6);
    }
}

pub fn rescan_and_index(
    app: &tauri::AppHandle,
    folder_hash: &str,
    songs_folder: &Path,
    db: &Database,
) -> Result<usize, String> {
    let songs = scan_songs_folder(songs_folder)?;
    let count = songs.len();
    db.rebuild_from_songs(&songs)?;
    let _ = config::ensure_library_layout(app, folder_hash);
    Ok(count)
}
