use std::fs::{self, File, OpenOptions};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

use chrono::Utc;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;
use zip::ZipArchive;

use crate::commands::library::{self, LibraryStatus};
use crate::config::{self, ServerLibraryConfig};
use crate::{emit_library_changed, with_state, AppState};

const MAX_EXPORT_BYTES: usize = 128 * 1024 * 1024;
const MAX_SONG_BYTES: u64 = 1_000_000;
const MAX_IMPORT_SONGS_PER_REQUEST: usize = 50;
/// Export entry mapping files to server songs and revisions (newer servers).
const EXPORT_MANIFEST: &str = "psa150-manifest.json";
/// Saved next to (never inside) the replica's songs folder.
const MANIFEST_FILE: &str = "manifest.json";

#[derive(Serialize)]
struct ImportSongInput {
    filename: String,
    chordpro: String,
}

#[derive(Serialize)]
struct ImportSongsRequest<'a> {
    songs: &'a [ImportSongInput],
}

#[derive(Deserialize)]
struct ImportSongsResponse {
    songs: Vec<serde_json::Value>,
    #[serde(default)]
    skipped_existing: usize,
}

#[derive(Clone, Serialize)]
struct ServerSyncProgress {
    phase: String,
    label: String,
    current: u64,
    total: Option<u64>,
    unit: String,
}

fn emit_sync_progress(
    app: &AppHandle,
    phase: &str,
    label: &str,
    current: u64,
    total: Option<u64>,
    unit: &str,
) {
    let _ = app.emit(
        "server-sync-progress",
        ServerSyncProgress {
            phase: phase.into(),
            label: label.into(),
            current,
            total,
            unit: unit.into(),
        },
    );
}

#[tauri::command]
pub async fn connect_server_library(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    token: String,
) -> Result<LibraryStatus, String> {
    let url = normalize_server_url(&url)?;
    let token = token.trim().to_string();
    if !token.starts_with("psa_d_") {
        return Err("Enter a desktop sync token created by the server".into());
    }

    synchronize(&app, &state, &url, &token, true).await
}

