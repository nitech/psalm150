//! Recordings of how a song is played, kept on the song server: the console
//! lists, plays, records and deletes them for songs in a server library,
//! with the desktop's device token (the song server allows desktops these
//! since it shares the song modules with this app).
//!
//! An `<audio>` element cannot send the token, so playing goes through a
//! token-free play link the server hands out, made absolute here.

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::commands::server_library::{connected_server_url, read_manifest, read_token};
use crate::{with_state, AppState};

/// A song in a server library, as the song server knows it.
#[derive(Debug, Clone, Serialize)]
pub struct ServerSong {
    /// The song server's address, ending in `/`.
    pub server_url: String,
    pub song_id: String,
}

fn server_url(state: &AppState) -> Result<String, String> {
    with_state(state, |runtime| Ok(connected_server_url(runtime)))?
        .ok_or_else(|| "This library is not on a song server".to_string())
}

fn endpoint(server_url: &str, path: &str) -> Result<url::Url, String> {
    url::Url::parse(server_url)
        .and_then(|base| base.join(path))
        .map_err(|error| error.to_string())
}

fn song_path(song_id: &str, rest: &str) -> Result<String, String> {
    let id = uuid::Uuid::parse_str(song_id).map_err(|_| "Invalid server song id".to_string())?;
    Ok(format!("api/v1/songs/{id}/recordings{rest}"))
}

fn recording_part(recording_id: &str) -> Result<String, String> {
    let id =
        uuid::Uuid::parse_str(recording_id).map_err(|_| "Invalid recording id".to_string())?;
    Ok(format!("/{id}"))
}

fn client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|error| error.to_string())
}

/// The body of a successful answer, or a message to show.
async fn answer(response: reqwest::Response) -> Result<String, String> {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if status.is_success() {
        return Ok(body);
    }
    let message = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| value["error"].as_str().map(str::to_string))
        .unwrap_or_else(|| body.trim().to_string());
    Err(if status == reqwest::StatusCode::FORBIDDEN {
        "The song server does not let this desktop do that (update the song server)".into()
    } else if message.is_empty() {
        format!("The song server returned {status}")
    } else {
        format!("The song server returned {status}: {message}")
    })
}

fn unreachable(error: reqwest::Error) -> String {
    format!("Could not reach the song server: {error}")
}

/// The server song behind a file of a server library, or nothing for a
/// folder library or a song the server does not have yet.
#[tauri::command]
pub fn song_server_ref(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: String,
) -> Result<Option<ServerSong>, String> {
    let Some(server_url) = with_state(&state, |runtime| Ok(connected_server_url(runtime)))? else {
        return Ok(None);
    };
    Ok(read_manifest(&app, &server_url)
        .get(&filename)
        .map(|song| ServerSong {
            server_url: server_url.clone(),
            song_id: song.id.clone(),
        }))
}

