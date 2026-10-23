//! Finding pages: DuckDuckGo's HTML results, with sites known for clean
//! chord charts first and sites that never have usable text left out.

use scraper::{Html, Selector};

/// Links read from the results page.
const MAX_LINKS: usize = 10;

/// Sites whose pages are usually a clean chart or lyric sheet, best first.
const TRUSTED: &[&str] = &[
    "worshipchords.com",
    "tabs.ultimate-guitar.com",
    "worshiptogether.com",
    "hymnary.org",
    "cifraclub.com",
    "e-chords.com",
    "genius.com",
];

/// Video, social, shops, stores and paywalled or script-only chart sites:
/// no lyrics in the page text.
const SKIPPED: &[&str] = &[
    "duckduckgo.com",
    "youtube.com",
    "youtu.be",
    "facebook.com",
    "instagram.com",
    "tiktok.com",
    "twitter.com",
    "x.com",
    "pinterest.",
    "spotify.com",
    "apple.com",
    "amazon.",
    "shazam.com",
    "deezer.com",
    "musixmatch.com",
    "praisecharts.com",
    "songselect.ccli.com",
    "multitracks.com",
    "chordify.net",
    "wikipedia.org",
];

pub async fn urls(client: &reqwest::Client, query: &str) -> Result<Vec<String>, String> {
    let search = format!("{query} chords lyrics");
    let url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        urlencoding::encode(&search)
    );
    let unavailable = || "The search engine did not answer. Try again in a minute.".to_string();
    let response = client.get(&url).send().await.map_err(|_| unavailable())?;
    if !response.status().is_success() {
        return Err(unavailable());
    }
    let body = response.text().await.map_err(|_| unavailable())?;
    let links = result_links(&body);
    // A bot check instead of results looks like a page with no links.
    if links.is_empty() && body.contains("anomaly") {
        return Err(unavailable());
    }
    Ok(rank(links))
}

fn result_links(body: &str) -> Vec<String> {
    let document = Html::parse_document(body);
    let selector = Selector::parse("a.result__a").expect("valid selector");
    let mut urls = Vec::new();
    for element in document.select(&selector) {
        let Some(href) = element.value().attr("href") else {
            continue;
        };
        let resolved = resolve(href);
        if useful(&resolved) && !urls.contains(&resolved) {
            urls.push(resolved);
        }
        if urls.len() >= MAX_LINKS {
            break;
        }
    }
    urls
}

/// Trusted sites first (in [`TRUSTED`] order), the rest as the engine
/// ranked them.
fn rank(mut urls: Vec<String>) -> Vec<String> {
    urls.sort_by_key(|url| trust_rank(url).unwrap_or(TRUSTED.len()));
    urls
}

pub(crate) fn trust_rank(url: &str) -> Option<usize> {
    let host = host(url)?;
    TRUSTED
        .iter()
        .position(|site| host == *site || host.ends_with(&format!(".{site}")))
}

pub(crate) fn host(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()?
        .host_str()
        .map(|h| h.trim_start_matches("www.").to_lowercase())
}

fn resolve(href: &str) -> String {
    let absolute = if href.starts_with("//") {
        format!("https:{href}")
    } else {
        href.to_string()
    };
    // Results link through a redirect that carries the target as `uddg`.
    if let Ok(parsed) = url::Url::parse(&absolute) {
        if parsed
            .host_str()
            .is_some_and(|h| h.ends_with("duckduckgo.com"))
        {
            if let Some((_, target)) = parsed.query_pairs().find(|(k, _)| k == "uddg") {
                return target.into_owned();
            }
        }
    }
    absolute
}

fn useful(url: &str) -> bool {
    let lower = url.to_lowercase();
    if !lower.starts_with("http") {
        return false;
    }
    let Some(host) = host(&lower) else {
        return false;
    };
    !SKIPPED.iter().any(|skip| {
        if skip.ends_with('.') {
            host.starts_with(skip) || host.contains(&format!(".{skip}"))
        } else {
            host == *skip || host.ends_with(&format!(".{skip}"))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_redirect_links() {
        assert_eq!(
            resolve(
                "//duckduckgo.com/l/?uddg=https%3A%2F%2Fworshipchords.com%2Fway-maker%2F&rut=abc"
            ),
            "https://worshipchords.com/way-maker/"
        );
        assert_eq!(resolve("https://example.com/a"), "https://example.com/a");
    }

    #[test]
    fn skips_video_and_shops_and_ranks_chart_sites_first() {
        assert!(!useful("https://www.youtube.com/watch?v=1"));
        assert!(!useful("https://music.apple.com/x"));
        assert!(!useful("https://www.amazon.co.uk/x"));
        assert!(useful("https://www.lyrics.com/x"));
        let ranked = rank(vec![
            "https://blog.example.com/way-maker".into(),
            "https://genius.com/x".into(),
            "https://worshipchords.com/x".into(),
        ]);
        assert_eq!(ranked[0], "https://worshipchords.com/x");
        assert_eq!(ranked[1], "https://genius.com/x");
        assert_eq!(ranked[2], "https://blog.example.com/way-maker");
    }

    #[test]
    fn reads_result_links_once_each() {
        let body = r#"<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com%2F1">A</a>
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com%2F1">A again</a>
            <a class="result__a" href="https://www.youtube.com/watch?v=1">Video</a>
            <a class="result__a" href="https://b.com/2">B</a>"#;
        assert_eq!(
            result_links(body),
            vec!["https://a.com/1", "https://b.com/2"]
        );
    }
}