#[tauri::command]
pub async fn sync_server_library(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LibraryStatus, String> {
    let url = with_state(&state, |runtime| {
        runtime
            .config
            .server_library
            .as_ref()
            .map(|server| server.url.clone())
            .ok_or_else(|| "No server library is connected".to_string())
    })?;
    let token = read_token(&app)?;
    synchronize(&app, &state, &url, &token, true).await
}

#[tauri::command]
pub fn disconnect_server_library(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let local_folder = with_state(&state, |runtime| {
        Ok(runtime.config.last_local_songs_folder.clone())
    })?;
    if let Some(local_folder) = local_folder {
        let local_folder = PathBuf::from(local_folder);
        if local_folder.is_dir() {
            library::activate_songs_folder(&app, &state, local_folder, true)?;
            return Ok(());
        }
    }

    let _ = crate::commands::projection_cmd::close_projection_windows(app.clone());
    with_state(&state, |runtime| {
        runtime.config.server_library = None;
        runtime.config.last_songs_folder = None;
        runtime.config.save(&app)?;
        runtime.songs_folder = None;
        runtime.folder_hash = None;
        runtime.db = None;
        runtime.setlists = None;
        runtime.watcher = None;
        runtime.library_dirty = false;
        runtime.read_only = runtime.config.read_only;
        runtime.projection = crate::projection::ProjectionState::default();
        runtime.active_song = None;
        runtime.projection_session_id = None;
        runtime.projection_revision += 1;
        Ok(())
    })?;
    delete_token(&app)?;
    emit_library_changed(&app);
    Ok(())
}

pub(crate) async fn synchronize(
    app: &AppHandle,
    state: &State<'_, AppState>,
    url: &str,
    token: &str,
    merge_local_library: bool,
) -> Result<LibraryStatus, String> {
    emit_sync_progress(
        app,
        "preparing",
        "Reading the local song library",
        0,
        None,
        "steps",
    );
    let local_merge_folder = if merge_local_library {
        with_state(state, |runtime| {
            if let Some(folder) = &runtime.config.last_local_songs_folder {
                return Ok(Some(PathBuf::from(folder)));
            }
            if runtime.config.server_library.is_none() {
                return Ok(runtime.songs_folder.clone());
            }
            Ok(None)
        })?
    } else {
        None
    };

    let local_song_count = match &local_merge_folder {
        Some(local_folder) if local_folder.is_dir() => {
            upload_local_songs(app, url, token, local_folder).await?
        }
        _ => 0,
    };

    let archive = download_export(app, url, token).await?;
    emit_sync_progress(
        app,
        "activating",
        "Activating the offline library",
        0,
        Some(1),
        "steps",
    );
    let root = config::server_library_root(app, url)?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let staging = root.join(format!(".staging-{}", Uuid::new_v4()));
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;

    let (song_count, manifest) = match extract_export(&archive, &staging) {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };

    if local_song_count > 0 && song_count == 0 {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!(
            "The server library is empty after synchronization. Your local library has {local_song_count} songs and was left unchanged."
        ));
    }

    // Drop the watcher before replacing the directory on Windows. A failed
    // swap restores the previous cache before returning an error.
    with_state(state, |runtime| {
        runtime.watcher = None;
        Ok(())
    })?;
    let (songs_folder, previous) = replace_cache(&root, &staging)?;
    let status = match library::activate_songs_folder(app, state, songs_folder.clone(), false) {
        Ok(status) => status,
        Err(error) => {
            restore_previous_cache(&songs_folder, previous.as_deref());
            if songs_folder.exists() {
                let _ = library::activate_songs_folder(app, state, songs_folder, false);
            }
            return Err(format!(
                "Could not index the downloaded library; the previous cache was restored: {error}"
            ));
        }
    };
    if let Some(previous) = previous {
        let _ = fs::remove_dir_all(previous);
    }
    let manifest_path = root.join(MANIFEST_FILE);
    match manifest {
        Some(bytes) => fs::write(&manifest_path, bytes).map_err(|error| error.to_string())?,
        None => {
            let _ = fs::remove_file(&manifest_path);
        }
    }

    write_token(app, token)?;
    with_state(state, |runtime| {
        if let Some(local_folder) = &local_merge_folder {
            runtime.config.last_local_songs_folder = Some(local_folder.to_string_lossy().into());
        }
        runtime.config.server_library = Some(ServerLibraryConfig {
            url: url.to_string(),
            last_synced_at: Utc::now().to_rfc3339(),
            song_count,
        });
        runtime.config.last_songs_folder = Some(songs_folder.to_string_lossy().into());
        runtime.config.first_run_complete = true;
        runtime.read_only = true;
        runtime.config.save(app)
    })?;

    emit_sync_progress(
        app,
        "activating",
        "Offline library ready",
        1,
        Some(1),
        "steps",
    );

    Ok(status)
}

async fn upload_local_songs(
    app: &AppHandle,
    server_url: &str,
    token: &str,
    folder: &Path,
) -> Result<usize, String> {
    let songs = crate::library::scan_songs_folder(folder)?
        .into_iter()
        .map(|song| ImportSongInput {
            filename: song.meta.filename,
            chordpro: song.raw,
        })
        .collect::<Vec<_>>();
    import_songs(app, server_url, token, songs).await
}

/// Add new ChordPro documents through the import endpoint, which device
/// tokens may use; exact content matches are skipped by the server.
pub(crate) async fn import_chordpro(
    app: &AppHandle,
    server_url: &str,
    token: &str,
    songs: Vec<(String, String)>,
) -> Result<usize, String> {
    let songs = songs
        .into_iter()
        .map(|(filename, chordpro)| ImportSongInput { filename, chordpro })
        .collect();
    import_songs(app, server_url, token, songs).await
}