/// A song's recordings, oldest first, as the song server lists them.
#[tauri::command]
pub async fn list_song_recordings(
    app: AppHandle,
    state: State<'_, AppState>,
    song_id: String,
) -> Result<Vec<Value>, String> {
    let server = server_url(&state)?;
    let token = read_token(&app)?;
    let response = client(30)?
        .get(endpoint(&server, &song_path(&song_id, "")?)?)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(unreachable)?;
    serde_json::from_str(&answer(response).await?).map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RecordingLink {
    pub url: String,
    pub expires_at: String,
}

/// A play link for one recording, as an absolute URL on the song server.
#[tauri::command]
pub async fn song_recording_link(
    app: AppHandle,
    state: State<'_, AppState>,
    song_id: String,
    recording_id: String,
) -> Result<RecordingLink, String> {
    let server = server_url(&state)?;
    let token = read_token(&app)?;
    let path = song_path(&song_id, &format!("{}/link", recording_part(&recording_id)?))?;
    let response = client(30)?
        .post(endpoint(&server, &path)?)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(unreachable)?;
    let mut link: RecordingLink =
        serde_json::from_str(&answer(response).await?).map_err(|error| error.to_string())?;
    link.url = endpoint(&server, link.url.trim_start_matches('/'))?.to_string();
    Ok(link)
}

/// Saves a recording: the body is the audio as recorded; the song, its
/// type and its length come in the headers `x-song-id`, `content-type` and
/// `x-duration-ms`.
#[tauri::command]
pub async fn add_song_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<Value, String> {
    let tauri::ipc::InvokeBody::Raw(audio) = request.body() else {
        return Err("The recording did not arrive as audio".into());
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    let song_id = header("x-song-id").ok_or("The recording names no song")?;
    let content_type = header("content-type").unwrap_or_else(|| "audio/webm".into());
    let duration = header("x-duration-ms").and_then(|value| value.parse::<i64>().ok());
    let audio = audio.clone();

    let server = server_url(&state)?;
    let token = read_token(&app)?;
    let mut url = endpoint(&server, &song_path(&song_id, "")?)?;
    if let Some(ms) = duration {
        url.query_pairs_mut()
            .append_pair("duration_ms", &ms.max(0).to_string());
    }
    // Up to 40 MB on a slow line.
    let response = client(600)?
        .post(url)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, content_type)
        .body(audio)
        .send()
        .await
        .map_err(unreachable)?;
    serde_json::from_str(&answer(response).await?).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_song_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    song_id: String,
    recording_id: String,
) -> Result<(), String> {
    let server = server_url(&state)?;
    let token = read_token(&app)?;
    let path = song_path(&song_id, &recording_part(&recording_id)?)?;
    let response = client(30)?
        .delete(endpoint(&server, &path)?)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(unreachable)?;
    answer(response).await.map(|_| ())
}

/// A server library takes its favourites from the song server: those of the
/// person who connected this desktop, the same star as in the web client.
/// Songs the offline copy does not have are left out. Returns the file
/// names; outside a server library, nothing changes and `None` comes back.
#[tauri::command]
pub async fn pull_server_favorites(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Vec<String>>, String> {
    #[derive(Deserialize)]
    struct Favorites {
        song_ids: Vec<String>,
    }
    let Some(server) = with_state(&state, |runtime| Ok(connected_server_url(runtime)))? else {
        return Ok(None);
    };
    let token = read_token(&app)?;
    let response = client(30)?
        .get(endpoint(&server, "api/v1/favorites")?)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(unreachable)?;
    // An older song server has no favourites: keep the local ones.
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let favorites: Favorites =
        serde_json::from_str(&answer(response).await?).map_err(|error| error.to_string())?;
    let by_id: std::collections::HashMap<String, String> = read_manifest(&app, &server)
        .into_values()
        .map(|song| (song.id, song.filename))
        .collect();
    let filenames: Vec<String> = favorites
        .song_ids
        .iter()
        .filter_map(|id| by_id.get(id).cloned())
        .collect();
    with_state(&state, |runtime| match runtime.db.as_ref() {
        Some(db) => db.set_favorites(&filenames),
        None => Ok(()),
    })?;
    Ok(Some(filenames))
}

/// Sends one star to the song server (server libraries; nothing otherwise).
#[tauri::command]
pub async fn push_server_favorite(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: String,
    favorite: bool,
) -> Result<(), String> {
    let Some(song) = song_server_ref(app.clone(), state.clone(), filename)? else {
        return Ok(());
    };
    let token = read_token(&app)?;
    let id = uuid::Uuid::parse_str(&song.song_id).map_err(|_| "Invalid server song id".to_string())?;
    let url = endpoint(&song.server_url, &format!("api/v1/favorites/{id}"))?;
    let request = if favorite {
        client(30)?.put(url)
    } else {
        client(30)?.delete(url)
    };
    let response = request
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(unreachable)?;
    answer(response).await.map(|_| ())
}

/// Opens a web page (a song's YouTube video, a chord site) in the browser.
#[tauri::command]
pub fn open_link(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Not a web address".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only web pages can be opened".into());
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{endpoint, recording_part, song_path};

    #[test]
    fn builds_recording_addresses_from_ids_only() {
        let song = "6f1c2c8e-4b0b-4d7a-9f00-2b1d1f6b7a10";
        assert_eq!(
            song_path(song, "").unwrap(),
            format!("api/v1/songs/{song}/recordings")
        );
        assert!(song_path("../../admin", "").is_err());
        assert!(recording_part("x/../y").is_err());
        assert_eq!(
            endpoint("https://praise.example/", "api/v1/public/recordings/abc")
                .unwrap()
                .as_str(),
            "https://praise.example/api/v1/public/recordings/abc"
        );
    }
}
