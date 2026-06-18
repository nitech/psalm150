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
}

pub fn import_mdb_to_folder(
    mdb_path: &Path,
    songs_folder: &Path,
    categories: &[(i64, String)],
) -> Result<ImportReport, String> {
    let rows = read_vsb_mdb(mdb_path)?;
    let mut written = 0usize;
    let mut skipped = 0usize;
    let mut warnings = Vec::new();

    for row in rows {
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
    })
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