async fn import_songs(
    app: &AppHandle,
    server_url: &str,
    token: &str,
    songs: Vec<ImportSongInput>,
) -> Result<usize, String> {
    if songs.is_empty() {
        return Ok(0);
    }
    let song_count = songs.len();
    emit_sync_progress(
        app,
        "uploading",
        "Adding local-only songs to the server",
        0,
        Some(song_count as u64),
        "songs",
    );

    let base = url::Url::parse(server_url).map_err(|error| error.to_string())?;
    let endpoint = base
        .join("api/v1/songs/import")
        .map_err(|error| error.to_string())?;
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;

    let mut processed = 0usize;
    for batch in songs.chunks(MAX_IMPORT_SONGS_PER_REQUEST) {
        let body = serde_json::to_vec(&ImportSongsRequest { songs: batch })
            .map_err(|error| format!("Could not prepare songs for synchronization: {error}"))?;
        let response = client
            .post(endpoint.clone())
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .await
            .map_err(|error| format!("Could not upload songs to the song server: {error}"))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| format!("Could not read the song server response: {error}"))?;
        if !status.is_success() {
            return Err(if body.trim().is_empty() {
                format!("Song server rejected the library merge with {status}")
            } else {
                format!(
                    "Song server rejected the library merge with {status}: {}",
                    body.trim()
                )
            });
        }
        let response: ImportSongsResponse = serde_json::from_str(&body)
            .map_err(|error| format!("Song server returned an invalid merge response: {error}"))?;
        let _ = (response.songs.len(), response.skipped_existing);
        processed += batch.len();
        emit_sync_progress(
            app,
            "uploading",
            "Adding local-only songs to the server",
            processed as u64,
            Some(song_count as u64),
            "songs",
        );
    }
    Ok(song_count)
}

async fn download_export(
    app: &AppHandle,
    server_url: &str,
    token: &str,
) -> Result<Vec<u8>, String> {
    emit_sync_progress(
        app,
        "preparing",
        "Requesting the server library",
        0,
        None,
        "bytes",
    );
    let base = url::Url::parse(server_url).map_err(|error| error.to_string())?;
    let endpoint = base
        .join("api/v1/songs/export")
        .map_err(|error| error.to_string())?;
    let mut response = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?
        .get(endpoint)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(|error| format!("Could not reach the song server: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let message = response.text().await.unwrap_or_default();
        return Err(if message.trim().is_empty() {
            format!("Song server returned {status}")
        } else {
            format!("Song server returned {status}: {}", message.trim())
        });
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_EXPORT_BYTES as u64)
    {
        return Err("The server export is larger than the 128 MB safety limit".into());
    }

    let expected_bytes = response.content_length();
    emit_sync_progress(
        app,
        "downloading",
        "Downloading the merged server library",
        0,
        expected_bytes,
        "bytes",
    );
    let mut bytes = Vec::with_capacity(
        expected_bytes
            .unwrap_or_default()
            .min(MAX_EXPORT_BYTES as u64) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Could not download the song library: {error}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_EXPORT_BYTES {
            return Err("The server export is larger than the 128 MB safety limit".into());
        }
        bytes.extend_from_slice(&chunk);
        emit_sync_progress(
            app,
            "downloading",
            "Downloading the merged server library",
            bytes.len() as u64,
            expected_bytes,
            "bytes",
        );
    }
    if expected_bytes.is_none() {
        emit_sync_progress(
            app,
            "downloading",
            "Downloading the merged server library",
            bytes.len() as u64,
            Some(bytes.len().max(1) as u64),
            "bytes",
        );
    }
    Ok(bytes)
}

fn normalize_server_url(value: &str) -> Result<String, String> {
    let mut url = url::Url::parse(value.trim())
        .map_err(|_| "Enter a complete server URL, including http:// or https://".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("The song server URL must use http or https".into());
    }
    if url.host_str().is_none() {
        return Err("The song server URL must include a host".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Do not put credentials in the song server URL".into());
    }
    url.set_query(None);
    url.set_fragment(None);
    let path = format!("{}/", url.path().trim_end_matches('/'));
    url.set_path(&path);
    Ok(url.to_string())
}

/// Unpack the ChordPro files into `destination`; returns their count and the
/// raw manifest when the server sent one.
fn extract_export(bytes: &[u8], destination: &Path) -> Result<(usize, Option<Vec<u8>>), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("The server returned an invalid ZIP archive: {error}"))?;
    let mut song_count = 0;
    let mut manifest = None;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Could not read the server export: {error}"))?;
        if entry.is_dir() {
            continue;
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "The server export contains an unsafe file path".to_string())?;
        let filename = enclosed
            .file_name()
            .ok_or_else(|| "The server export contains an invalid filename".to_string())?;
        let filename = filename.to_string_lossy();
        if filename == EXPORT_MANIFEST && enclosed.parent() == Some(Path::new("")) {
            if entry.size() > MAX_EXPORT_BYTES as u64 {
                return Err("The server manifest is too large".into());
            }
            let mut bytes = Vec::new();
            std::io::copy(&mut entry, &mut bytes).map_err(|error| error.to_string())?;
            manifest = Some(bytes);
            continue;
        }
        if !crate::library::chordpro::is_chordpro_filename(&filename) {
            continue;
        }
        if entry.size() > MAX_SONG_BYTES {
            return Err(format!("Song {filename} exceeds the 1 MB safety limit"));
        }
        let output_path = destination.join(filename.as_ref());
        if output_path.exists() {
            return Err(format!(
                "The server export contains duplicate file {filename}"
            ));
        }
        let mut output = File::create(&output_path).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
        song_count += 1;
    }
    Ok((song_count, manifest))
}

