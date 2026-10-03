//! Web client pages served at real paths, so links have a stable address the
//! server can see. The web client itself routes by hash; these paths serve its
//! `index.html`, which moves the visitor to the matching hash route.

use std::path::PathBuf;

use axum::{
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use uuid::Uuid;

use crate::AppState;

#[derive(sqlx::FromRow)]
struct PublicSongPreview {
    title: String,
    authors: String,
    church_name: String,
}

/// `GET /songs/{id}`: a song's permalink. When the song is in a public
/// library, the page carries its title for link previews; a private song's
/// title never leaves the server without a sign-in.
pub async fn song_page(state: AppState, song_id: String, index: PathBuf) -> Response {
    let Ok(html) = tokio::fs::read_to_string(&index).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let preview = match Uuid::parse_str(&song_id) {
        Ok(song_id) => sqlx::query_as::<_, PublicSongPreview>(
            "SELECT r.title, r.authors, c.name AS church_name
             FROM songs s
             JOIN churches c ON c.id = s.church_id AND c.public_library
             JOIN song_revisions r ON r.id = s.current_revision_id
             WHERE s.id = $1 AND s.deleted_at IS NULL",
        )
        .bind(song_id)
        .fetch_optional(&state.pool)
        .await
        .unwrap_or_else(|error| {
            tracing::error!(%error, "could not read a song for its page");
            None
        }),
        Err(_) => None,
    };
    let html = match preview {
        Some(song) => with_preview(&html, &song),
        None => html,
    };

    let mut response = html.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    // The title follows the song's latest revision and the library's setting.
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

/// Replaces the page `<title>` with the song's, plus Open Graph tags.
fn with_preview(html: &str, song: &PublicSongPreview) -> String {
    let title = escape(&song.title);
    let church = escape(&song.church_name);
    let description = if song.authors.trim().is_empty() {
        format!("A song from {church}")
    } else {
        format!("{} · {church}", escape(&song.authors))
    };
    let tags = format!(
        "<title>{title} · {church}</title>\n    \
         <meta property=\"og:type\" content=\"article\" />\n    \
         <meta property=\"og:title\" content=\"{title}\" />\n    \
         <meta property=\"og:description\" content=\"{description}\" />\n    \
         <meta property=\"og:site_name\" content=\"{church}\" />\n  "
    );
    let without_title = match (html.find("<title>"), html.find("</title>")) {
        (Some(start), Some(end)) if start < end => {
            format!("{}{}", &html[..start], &html[end + "</title>".len()..])
        }
        _ => html.to_string(),
    };
    match without_title.find("</head>") {
        Some(head_end) => format!(
            "{}{tags}{}",
            &without_title[..head_end],
            &without_title[head_end..]
        ),
        None => without_title,
    }
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_the_title_and_escapes() {
        let html = "<html><head><meta charset=\"UTF-8\" /><title>PSA150</title></head><body></body></html>";
        let page = with_preview(
            html,
            &PublicSongPreview {
                title: "Grace & \"Truth\"".into(),
                authors: String::new(),
                church_name: "Ordets <Tabernakel>".into(),
            },
        );
        assert!(!page.contains("<title>PSA150</title>"));
        assert!(
            page.contains(
                "<title>Grace &amp; &quot;Truth&quot; · Ordets &lt;Tabernakel&gt;</title>"
            )
        );
        assert!(page.contains("content=\"A song from Ordets &lt;Tabernakel&gt;\""));
        assert!(page.contains("</head><body>"));
    }
}
