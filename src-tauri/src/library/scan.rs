use std::fs;
use std::path::{Path, PathBuf};

use crate::library::chordpro::{is_chordpro_filename, parse_chordpro, ParsedSong};

pub fn list_chordpro_files(folder: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for entry in fs::read_dir(folder).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if is_chordpro_filename(name) {
                    files.push(path);
                }
            }
        }
    }
    files.sort();
    Ok(files)
}

pub fn list_foreign_files(folder: &Path) -> Result<Vec<String>, String> {
    let mut foreign = Vec::new();
    for entry in fs::read_dir(folder).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if !is_chordpro_filename(name) {
                    foreign.push(name.to_string());
                }
            }
        }
    }
    foreign.sort();
    Ok(foreign)
}

pub fn list_conflicts(folder: &Path) -> Result<Vec<String>, String> {
    let mut conflicts = Vec::new();
    for entry in fs::read_dir(folder).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if let Some(name) = entry.file_name().to_str() {
            let lower = name.to_lowercase();
            if lower.contains("conflicted copy") || lower.contains(" (conflict)") {
                conflicts.push(name.to_string());
            }
        }
    }
    conflicts.sort();
    Ok(conflicts)
}

pub fn scan_songs_folder(folder: &Path) -> Result<Vec<ParsedSong>, String> {
    let files = list_chordpro_files(folder)?;
    let mut songs = Vec::new();
    for path in files {
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown.pro")
            .to_string();
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mut parsed = parse_chordpro(&content, &filename);
        if let Ok(meta) = fs::metadata(&path) {
            if let Ok(modified) = meta.modified() {
                if let Ok(datetime) = modified.duration_since(std::time::UNIX_EPOCH) {
                    parsed.meta.modified_at =
                        Some(chrono::DateTime::from_timestamp(datetime.as_secs() as i64, 0)
                            .map(|d| d.to_rfc3339())
                            .unwrap_or_default());
                }
            }
        }
        songs.push(parsed);
    }
    Ok(songs)
}