/// Filename → server song from the last download; empty for older servers.
pub(crate) fn read_manifest(
    app: &AppHandle,
    server_url: &str,
) -> std::collections::HashMap<String, crate::vsb_sync::ServerSongRef> {
    config::server_library_root(app, server_url)
        .ok()
        .and_then(|root| fs::read(root.join(MANIFEST_FILE)).ok())
        .and_then(|bytes| serde_json::from_slice::<Vec<crate::vsb_sync::ServerSongRef>>(&bytes).ok())
        .map(|entries| {
            entries
                .into_iter()
                .map(|entry| (entry.filename.clone(), entry))
                .collect()
        })
        .unwrap_or_default()
}

fn song_endpoint(server_url: &str, song_id: &str) -> Result<url::Url, String> {
    let id = uuid::Uuid::parse_str(song_id).map_err(|_| "Invalid server song id".to_string())?;
    url::Url::parse(server_url)
        .and_then(|base| base.join(&format!("api/v1/songs/{id}")))
        .map_err(|error| error.to_string())
}

fn song_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())
}

async fn song_response(response: reqwest::Response) -> Result<(), String> {
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = response.text().await.unwrap_or_default();
    Err(if status == reqwest::StatusCode::CONFLICT {
        "changed on the song server in the meantime; the server version is kept".into()
    } else if status == reqwest::StatusCode::FORBIDDEN {
        "the song server does not let this desktop change songs (update the server)".into()
    } else if body.trim().is_empty() {
        format!("the song server returned {status}")
    } else {
        format!("the song server returned {status}: {}", body.trim())
    })
}

/// Replace a server song's text, based on the revision this PC last saw.
pub(crate) async fn update_song(
    server_url: &str,
    token: &str,
    song_id: &str,
    base_revision_id: &str,
    chordpro: &str,
) -> Result<(), String> {
    let response = song_client()?
        .put(song_endpoint(server_url, song_id)?)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(
            serde_json::json!({ "base_revision_id": base_revision_id, "chordpro": chordpro })
                .to_string(),
        )
        .send()
        .await
        .map_err(|error| format!("could not reach the song server: {error}"))?;
    song_response(response).await
}

