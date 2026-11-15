//! Changes made elsewhere reach this PC at once.
//!
//! While a server library is open, a long poll waits at
//! `GET /api/v1/library/changes` for the songs and sets someone changes on a
//! phone, in the web client or on another PC. A changed song is fetched into
//! the offline copy and indexed, and when it is on the screen the projection
//! is rebuilt where it was, so the congregation sees the correction at once.
//! A deleted song leaves the copy (the screen keeps what it shows). A changed
//! set runs the set sync straight away.
//!
//! When the server cannot say what changed (this PC just started, the server
//! restarted, or this PC fell far behind) the whole copy is compared once
//! with `GET /api/v1/songs/versions`, and only the songs that differ are
//! fetched. A server without these endpoints is asked again much later; the
//! sets then keep their minute-by-minute sync and songs the Synchronize
//! button.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use reqwest::header::AUTHORIZATION;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::server_library::{read_manifest, read_token, write_manifest};
use crate::commands::server_sets::{self, export_filename, write_song, SYNC_LOCK};
use crate::commands::song_v2::server_song_changed;
use crate::library::chordpro::parse_chordpro;
use crate::vsb_sync::ServerSongRef;
use crate::{with_state, AppState};

/// How long the server holds a poll open when nothing changes.
const LONG_POLL_SECONDS: u64 = 25;
/// After a failed request.
const RETRY: Duration = Duration::from_secs(5);
/// A server without the endpoints is asked again this much later.
const UNSUPPORTED_RETRY: Duration = Duration::from_secs(300);

#[derive(Debug, Deserialize)]
struct LibraryChanges {
    cursor: String,
    complete: bool,
    #[serde(default)]
    songs: Vec<String>,
    #[serde(default)]
    sets: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SongVersion {
    id: String,
    revision_id: String,
}

#[derive(Debug, Deserialize)]
struct ServerSong {
    id: String,
    revision_id: String,
    title: String,
    chordpro: String,
}

/// The songs a change replaced in the offline copy, for the console to
/// reload the song it shows.
#[derive(Debug, Clone, Serialize)]
pub struct ServerSongsChanged {
    pub filenames: Vec<String>,
    pub titles: Vec<String>,
}

struct Context {
    url: String,
    token: String,
    folder: PathBuf,
}

pub fn spawn_background(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { changes_loop(app).await });
}

/// The server URL and offline folder while a server library is open.
fn connection(state: &AppState) -> Option<(String, PathBuf)> {
    with_state(state, |runtime| {
        Ok(
            match (&runtime.config.server_library, &runtime.songs_folder) {
                (Some(server), Some(folder)) => Some((server.url.clone(), folder.clone())),
                _ => None,
            },
        )
    })
    .ok()
    .flatten()
}

async fn changes_loop(app: AppHandle) {
    let client = match client(Duration::from_secs(LONG_POLL_SECONDS + 15)) {
        Ok(client) => client,
        Err(error) => return eprintln!("[server changes] {error}"),
    };
    // The last cursor, and the server it is from.
    let mut cursor: Option<(String, String)> = None;
    loop {
        let state = app.state::<AppState>();
        let Some((url, folder)) = connection(&state) else {
            cursor = None;
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        };
        let Ok(token) = read_token(&app) else {
            tokio::time::sleep(RETRY).await;
            continue;
        };
        let after = cursor
            .as_ref()
            .filter(|(server, _)| *server == url)
            .map(|(_, cursor)| cursor.clone());
        let context = Context { url, token, folder };
        let changes = match poll(&client, &context, after.as_deref()).await {
            Ok(Some(changes)) => changes,
            Ok(None) => {
                tokio::time::sleep(UNSUPPORTED_RETRY).await;
                continue;
            }
            Err(error) => {
                eprintln!("[server changes] {error}");
                tokio::time::sleep(RETRY).await;
                continue;
            }
        };
        // Disconnected, or another server, while the poll was open.
        if connection(&state).map(|(url, _)| url).as_ref() != Some(&context.url) {
            cursor = None;
            continue;
        }
        let applied = if changes.complete {
            apply(&app, &state, &client, &context, &changes.songs, &[]).await
        } else {
            catch_up(&app, &state, &client, &context).await
        };
        match applied {
            Ok(()) => {
                if !changes.complete || !changes.sets.is_empty() {
                    server_sets::request_sync(&app);
                }
                cursor = Some((context.url, changes.cursor));
            }
            // The cursor stays, so the same changes come again.
            Err(error) => {
                eprintln!("[server changes] {error}");
                tokio::time::sleep(RETRY).await;
            }
        }
    }
}

