//! Finds a song online and turns its page into ChordPro.
//!
//! Shared by the Psalm150 desktop app (which must work without a song
//! server) and the song server (for its web client). The server repo's
//! `shared/lyrics/` is canonical; the desktop mirrors it with
//! `bun run sync:shared`.
//!
//! [`search`] asks a search engine for chord and lyric pages, fetches the
//! best few in parallel, reads each with [`page::read`] and converts the text
//! with [`chart::parse`]. Nothing here needs a model or an account.

pub mod chart;
mod discover;
mod lrclib;
pub mod page;

use std::time::Duration;

use futures_util::future::join_all;
use serde::{Deserialize, Serialize};

pub use reqwest::Client;

/// At most this many results come back.
pub const MAX_CANDIDATES: usize = 3;
/// Pages fetched per search, all at once.
const MAX_PAGES: usize = 6;
/// Per request: the search engine, then every page in parallel, so a search
/// takes at most about twice this.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(6);
/// Lyric pages are far smaller; stop reading a page that is not.
const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;

pub const USER_AGENT: &str =
    "Mozilla/5.0 (compatible; Psalm150/0.2; church worship projection; +https://github.com/nitech/psalm150)";

/// One song found online.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Candidate {
    pub title: String,
    pub artist: Option<String>,
    /// The site, as people know it: `worshipchords.com`.
    pub source_name: String,
    pub source_url: String,
    pub chordpro_content: String,
}

/// The HTTP client a search needs: a browser-like user agent, short
/// timeouts and few redirects.
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())
}

/// Search the web for `query` (a title, or a line of the lyrics).
///
/// An error means the search engine could not be asked; a page that fails
/// is skipped. An empty list means nothing usable was found.
pub async fn search(client: &reqwest::Client, query: &str) -> Result<Vec<Candidate>, String> {
    let query = query.trim();
    if query.chars().count() < 3 {
        return Ok(vec![]);
    }
    // Chord and lyric sites through the search engine, and the LRCLIB
    // lyrics database (words only) at the same time.
    let charts = async {
        let urls = discover::urls(client, query).await?;
        let pages = join_all(urls.into_iter().take(MAX_PAGES).map(|url| async move {
            let html = fetch(client, &url).await.ok()?;
            Some((url, html))
        }))
        .await;
        Ok::<_, String>(
            pages
                .into_iter()
                .flatten()
                .filter_map(|(url, html)| page::read(&url, &html))
                .collect::<Vec<_>>(),
        )
    };
    let (charts, lyrics) = futures_util::future::join(charts, lrclib::pages(client, query)).await;
    // Only when neither answered is it an error.
    let mut pages = lyrics;
    match charts {
        Ok(found) => pages.extend(found),
        Err(error) if pages.is_empty() => return Err(error),
        Err(_) => {}
    }
    let found = pages
        .into_iter()
        .filter_map(|page| chart::parse(&page, query).map(|song| (page, song)))
        .collect::<Vec<_>>();
    Ok(pick(found, query))
}

/// The best few songs, most likely first, without the same song twice
/// (mirror sites copy each other).
fn pick(mut found: Vec<(page::Page, chart::Song)>, query: &str) -> Vec<Candidate> {
    found.sort_by(|a, b| {
        let score = |(page, song): &(page::Page, chart::Song)| song.score(query) + page.trust;
        score(b).total_cmp(&score(a))
    });
    let mut kept: Vec<(page::Page, chart::Song)> = Vec::new();
    for (page, song) in found {
        if kept.iter().any(|(_, other)| other.same_song(&song)) {
            continue;
        }
        kept.push((page, song));
        if kept.len() == MAX_CANDIDATES {
            break;
        }
    }
    kept.into_iter()
        .map(|(page, song)| Candidate {
            title: song.title.clone(),
            artist: song.artist.clone(),
            source_name: page.host.clone(),
            source_url: page.url.clone(),
            chordpro_content: song.to_chordpro(),
        })
        .collect()
}

async fn fetch(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let mut response = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() >= MAX_PAGE_BYTES {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
