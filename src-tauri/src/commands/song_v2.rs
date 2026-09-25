use std::fs;

use serde::{Deserialize, Serialize};
use slug::slugify;
use tauri::{AppHandle, Emitter, State};

use crate::commands::projection_cmd::{build_snapshot, emit_snapshot, ProjectionSnapshot};
use crate::commands::server_library;
use crate::config::load_theme;
use crate::library::chordpro::{parse_chordpro, serialize_chordpro, LyricLine, ParsedSong};
use crate::library::files::{
    content_hash, create_song_unique, delete_song_recoverable, replace_song, song_path,
    RecoveryItem,
};
use crate::projection::{build_slides, ProjectionState, SlideTheme};
use crate::{with_state, AppState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongDetail {
    pub parsed: ParsedSong,
    /// Preview slides; loading a song does not alter the active projection.
    pub projection: ProjectionState,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongLineEdit {
    pub section_index: usize,
    pub line_index: usize,
    pub text: String,
}

fn theme_for(app: &AppHandle, folder_hash: Option<&String>) -> SlideTheme {
    folder_hash
        .and_then(|hash| load_theme(app, hash).ok())
        .unwrap_or_default()
}

fn projection_for(parsed: &ParsedSong, theme: &SlideTheme, transpose: i32) -> ProjectionState {
    ProjectionState {
        filename: Some(parsed.meta.filename.clone()),
        title: Some(parsed.meta.title.clone()),
        key: parsed.meta.key.clone(),
        ccli: parsed.meta.ccli.clone(),
        nashville: false,
        slides: build_slides(parsed, theme, transpose),
        current_index: 0,
        blank: false,
        transpose_semitones: transpose,
        hold_slide_id: None,
    }
}

fn detail(parsed: ParsedSong, theme: &SlideTheme) -> SongDetail {
    SongDetail {
        content_hash: content_hash(&parsed.raw),
        projection: projection_for(&parsed, theme, 0),
        parsed,
    }
}

fn read_library_song(
    state: &AppState,
    filename: &str,
) -> Result<(ParsedSong, Option<String>), String> {
    let (folder, folder_hash) = with_state(state, |runtime| {
        Ok((
            runtime
                .songs_folder
                .clone()
                .ok_or_else(|| "No songs folder selected".to_string())?,
            runtime.folder_hash.clone(),
        ))
    })?;
    let content = fs::read_to_string(song_path(&folder, filename)?).map_err(|e| e.to_string())?;
    Ok((parse_chordpro(&content, filename), folder_hash))
}

#[tauri::command]
pub fn load_song(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: String,
) -> Result<SongDetail, String> {
    let (parsed, hash) = read_library_song(&state, &filename)?;
    Ok(detail(parsed, &theme_for(&app, hash.as_ref())))
}

#[tauri::command]
pub fn preview_web_song(
    app: AppHandle,
    state: State<'_, AppState>,
    content: String,
) -> Result<SongDetail, String> {
    let hash = with_state(&state, |runtime| Ok(runtime.folder_hash.clone()))?;
    let parsed = parse_chordpro(&content, "__web__.pro");
    Ok(detail(parsed, &theme_for(&app, hash.as_ref())))
}

#[tauri::command]
pub fn project_song(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: Option<String>,
    content: Option<String>,
) -> Result<ProjectionSnapshot, String> {
    let (parsed, from_library, folder_hash) = match (filename, content) {
        (Some(filename), None) => {
            let (parsed, hash) = read_library_song(&state, &filename)?;
            (parsed, true, hash)
        }
        (None, Some(content)) => {
            let hash = with_state(&state, |runtime| Ok(runtime.folder_hash.clone()))?;
            (parse_chordpro(&content, "__web__.pro"), false, hash)
        }
        _ => return Err("Provide exactly one projection source".into()),
    };
    let theme = theme_for(&app, folder_hash.as_ref());
    let snapshot = with_state(&state, |runtime| {
        runtime.active_song = Some(parsed.clone());
        runtime.active_theme = theme.clone();
        runtime.projection = projection_for(&parsed, &theme, 0);
        if !from_library {
            runtime.projection.filename = None;
        }
        runtime.projection_session_id = Some(uuid::Uuid::new_v4().to_string());
        runtime.projection_revision += 1;

        if from_library {
            if let Some(db) = runtime.db.as_ref() {
                db.add_history(&parsed.meta.filename, &parsed.meta.title)?;
            }
            if let Some(hash) = runtime.folder_hash.clone() {
                let log_path = crate::config::library_root(&app, &hash)?.join("ccli_log.sqlite");
                if let Ok(log) = crate::ccli::CcliLog::open(log_path) {
                    let _ = log.log(
                        &parsed.meta.filename,
                        &parsed.meta.title,
                        parsed.meta.ccli.as_deref(),
                    );
                }
            }
        }
        Ok(build_snapshot(runtime))
    })?;
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

fn char_to_byte(value: &str, char_index: usize) -> usize {
    value
        .char_indices()
        .nth(char_index)
        .map(|(index, _)| index)
        .unwrap_or(value.len())
}

fn render_edited_line(line: &LyricLine, text: &str) -> String {
    let mut rendered = text.to_string();
    let mut inserted_chars = 0usize;
    for chord in &line.chords {
        let position = chord.position.min(text.chars().count()) + inserted_chars;
        let insert = format!("[{}]", chord.chord);
        rendered.insert_str(char_to_byte(&rendered, position), &insert);
        inserted_chars += insert.chars().count();
    }
    rendered
}

fn apply_line_edits(
    raw: &str,
    parsed: &ParsedSong,
    edits: &[SongLineEdit],
) -> Result<String, String> {
    let mut raw_lines: Vec<String> = raw.split('\n').map(str::to_string).collect();
    for edit in edits {
        let line = parsed
            .sections
            .get(edit.section_index)
            .and_then(|section| section.lines.get(edit.line_index))
            .ok_or_else(|| "Song line is no longer available; reload before saving".to_string())?;
        let source_line = line
            .source_line
            .ok_or_else(|| "Song line has no source mapping; reload before saving".to_string())?;
        let old = raw_lines
            .get(source_line)
            .ok_or_else(|| "Song source mapping is invalid".to_string())?;
        let ending = if old.ends_with('\r') { "\r" } else { "" };
        raw_lines[source_line] = format!("{}{ending}", render_edited_line(line, &edit.text));
    }
    Ok(raw_lines.join("\n"))
}

fn preserve_position(old: &ProjectionState, new: &mut ProjectionState) {
    if new.slides.is_empty() {
        new.current_index = 0;
        new.blank = true;
        return;
    }
    let mapped = old.slides.get(old.current_index).and_then(|old_slide| {
        let part = old.slides[..old.current_index]
            .iter()
            .filter(|slide| slide.stanza_index == old_slide.stanza_index)
            .count();
        new.slides
            .iter()
            .enumerate()
            .filter(|(_, slide)| slide.stanza_index == old_slide.stanza_index)
            .nth(part)
            .map(|(index, _)| index)
    });
    new.current_index = mapped.unwrap_or(old.current_index.min(new.slides.len() - 1));
    new.blank = old.blank;
}

/// Where a save goes: the songs folder, or the song server behind a server
/// library's offline copy.
enum SaveTarget {
    Folder,
    Server(String),
}

async fn save_content(
    app: &AppHandle,
    state: &AppState,
    filename: String,
    content: String,
    expected_hash: String,
) -> Result<SongDetail, String> {
    let (folder, folder_hash, target) = with_state(state, |runtime| {
        let target = match &runtime.config.server_library {
            Some(server) => SaveTarget::Server(server.url.clone()),
            None if runtime.read_only => return Err("Library is in read-only mode".into()),
            None => SaveTarget::Folder,
        };
        Ok((
            runtime
                .songs_folder
                .clone()
                .ok_or_else(|| "No songs folder selected".to_string())?,
            runtime
                .folder_hash
                .clone()
                .ok_or_else(|| "No library open".to_string())?,
            target,
        ))
    })?;
    match target {
        SaveTarget::Folder => {
            replace_song(
                app,
                &folder_hash,
                &folder,
                &filename,
                &content,
                &expected_hash,
            )?;
        }
        SaveTarget::Server(url) => {
            server_library::save_song(
                app,
                &url,
                &folder_hash,
                &folder,
                &filename,
                &content,
                &expected_hash,
            )
            .await?;
        }
    }
    let parsed = parse_chordpro(&content, &filename);
    let theme = theme_for(app, Some(&folder_hash));
    let (saved, snapshot, index_error) = with_state(state, |runtime| {
        let index_error = runtime
            .db
            .as_ref()
            .and_then(|db| db.upsert_song(&parsed).err());
        let snapshot = if runtime.projection.filename.as_deref() == Some(filename.as_str()) {
            let old = runtime.projection.clone();
            let mut new = projection_for(&parsed, &theme, old.transpose_semitones);
            new.nashville = old.nashville;
            preserve_position(&old, &mut new);
            runtime.active_song = Some(parsed.clone());
            runtime.active_theme = theme.clone();
            runtime.projection = new;
            runtime.projection_revision += 1;
            Some(build_snapshot(runtime))
        } else {
            None
        };
        Ok((detail(parsed.clone(), &theme), snapshot, index_error))
    })?;
    if let Some(snapshot) = snapshot {
        emit_snapshot(app, &snapshot);
    }
    let _ = app.emit("library-changed", ());
    if let Some(error) = index_error {
        return Err(format!(
            "FILE_SAVED_INDEX_FAILED: File saved, but the index must be updated: {error}"
        ));
    }
    Ok(saved)
}

#[tauri::command]
pub async fn save_song(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: String,
    content: String,
    expected_hash: String,
) -> Result<SongDetail, String> {
    save_content(&app, &state, filename, content, expected_hash).await
}

#[tauri::command]
pub async fn save_song_lines(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: String,
    expected_hash: String,
    edits: Vec<SongLineEdit>,
) -> Result<SongDetail, String> {
    let folder = with_state(&state, |runtime| {
        if runtime.read_only && runtime.config.server_library.is_none() {
            return Err("Library is in read-only mode".into());
        }
        runtime
            .songs_folder
            .clone()
            .ok_or_else(|| "No songs folder selected".to_string())
    })?;
    let raw = fs::read_to_string(song_path(&folder, &filename)?).map_err(|e| e.to_string())?;
    if content_hash(&raw) != expected_hash {
        return Err("SONG_CHANGED_ON_DISK: Reload the song before saving".into());
    }
    let parsed = parse_chordpro(&raw, &filename);
    let patched = apply_line_edits(&raw, &parsed, &edits)?;
    save_content(&app, &state, filename, patched, expected_hash).await
}

#[tauri::command]
pub fn save_web_song(
    app: AppHandle,
    state: State<'_, AppState>,
    content: String,
) -> Result<SongDetail, String> {
    let (folder, folder_hash) = with_state(&state, |runtime| {
        if runtime.read_only {
            return Err("Library is in read-only mode".into());
        }
        Ok((
            runtime
                .songs_folder
                .clone()
                .ok_or_else(|| "No songs folder selected".to_string())?,
            runtime.folder_hash.clone(),
        ))
    })?;
    let parsed = parse_chordpro(&content, "web.pro");
    let slug = slugify(&parsed.meta.title);
    let stem = if slug.is_empty() {
        "web-song".to_string()
    } else {
        slug
    };
    let number = parsed.meta.song_num.unwrap_or(0).max(0);
    let preferred = format!("{number:04}-{stem}.pro");
    let serialized = serialize_chordpro(&parsed);
    let filename = create_song_unique(&folder, &preferred, &serialized)?;
    let saved = parse_chordpro(&serialized, &filename);
    let index_error = with_state(&state, |runtime| {
        Ok(runtime
            .db
            .as_ref()
            .and_then(|db| db.upsert_song(&saved).err()))
    })?;
    let _ = app.emit("library-changed", ());
    if let Some(error) = index_error {
        return Err(format!(
            "FILE_SAVED_INDEX_FAILED: File saved as {filename}, but the index must be updated: {error}"
        ));
    }
    Ok(detail(saved, &theme_for(&app, folder_hash.as_ref())))
}

#[tauri::command]
pub fn delete_song(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: String,
) -> Result<RecoveryItem, String> {
    let (folder, folder_hash) = with_state(&state, |runtime| {
        if runtime.read_only {
            return Err("Library is in read-only mode".into());
        }
        if runtime.projection.filename.as_deref() == Some(filename.as_str()) {
            return Err("The song currently being projected cannot be deleted".into());
        }
        if runtime
            .setlists
            .as_ref()
            .is_some_and(|store| store.references_file(&filename))
        {
            return Err("This song is used in a saved setlist".into());
        }
        Ok((
            runtime
                .songs_folder
                .clone()
                .ok_or_else(|| "No songs folder selected".to_string())?,
            runtime
                .folder_hash
                .clone()
                .ok_or_else(|| "No library open".to_string())?,
        ))
    })?;
    let recovery = delete_song_recoverable(&app, &folder_hash, &folder, &filename)?;
    with_state(&state, |runtime| {
        if let Some(db) = runtime.db.as_ref() {
            db.delete_song(&filename)?;
        }
        Ok(())
    })?;
    let _ = app.emit("library-changed", ());
    Ok(recovery)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_edits_follow_parser_source_lines_and_preserve_crlf() {
        let raw = "{title: Test}\r\n# comment\r\n{sov}\r\n[C]Første linje\r\n\r\nAndre linje\r\n{eov}\r\n";
        let parsed = parse_chordpro(raw, "test.pro");
        let updated = apply_line_edits(
            raw,
            &parsed,
            &[
                SongLineEdit {
                    section_index: 0,
                    line_index: 0,
                    text: "Ny ø-linje".into(),
                },
                SongLineEdit {
                    section_index: 1,
                    line_index: 0,
                    text: "Siste".into(),
                },
            ],
        )
        .expect("edit");
        assert!(updated.contains("# comment\r\n{sov}\r\n[C]Ny ø-linje\r\n\r\nSiste\r\n"));
    }

    #[test]
    fn shortening_text_caps_chords_at_the_new_end() {
        let raw = "{start_of_verse}\nLong [G]line [D]here\n{end_of_verse}";
        let parsed = parse_chordpro(raw, "test.pro");
        let updated = apply_line_edits(
            raw,
            &parsed,
            &[SongLineEdit {
                section_index: 0,
                line_index: 0,
                text: "Hi".into(),
            }],
        )
        .expect("edit");
        assert_eq!(updated, "{start_of_verse}\nHi[G][D]\n{end_of_verse}");
    }
}