/// `None`: the server has no change feed.
async fn poll(
    client: &reqwest::Client,
    context: &Context,
    after: Option<&str>,
) -> Result<Option<LibraryChanges>, String> {
    let mut endpoint = endpoint(&context.url, "api/v1/library/changes")?;
    endpoint
        .query_pairs_mut()
        .append_pair("wait", &LONG_POLL_SECONDS.to_string());
    if let Some(after) = after {
        endpoint.query_pairs_mut().append_pair("after", after);
    }
    let response = client
        .get(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", context.token))
        .send()
        .await
        .map_err(|error| format!("could not reach the song server: {error}"))?;
    match response.status() {
        status if status.is_success() => response
            .json()
            .await
            .map(Some)
            .map_err(|error| format!("invalid changes from the song server: {error}")),
        // A server from before the change feed (405 through some proxies).
        StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED => Ok(None),
        status => Err(format!(
            "the song server answered {status} to a changes poll"
        )),
    }
}

/// Compares the whole offline copy with the server and fetches what differs.
async fn catch_up(
    app: &AppHandle,
    state: &AppState,
    client: &reqwest::Client,
    context: &Context,
) -> Result<(), String> {
    let response = client
        .get(endpoint(&context.url, "api/v1/songs/versions")?)
        .header(AUTHORIZATION, format!("Bearer {}", context.token))
        .send()
        .await
        .map_err(|error| format!("could not reach the song server: {error}"))?;
    let versions: Vec<SongVersion> = match response.status() {
        status if status.is_success() => response
            .json()
            .await
            .map_err(|error| format!("invalid song versions from the song server: {error}"))?,
        StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED => return Ok(()),
        status => {
            return Err(format!(
                "the song server answered {status} for song versions"
            ))
        }
    };
    let manifest = read_manifest(app, &context.url);
    let (changed, removed) = differences(&manifest, &versions);
    if changed.is_empty() && removed.is_empty() {
        return Ok(());
    }
    eprintln!(
        "[server changes] catching up: {} changed, {} removed",
        changed.len(),
        removed.len()
    );
    apply(app, state, client, context, &changed, &removed).await
}

/// The songs to fetch (new or at another revision) and the ones the server
/// no longer has, by server id.
fn differences(
    manifest: &HashMap<String, ServerSongRef>,
    versions: &[SongVersion],
) -> (Vec<String>, Vec<String>) {
    let have = manifest
        .values()
        .map(|entry| (entry.id.as_str(), entry.revision_id.as_str()))
        .collect::<HashMap<_, _>>();
    let changed = versions
        .iter()
        .filter(|version| have.get(version.id.as_str()) != Some(&version.revision_id.as_str()))
        .map(|version| version.id.clone())
        .collect::<Vec<_>>();
    let on_server = versions
        .iter()
        .map(|version| version.id.as_str())
        .collect::<HashSet<_>>();
    let mut removed = have
        .keys()
        .filter(|id| !on_server.contains(*id))
        .map(|id| id.to_string())
        .collect::<Vec<_>>();
    removed.sort();
    (changed, removed)
}

/// Fetches the changed songs (one that is gone is removed) and removes the
/// removed ones; a song already at its revision is left alone.
async fn apply(
    app: &AppHandle,
    state: &AppState,
    client: &reqwest::Client,
    context: &Context,
    changed: &[String],
    removed: &[String],
) -> Result<(), String> {
    if changed.is_empty() && removed.is_empty() {
        return Ok(());
    }
    let _guard = SYNC_LOCK.lock().await;
    let mut manifest = read_manifest(app, &context.url);
    let mut report = ServerSongsChanged {
        filenames: Vec::new(),
        titles: Vec::new(),
    };
    let mut gone = removed.to_vec();
    let mut failed = None;
    for song_id in changed {
        match fetch(client, context, song_id).await {
            Ok(Some(song)) => match store(app, state, context, &mut manifest, song) {
                Ok(Some((filename, title))) => {
                    report.filenames.push(filename);
                    report.titles.push(title);
                }
                Ok(None) => {}
                Err(error) => failed = Some(error),
            },
            Ok(None) => gone.push(song_id.clone()),
            Err(error) => failed = Some(error),
        }
    }
    let mut removed_any = false;
    for song_id in &gone {
        match remove(state, context, &mut manifest, song_id) {
            Ok(true) => removed_any = true,
            Ok(false) => {}
            Err(error) => failed = Some(error),
        }
    }
    if !report.filenames.is_empty() || removed_any {
        write_manifest(app, &context.url, &manifest)?;
        let _ = app.emit("library-changed", ());
    }
    if !report.filenames.is_empty() {
        let _ = app.emit("server-songs-changed", &report);
    }
    match failed {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

/// A song as the server has it now; `None` when it is gone (deleted).
async fn fetch(
    client: &reqwest::Client,
    context: &Context,
    song_id: &str,
) -> Result<Option<ServerSong>, String> {
    let id = uuid::Uuid::parse_str(song_id).map_err(|_| "invalid song id".to_string())?;
    let response = client
        .get(endpoint(&context.url, &format!("api/v1/songs/{id}"))?)
        .header(AUTHORIZATION, format!("Bearer {}", context.token))
        .send()
        .await
        .map_err(|error| format!("could not reach the song server: {error}"))?;
    match response.status() {
        StatusCode::NOT_FOUND => Ok(None),
        status if status.is_success() => response
            .json()
            .await
            .map(Some)
            .map_err(|error| format!("the song server sent an invalid song: {error}")),
        status => Err(format!("the song server answered {status} for song {id}")),
    }
}

/// Writes a fetched song into the offline copy (under the file it already
/// has, so setlists and the projection keep finding it), indexes it and
/// refreshes its projection. `None` when this PC already has that revision.
fn store(
    app: &AppHandle,
    state: &AppState,
    context: &Context,
    manifest: &mut HashMap<String, ServerSongRef>,
    song: ServerSong,
) -> Result<Option<(String, String)>, String> {
    let existing = manifest.values().find(|entry| entry.id == song.id);
    if existing.is_some_and(|entry| entry.revision_id == song.revision_id) {
        return Ok(None);
    }
    let filename = match existing {
        Some(entry) => entry.filename.clone(),
        None => export_filename(
            &song.title,
            uuid::Uuid::parse_str(&song.id).map_err(|_| "invalid song id".to_string())?,
        ),
    };
    write_song(&context.folder, &filename, &song.chordpro)?;
    manifest.insert(
        filename.clone(),
        ServerSongRef {
            filename: filename.clone(),
            id: song.id,
            revision_id: song.revision_id,
        },
    );
    let parsed = parse_chordpro(&song.chordpro, &filename);
    if let Some(error) = server_song_changed(app, state, &parsed)? {
        eprintln!("[server changes] could not index {filename}: {error}");
    }
    Ok(Some((filename, song.title)))
}

/// Takes a song deleted on the server out of the offline copy and the index.
/// The screen keeps what it shows. False when this PC did not have it.
fn remove(
    state: &AppState,
    context: &Context,
    manifest: &mut HashMap<String, ServerSongRef>,
    song_id: &str,
) -> Result<bool, String> {
    let Some(filename) = manifest
        .values()
        .find(|entry| entry.id == song_id)
        .map(|entry| entry.filename.clone())
    else {
        return Ok(false);
    };
    let path = crate::library::files::song_path(&context.folder, &filename)?;
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("could not remove {filename}: {error}")),
    }
    manifest.remove(&filename);
    with_state(state, |runtime| {
        if let Some(db) = runtime.db.as_ref() {
            db.delete_song(&filename)?;
        }
        Ok(())
    })?;
    Ok(true)
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        .build()
        .map_err(|error| error.to_string())
}

fn endpoint(server_url: &str, path: &str) -> Result<url::Url, String> {
    url::Url::parse(server_url)
        .and_then(|base| base.join(path))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(filename: &str, id: &str, revision_id: &str) -> (String, ServerSongRef) {
        (
            filename.to_string(),
            ServerSongRef {
                filename: filename.to_string(),
                id: id.to_string(),
                revision_id: revision_id.to_string(),
            },
        )
    }

    fn version(id: &str, revision_id: &str) -> SongVersion {
        SongVersion {
            id: id.to_string(),
            revision_id: revision_id.to_string(),
        }
    }

    #[test]
    fn fetches_what_differs_and_drops_what_is_gone() {
        let manifest = HashMap::from([
            entry("same.pro", "a", "1"),
            entry("edited.pro", "b", "1"),
            entry("deleted.pro", "c", "1"),
        ]);
        let versions = [version("a", "1"), version("b", "2"), version("d", "1")];
        let (changed, removed) = differences(&manifest, &versions);
        assert_eq!(changed, vec!["b".to_string(), "d".to_string()]);
        assert_eq!(removed, vec!["c".to_string()]);
    }

    #[test]
    fn nothing_to_do_when_the_copy_is_current() {
        let manifest = HashMap::from([entry("a.pro", "a", "1")]);
        let (changed, removed) = differences(&manifest, &[version("a", "1")]);
        assert!(changed.is_empty() && removed.is_empty());
    }

    #[test]
    fn reads_the_server_s_answer() {
        let changes: LibraryChanges =
            serde_json::from_str(r#"{"cursor":"e.3","complete":true,"songs":["a"],"sets":[]}"#)
                .expect("changes");
        assert!(changes.complete);
        assert_eq!(changes.cursor, "e.3");
        assert_eq!(changes.songs, vec!["a".to_string()]);
    }
}
