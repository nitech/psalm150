use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use slug::slugify;
use tauri::{AppHandle, State};

use crate::config::load_theme;
use crate::library::chordpro::{parse_chordpro, serialize_chordpro, ParsedSong};
use crate::projection::{build_slides, ProjectionState};
use crate::{with_state, AppState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongDetail {
    pub parsed: ParsedSong,
    pub projection: ProjectionState,
}

fn theme_for_runtime(
    app: &AppHandle,
    folder_hash: &Option<String>,
) -> crate::projection::SlideTheme {
    folder_hash
        .as_ref()
        .and_then(|hash| load_theme(app, hash).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn load_song(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: String,
) -> Result<SongDetail, String> {
    with_state(&state, |runtime| {
        let folder = runtime
            .songs_folder
            .as_ref()
            .ok_or_else(|| "No songs folder selected".to_string())?;
        let path = folder.join(&filename);
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let parsed = parse_chordpro(&content, &filename);
        let theme = theme_for_runtime(&app, &runtime.folder_hash);
        let slides = build_slides(&parsed, &theme, runtime.projection.transpose_semitones);
        runtime.projection = ProjectionState {
            filename: Some(filename),
            title: Some(parsed.meta.title.clone()),
            key: parsed.meta.key.clone(),
            ccli: parsed.meta.ccli.clone(),
            nashville: runtime.projection.nashville,
            slides,
            current_index: 0,
            blank: false,
            transpose_semitones: runtime.projection.transpose_semitones,
            hold_slide_id: None,
        };
        Ok(SongDetail {
            parsed,
            projection: runtime.projection.clone(),
        })
    })
}

#[tauri::command]
pub fn save_song(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: String,
    content: String,
) -> Result<SongDetail, String> {
    with_state(&state, |runtime| {
        if runtime.read_only {
            return Err("Library is in read-only mode".into());
        }
        let folder = runtime
            .songs_folder
            .as_ref()
            .ok_or_else(|| "No songs folder selected".to_string())?;
        let path = folder.join(&filename);
        fs::write(&path, &content).map_err(|e| e.to_string())?;
        let parsed = parse_chordpro(&content, &filename);
        if let Some(db) = runtime.db.as_ref() {
            db.upsert_song(&parsed)?;
        }
        let theme = theme_for_runtime(&app, &runtime.folder_hash);
        let slides = build_slides(&parsed, &theme, runtime.projection.transpose_semitones);
        runtime.projection.slides = slides;
        runtime.projection.title = Some(parsed.meta.title.clone());
        runtime.projection.filename = Some(filename);
        Ok(SongDetail {
            parsed,
            projection: runtime.projection.clone(),
        })
    })
}

#[tauri::command]
pub fn delete_song(state: State<'_, AppState>, filename: String) -> Result<(), String> {
    with_state(&state, |runtime| {
        if runtime.read_only {
            return Err("Library is in read-only mode".into());
        }
        let folder = runtime
            .songs_folder
            .as_ref()
            .ok_or_else(|| "No songs folder selected".to_string())?;
        fs::remove_file(folder.join(&filename)).map_err(|e| e.to_string())?;
        if let Some(db) = runtime.db.as_ref() {
            db.delete_song(&filename)?;
        }
        Ok(())
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenumberPlan {
    pub from: i64,
    pub to: i64,
}

#[tauri::command]
pub fn renumber_songs(
    state: State<'_, AppState>,
    plans: Vec<RenumberPlan>,
) -> Result<Vec<String>, String> {
    with_state(&state, |runtime| {
        if runtime.read_only {
            return Err("Library is in read-only mode".into());
        }
        let folder = runtime
            .songs_folder
            .as_ref()
            .ok_or_else(|| "No songs folder selected".to_string())?
            .clone();
        let db = runtime
            .db
            .as_ref()
            .ok_or_else(|| "Database not open".to_string())?;
        let songs = db.list_all(false)?;
        let mut messages = Vec::new();
        for plan in plans {
            if let Some(song) = songs.iter().find(|s| s.song_num == Some(plan.from)) {
                let old_path = folder.join(&song.filename);
                let slug = slugify(&song.title);
                let slug = if slug.is_empty() { "song".into() } else { slug };
                let new_name = format!("{:04}-{}.pro", plan.to, slug);
                let new_path = folder.join(&new_name);
                fs::rename(&old_path, &new_path).map_err(|e| e.to_string())?;
                let content = fs::read_to_string(&new_path).map_err(|e| e.to_string())?;
                let mut parsed = parse_chordpro(&content, &new_name);
                parsed.meta.song_num = Some(plan.to);
                parsed.meta.filename = new_name.clone();
                let updated = serialize_chordpro(&parsed);
                fs::write(&new_path, updated).map_err(|e| e.to_string())?;
                db.delete_song(&song.filename)?;
                db.upsert_song(&parsed)?;
                messages.push(format!("Renumbered {} -> {}", song.filename, new_name));
            }
        }
        Ok(messages)
    })
}

#[tauri::command]
pub fn compact_library(state: State<'_, AppState>) -> Result<String, String> {
    with_state(&state, |runtime| {
        let folder = runtime
            .songs_folder
            .as_ref()
            .ok_or_else(|| "No songs folder selected".to_string())?;
        let db = runtime
            .db
            .as_ref()
            .ok_or_else(|| "Database not open".to_string())?;
        db.vacuum()?;
        let indexed = db.all_filenames()?;
        let disk = crate::library::list_chordpro_files(folder)?
            .into_iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into()))
            .collect::<Vec<_>>();
        let orphans: Vec<_> = disk
            .iter()
            .filter(|f| !indexed.contains(f))
            .cloned()
            .collect();
        Ok(format!(
            "Compact complete. {} indexed, {} orphan files on disk.",
            indexed.len(),
            orphans.len()
        ))
    })
}

#[tauri::command]
pub fn quick_project(
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
    save: bool,
) -> Result<SongDetail, String> {
    with_state(&state, |runtime| {
        let filename = if save {
            if runtime.read_only {
                return Err("Library is in read-only mode".into());
            }
            "0000-quick-song.pro".to_string()
        } else {
            "__quick__.pro".to_string()
        };
        let parsed = parse_chordpro(&text, &filename);
        if save {
            let folder = runtime
                .songs_folder
                .as_ref()
                .ok_or_else(|| "No songs folder selected".to_string())?;
            let content = serialize_chordpro(&parsed);
            fs::write(folder.join(&filename), content).map_err(|e| e.to_string())?;
            if let Some(db) = runtime.db.as_ref() {
                db.upsert_song(&parsed)?;
            }
        }
        let theme = theme_for_runtime(&app, &runtime.folder_hash);
        let slides = build_slides(&parsed, &theme, runtime.projection.transpose_semitones);
        runtime.projection = ProjectionState {
            filename: Some(filename),
            title: Some(parsed.meta.title.clone()),
            key: parsed.meta.key.clone(),
            ccli: parsed.meta.ccli.clone(),
            nashville: runtime.projection.nashville,
            slides,
            current_index: 0,
            blank: false,
            transpose_semitones: runtime.projection.transpose_semitones,
            hold_slide_id: None,
        };
        Ok(SongDetail {
            parsed,
            projection: runtime.projection.clone(),
        })
    })
}
