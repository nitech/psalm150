mod scrape;
mod search;
mod to_chordpro;

use serde::{Deserialize, Serialize};

const MAX_CANDIDATES: usize = 3;
const SEARCH_TIMEOUT_SECS: u64 = 10;
const USER_AGENT: &str = "Praise/0.1 (church worship projection; +https://github.com/nitech/praise)";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSearchCandidate {
    pub title: String,
    pub source_name: String,
    pub source_url: String,
    pub chordpro_content: String,
}

pub fn search_songs(query: &str) -> Result<Vec<WebSearchCandidate>, String> {
    let trimmed = query.trim();
    if trimmed.len() < 3 {
        return Ok(vec![]);
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(SEARCH_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;

    let urls = search::discover_urls(&client, trimmed)?;
    let mut candidates = Vec::new();

    for url in urls {
        if candidates.len() >= MAX_CANDIDATES {
            break;
        }
        let Ok((source_name, raw_text)) = scrape::fetch_lyrics(&client, &url) else {
            continue;
        };
        if raw_text.trim().len() < 20 {
            continue;
        }
        let title = to_chordpro::extract_title(&raw_text).unwrap_or_else(|| trimmed.to_string());
        let chordpro = to_chordpro::raw_to_chordpro(&title, &raw_text);
        if chordpro.lines().count() < 3 {
            continue;
        }
        candidates.push(WebSearchCandidate {
            title,
            source_name,
            source_url: url,
            chordpro_content: chordpro,
        });
    }

    Ok(candidates)
}