/// Delete a server song unless it changed since `base_revision_id`.
pub(crate) async fn delete_song(
    server_url: &str,
    token: &str,
    song_id: &str,
    base_revision_id: &str,
) -> Result<(), String> {
    let mut endpoint = song_endpoint(server_url, song_id)?;
    endpoint
        .query_pairs_mut()
        .append_pair("base_revision_id", base_revision_id);
    let response = song_client()?
        .delete(endpoint)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(|error| format!("could not reach the song server: {error}"))?;
    song_response(response).await
}

fn replace_cache(root: &Path, staging: &Path) -> Result<(PathBuf, Option<PathBuf>), String> {
    let current = root.join("songs");
    let backup = root.join(format!(".previous-{}", Uuid::new_v4()));
    let had_current = current.exists();
    if had_current {
        fs::rename(&current, &backup)
            .map_err(|error| format!("Could not prepare the existing offline cache: {error}"))?;
    }
    if let Err(error) = fs::rename(staging, &current) {
        if had_current {
            let _ = fs::rename(&backup, &current);
        }
        return Err(format!(
            "Could not activate the downloaded offline cache: {error}"
        ));
    }
    Ok((current, had_current.then_some(backup)))
}

fn restore_previous_cache(current: &Path, previous: Option<&Path>) {
    let _ = fs::remove_dir_all(current);
    if let Some(previous) = previous {
        let _ = fs::rename(previous, current);
    }
}

fn write_token(app: &AppHandle, token: &str) -> Result<(), String> {
    let path = config::server_token_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(token.as_bytes())
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

pub(crate) fn read_token(app: &AppHandle) -> Result<String, String> {
    let token = fs::read_to_string(config::server_token_path(app)?).map_err(|_| {
        "The saved desktop token is unavailable; reconnect the server library".to_string()
    })?;
    let token = token.trim().to_string();
    if token.is_empty() {
        Err("The saved desktop token is empty; reconnect the server library".into())
    } else {
        Ok(token)
    }
}

fn delete_token(app: &AppHandle) -> Result<(), String> {
    let path = config::server_token_path(app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use tempfile::tempdir;
    use zip::{write::SimpleFileOptions, ZipWriter};

    use super::{extract_export, normalize_server_url};

    #[test]
    fn normalizes_server_urls_for_relative_api_paths() {
        assert_eq!(
            normalize_server_url("https://songs.example/church").unwrap(),
            "https://songs.example/church/"
        );
        assert!(normalize_server_url("file:///tmp/server").is_err());
        assert!(normalize_server_url("https://user:secret@songs.example").is_err());
    }

    #[test]
    fn extracts_only_chordpro_files_from_server_export() {
        let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        archive.start_file("grace-123.pro", options).unwrap();
        archive.write_all(b"{title: Grace}\nAmazing grace").unwrap();
        archive.start_file("manifest.json", options).unwrap();
        archive.write_all(b"{}").unwrap();
        let bytes = archive.finish().unwrap().into_inner();
        let destination = tempdir().unwrap();

        let (count, manifest) = extract_export(&bytes, destination.path()).unwrap();
        assert_eq!(count, 1);
        assert!(manifest.is_none());
        assert_eq!(
            std::fs::read_to_string(destination.path().join("grace-123.pro")).unwrap(),
            "{title: Grace}\nAmazing grace"
        );
        assert!(!destination.path().join("manifest.json").exists());
    }

    #[test]
    fn keeps_the_server_manifest_out_of_the_songs_folder() {
        let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default();
        archive.start_file("grace-1a2b3c4d.pro", options).unwrap();
        archive.write_all(b"{title: Grace}").unwrap();
        archive.start_file("psa150-manifest.json", options).unwrap();
        archive.write_all(b"[]").unwrap();
        let bytes = archive.finish().unwrap().into_inner();
        let destination = tempdir().unwrap();

        let (count, manifest) = extract_export(&bytes, destination.path()).unwrap();
        assert_eq!(count, 1);
        assert_eq!(manifest.as_deref(), Some(&b"[]"[..]));
        assert!(!destination.path().join("psa150-manifest.json").exists());
    }
}
