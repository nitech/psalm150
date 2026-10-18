use scraper::{Html, Selector};

pub fn discover_urls(client: &reqwest::blocking::Client, query: &str) -> Result<Vec<String>, String> {
    let search_query = format!("{query} lyrics chordpro");
    let url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        urlencoding::encode(&search_query)
    );

    let response = client.get(&url).send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Search request failed: {}", response.status()));
    }

    let body = response.text().map_err(|e| e.to_string())?;
    let document = Html::parse_document(&body);
    let result_sel = Selector::parse("a.result__a").map_err(|e| format!("{e:?}"))?;

    let mut urls = Vec::new();
    for element in document.select(&result_sel) {
        if let Some(href) = element.value().attr("href") {
            let resolved = resolve_ddg_url(href);
            if is_useful_url(&resolved) && !urls.contains(&resolved) {
                urls.push(resolved);
            }
        }
        if urls.len() >= 8 {
            break;
        }
    }

    Ok(urls)
}

fn resolve_ddg_url(href: &str) -> String {
    if let Some(stripped) = href.strip_prefix("//duckduckgo.com/l/?uddg=") {
        if let Ok(decoded) = urlencoding::decode(stripped.split('&').next().unwrap_or(stripped)) {
            return decoded.into_owned();
        }
    }
    if href.starts_with("//") {
        return format!("https:{href}");
    }
    href.to_string()
}

fn is_useful_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.starts_with("http")
        && !lower.contains("duckduckgo.com")
        && !lower.contains("youtube.com")
        && !lower.contains("facebook.com")
}
