pub mod mdb;
pub mod vsb_to_chordpro;

use std::fs::OpenOptions;
use std::io::Write;
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
    pub failed: usize,
    pub warnings: Vec<String>,
    pub cancelled: bool,
    pub aborted_reason: Option<String>,
    pub files: Vec<ImportFileResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFileResult {
    pub filename: Option<String>,
    pub title: String,
    pub status: String,
    pub reason: Option<String>,
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
    pub stop_reason: Option<&'a dyn Fn() -> Option<String>>,
}

impl Default for ImportCallbacks<'_> {
    fn default() -> Self {
        Self {
            on_progress: None,
            should_cancel: None,
            stop_reason: None,
        }
    }
}

pub fn import_mdb_to_folder(
    mdb_path: &Path,
    songs_folder: &Path,
    categories: &[(i64, String)],
) -> Result<ImportReport, String> {
    import_mdb_to_folder_with_callbacks(
        mdb_path,
        songs_folder,
        categories,
        ImportCallbacks::default(),
    )
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
    let mut failed = 0usize;
    let mut warnings = Vec::new();
    let mut cancelled = false;
    let mut aborted_reason = None;
    let mut files = Vec::new();

    for (index, row) in rows.into_iter().enumerate() {
        if callbacks
            .should_cancel
            .as_ref()
            .is_some_and(|check| check())
        {
            cancelled = true;
            break;
        }
        if let Some(reason) = callbacks.stop_reason.as_ref().and_then(|check| check()) {
            aborted_reason = Some(reason);
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
                let path = match crate::library::files::song_path(songs_folder, &filename) {
                    Ok(path) => path,
                    Err(err) => {
                        failed += 1;
                        warnings.push(format!("Failed {filename}: {err}"));
                        files.push(ImportFileResult {
                            filename: Some(filename),
                            title: row.title,
                            status: "failed".into(),
                            reason: Some(err),
                        });
                        continue;
                    }
                };
                if path.exists() {
                    let reason = "A file with this name already exists".to_string();
                    skipped += 1;
                    warnings.push(format!("Skipped {filename}: {reason}"));
                    files.push(ImportFileResult {
                        filename: Some(filename),
                        title: row.title,
                        status: "skipped".into(),
                        reason: Some(reason),
                    });
                    continue;
                }
                match OpenOptions::new().write(true).create_new(true).open(&path) {
                    Ok(mut file) => match file
                        .write_all(content.as_bytes())
                        .and_then(|_| file.sync_all())
                    {
                        Ok(()) => {
                            written += 1;
                            files.push(ImportFileResult {
                                filename: Some(filename),
                                title: row.title,
                                status: "imported".into(),
                                reason: None,
                            });
                        }
                        Err(err) => {
                            let _ = std::fs::remove_file(&path);
                            failed += 1;
                            warnings.push(format!("Failed {filename}: {err}"));
                            files.push(ImportFileResult {
                                filename: Some(filename),
                                title: row.title,
                                status: "failed".into(),
                                reason: Some(err.to_string()),
                            });
                        }
                    },
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                        let reason = "A file with this name appeared during import".to_string();
                        skipped += 1;
                        warnings.push(format!("Skipped {filename}: {reason}"));
                        files.push(ImportFileResult {
                            filename: Some(filename),
                            title: row.title,
                            status: "skipped".into(),
                            reason: Some(reason),
                        });
                    }
                    Err(err) => {
                        failed += 1;
                        warnings.push(format!("Failed {filename}: {err}"));
                        files.push(ImportFileResult {
                            filename: Some(filename),
                            title: row.title,
                            status: "failed".into(),
                            reason: Some(err.to_string()),
                        });
                    }
                }
            }
            Err(err) => {
                skipped += 1;
                warnings.push(format!("Skipped {}: {err}", row.title));
                files.push(ImportFileResult {
                    filename: None,
                    title: row.title,
                    status: "skipped".into(),
                    reason: Some(err),
                });
            }
        }
    }

    Ok(ImportReport {
        written,
        skipped,
        failed,
        warnings,
        cancelled,
        aborted_reason,
        files,
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
                stop_reason: None,
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
