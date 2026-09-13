use std::fs;

use serde::{Deserialize, Serialize};
use slug::slugify;
use tauri::State;

use crate::library::chordpro::{parse_chordpro, serialize_chordpro};
use crate::{with_state, AppState};

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
