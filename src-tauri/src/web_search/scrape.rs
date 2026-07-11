use scraper::{ElementRef, Html, Selector};

pub fn fetch_lyrics(
    client: &reqwest::blocking::Client,
    url: &str,
) -> Result<(String, String), String> {
    let response = client.get(url).send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let body = response.text().map_err(|e| e.to_string())?;
    let document = Html::parse_document(&body);

    let source_name = host_label(url);

    if let Some(text) = extract_worshipchords(&document, url) {
        return Ok((source_name, text));
    }
    if let Some(text) = extract_ultimate_guitar(&document) {
        return Ok((source_name, text));
    }
    if let Some(text) = extract_worship_together(&document) {
        return Ok((source_name, text));
    }
    if let Some(text) = extract_generic(&document) {
        return Ok((source_name, text));
    }

    Err("No lyrics found on page".into())
}

fn host_label(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string()))
        .unwrap_or_else(|| "Web".into())
}

fn extract_worshipchords(document: &Html, url: &str) -> Option<String> {
    if !url.contains("worshipchords.com") {
        return None;
    }
    let pre_sel = Selector::parse("pre").ok()?;
    let mut best: Option<String> = None;
    for element in document.select(&pre_sel) {
        let text = element_text(&element);
        if text.contains("Verse") || text.contains("Chorus") || text.contains("verse") {
            if text.len() > best.as_ref().map(|b| b.len()).unwrap_or(0) {
                best = Some(text);
            }
        }
    }
    best
}

fn extract_ultimate_guitar(document: &Html) -> Option<String> {
    let sel = Selector::parse("div.js-store, pre, code").ok()?;
    for element in document.select(&sel) {
        let text = element_text(&element);
        if text.contains("verse") || text.contains("chord") || text.lines().count() > 6 {
            if text.len() > 40 {
                return Some(text);
            }
        }
    }
    None
}

fn extract_worship_together(document: &Html) -> Option<String> {
    for sel_str in ["div.lyrics, div.song-lyrics, article.lyrics", "div.entry-content"] {
        let sel = Selector::parse(sel_str).ok()?;
        for element in document.select(&sel) {
            let text = element_text(&element);
            if text.lines().count() >= 4 && text.len() > 40 {
                return Some(text);
            }
        }
    }
    None
}

fn extract_generic(document: &Html) -> Option<String> {
    let pre_sel = Selector::parse("pre").ok()?;
    let mut best: Option<String> = None;
    for element in document.select(&pre_sel) {
        let text = element_text(&element);
        if text.len() > best.as_ref().map(|b| b.len()).unwrap_or(40) {
            best = Some(text);
        }
    }
    if best.is_some() {
        return best;
    }

    let lyric_sel = Selector::parse("[class*='lyric'], [id*='lyric'], [class*='chord']").ok()?;
    for element in document.select(&lyric_sel) {
        let text = element_text(&element);
        if text.lines().count() >= 4 && text.len() > 60 {
            return Some(text);
        }
    }

    None
}

fn element_text(element: &ElementRef<'_>) -> String {
    element
        .text()
        .collect::<Vec<_>>()
        .join("\n")
        .lines()
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n")
}
