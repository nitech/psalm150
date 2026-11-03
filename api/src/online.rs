//! Looking for a song online (`GET /songs/online`), for clients that cannot
//! search the web themselves, such as the web client. The lookup is
//! `psa150-lyrics` (`shared/lyrics/`), the same code the desktop runs
//! without a server.
//!
//! Answers are kept in memory for a while, so asking again (or another
//! church asking for the same song) costs nothing, and only a few searches
//! run at once, so a burst of them neither loads a small server nor gets it
//! blocked by the search engine.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{
    Json, Router,
    extract::{Query, State},
    http::HeaderMap,
    routing::get,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use utoipa::ToSchema;

use crate::{AppState, auth::authenticate, error::AppError};

/// How long an answer is reused.
const CACHE_FOR: Duration = Duration::from_secs(6 * 60 * 60);
/// Answers kept; the oldest goes first.
const CACHE_SIZE: usize = 200;
/// Searches running at once; the rest wait their turn.
const AT_ONCE: usize = 2;

pub struct OnlineSearch {
    client: Option<psa150_lyrics::Client>,
    cache: Mutex<HashMap<String, (Instant, Vec<OnlineSong>)>>,
    turns: Semaphore,
}

impl Default for OnlineSearch {
    fn default() -> Self {
        Self {
            client: psa150_lyrics::client().ok(),
            cache: Mutex::default(),
            turns: Semaphore::new(AT_ONCE),
        }
    }
}

impl OnlineSearch {
    fn cached(&self, key: &str) -> Option<Vec<OnlineSong>> {
        let cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        cache
            .get(key)
            .filter(|(at, _)| at.elapsed() < CACHE_FOR)
            .map(|(_, songs)| songs.clone())
    }

    fn remember(&self, key: String, songs: Vec<OnlineSong>) {
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        cache.retain(|_, (at, _)| at.elapsed() < CACHE_FOR);
        if cache.len() >= CACHE_SIZE
            && let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(k, _)| k.clone())
        {
            cache.remove(&oldest);
        }
        cache.insert(key, (Instant::now(), songs));
    }
}

/// A song found online, as ChordPro ready to review and add.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct OnlineSong {
    pub title: String,
    pub artist: Option<String>,
    /// The site, as people know it: `worshipchords.com`.
    pub source_name: String,
    pub source_url: String,
    pub chordpro: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct OnlineQuery {
    /// A title or a line of the lyrics; at least 3 characters.
    pub q: String,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/songs/online", get(search_online))
}

/// Song editors: looks for a song online.
///
/// Searches chord and lyric sites for `q` and returns up to three songs as
/// ChordPro, best first. Nothing is saved: add one with `POST /songs`.
/// Takes a few seconds; the same search again within hours is answered
/// from memory.
#[utoipa::path(
    get,
    path = "/api/v1/songs/online",
    security(("bearer" = [])),
    params(("q" = String, Query)),
    responses(
        (status = 200, body = [OnlineSong]),
        (status = 400, body = crate::error::ErrorBody),
        (status = 401, body = crate::error::ErrorBody),
        (status = 403, body = crate::error::ErrorBody),
        (status = 503, body = crate::error::ErrorBody)
    )
)]
pub async fn search_online(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<OnlineQuery>,
) -> Result<Json<Vec<OnlineSong>>, AppError> {
    authenticate(&headers, &state)
        .await?
        .require_song_editor()?;
    let q = query.q.split_whitespace().collect::<Vec<_>>().join(" ");
    if q.chars().count() < 3 {
        return Err(AppError::BadRequest(
            "search for at least 3 characters".into(),
        ));
    }
    let online = &state.online;
    let key = q.to_lowercase();
    if let Some(songs) = online.cached(&key) {
        return Ok(Json(songs));
    }
    let client = online
        .client
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("online search is not available".into()))?;
    let _turn = online
        .turns
        .acquire()
        .await
        .map_err(|_| AppError::Unavailable("online search is not available".into()))?;
    // Someone may have asked the same while this waited its turn.
    if let Some(songs) = online.cached(&key) {
        return Ok(Json(songs));
    }
    let songs: Vec<OnlineSong> = psa150_lyrics::search(client, &q)
        .await
        .map_err(AppError::Unavailable)?
        .into_iter()
        .map(|found| OnlineSong {
            title: found.title,
            artist: found.artist,
            source_name: found.source_name,
            source_url: found.source_url,
            chordpro: found.chordpro_content,
        })
        .collect();
    online.remember(key, songs.clone());
    Ok(Json(songs))
}
