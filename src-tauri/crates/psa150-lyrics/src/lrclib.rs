//! LRCLIB (lrclib.net), an open lyrics database with no key: words only,
//! no sections or chords, but clean. A fallback beside the chord sites;
//! a chart of the same song ranks above it.

use serde::Deserialize;

use crate::page::{Block, Page};

/// Matches taken from the database; the first are the best.
const MAX_MATCHES: usize = 2;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Track {
    id: u64,
    track_name: String,
    artist_name: String,
    #[serde(default)]
    instrumental: bool,
    plain_lyrics: Option<String>,
}

fn normalised(text: &str) -> String {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect::<Vec<_>>()
        .join(" ")
}

/// The best matches as pages, or none when the database does not answer.
pub async fn pages(client: &reqwest::Client, query: &str) -> Vec<Page> {
    let Ok(response) = client
        .get("https://lrclib.net/api/search")
        .query(&[("q", query)])
        .send()
        .await
    else {
        return vec![];
    };
    let Ok(tracks) = response.json::<Vec<Track>>().await else {
        return vec![];
    };
    tracks
        .into_iter()
        .filter(|track| !track.instrumental)
        // The database matches loosely ("Oceans" finds "None But Thee (from
        // Young Oceans)"): keep a track whose title is the search, or whose
        // words have the searched line.
        .filter(|track| {
            // "(Where Feet May Fail)", "(Live)" and the like do not count.
            let title = track
                .track_name
                .split(['(', '['])
                .next()
                .unwrap_or_default();
            let same_title = crate::chart::query_match(query, title) >= 0.99
                && crate::chart::query_match(title, query) >= 0.6;
            same_title
                || track.plain_lyrics.as_deref().is_some_and(|lyrics| {
                    query.split_whitespace().count() >= 4
                        && normalised(lyrics).contains(&normalised(query))
                })
        })
        .filter_map(|track| {
            let lyrics = track.plain_lyrics.filter(|l| !l.trim().is_empty())?;
            Some(Page {
                url: format!("https://lrclib.net/api/get/{}", track.id),
                host: "lrclib.net".into(),
                trust: 0.5,
                title: Some(track.track_name),
                artist: Some(track.artist_name).filter(|a| !a.trim().is_empty()),
                blocks: vec![Block {
                    text: lyrics,
                    preformatted: false,
                }],
            })
        })
        .take(MAX_MATCHES)
        .collect()
}
