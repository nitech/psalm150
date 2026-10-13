//! Web client pages served at real paths, so links have a stable address the
//! server can see. The web client itself routes by hash; these paths serve its
//! `index.html`, which moves the visitor to the matching hash route.
//!
//! Song and shared-set links carry a descriptive title and Open Graph tags,
//! so a link pasted into a message shows what it opens.

use std::path::PathBuf;

use axum::{
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::NaiveDate;
use uuid::Uuid;

use crate::AppState;

#[derive(sqlx::FromRow)]
struct SongPreview {
    title: String,
    authors: String,
    church_name: String,
    public_library: bool,
}

#[derive(sqlx::FromRow)]
struct SetPreview {
    name: String,
    service_date: Option<NaiveDate>,
    church_name: String,
    titles: Vec<String>,
}

/// What a link preview says. Escaped when written into the page.
struct Preview {
    /// The page's `<title>`.
    page_title: String,
    title: String,
    description: String,
    site_name: String,
}

/// `GET /songs/{id}`: a song's permalink. A song in a public library shows
/// its title and authors; a private song says only which church it is from,
/// so its title never leaves the server without a sign-in.
pub async fn song_page(state: AppState, song_id: String, index: PathBuf) -> Response {
    let preview = match Uuid::parse_str(&song_id) {
        Ok(song_id) => sqlx::query_as::<_, SongPreview>(
            "SELECT r.title, r.authors, c.name AS church_name, c.public_library
             FROM songs s
             JOIN churches c ON c.id = s.church_id
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
    page(&index, preview.map(|song| song_preview(&song))).await
}

/// `GET /shared/{key}`: a set shared on a link. Whoever has the link may read
/// the set, so the preview names it, its day, its church and its songs.
pub async fn shared_set_page(state: AppState, share_key: String, index: PathBuf) -> Response {
    let plausible = (16..=64).contains(&share_key.len())
        && share_key.bytes().all(|byte| byte.is_ascii_alphanumeric());
    let preview = if plausible {
        sqlx::query_as::<_, SetPreview>(
            "SELECT s.name, s.service_date, c.name AS church_name,
                    coalesce(array_agg(r.title ORDER BY i.position)
                             FILTER (WHERE r.title IS NOT NULL), '{}') AS titles
             FROM song_sets s
             JOIN churches c ON c.id = s.church_id
             LEFT JOIN song_set_items i ON i.set_id = s.id
             LEFT JOIN songs song ON song.id = i.song_id AND song.deleted_at IS NULL
             LEFT JOIN song_revisions r ON r.id = song.current_revision_id
             WHERE s.share_key = $1 AND s.deleted_at IS NULL
             GROUP BY s.id, c.name",
        )
        .bind(&share_key)
        .fetch_optional(&state.pool)
        .await
        .unwrap_or_else(|error| {
            tracing::error!(%error, "could not read a shared set for its page");
            None
        })
    } else {
        None
    };
    page(&index, preview.map(|set| set_preview(&set))).await
}

/// A path the web client handles itself, such as `/join/{room_name}`.
pub async fn app_page(index: PathBuf) -> Response {
    page(&index, None).await
}

async fn page(index: &PathBuf, preview: Option<Preview>) -> Response {
    let Ok(html) = tokio::fs::read_to_string(index).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let html = match preview {
        Some(preview) => with_preview(&html, &preview),
        None => html,
    };
    let mut response = html.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    // Titles follow the latest revision, the set and the library's setting.
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

fn song_preview(song: &SongPreview) -> Preview {
    if !song.public_library {
        return Preview {
            page_title: format!("A song from {}", song.church_name),
            title: format!("A song from {}", song.church_name),
            description: "Sign in to read it.".into(),
            site_name: song.church_name.clone(),
        };
    }
    Preview {
        page_title: format!("{} · {}", song.title, song.church_name),
        title: song.title.clone(),
        description: if song.authors.trim().is_empty() {
            format!("A song from {}", song.church_name)
        } else {
            format!("{} · {}", song.authors, song.church_name)
        },
        site_name: song.church_name.clone(),
    }
}

/// "Kvelds · Sunday 18 October 2026", and "Grace Church · 3 songs: A, B, C".
fn set_preview(set: &SetPreview) -> Preview {
    let title = match set.service_date {
        Some(date) => format!("{} · {}", set.name, date.format("%A %-d %B %Y")),
        None => set.name.clone(),
    };
    const LISTED: usize = 5;
    let count = set.titles.len();
    let description = match count {
        0 => format!("{} · No songs yet", set.church_name),
        _ => {
            let mut listed = set.titles[..count.min(LISTED)].join(", ");
            if count > LISTED {
                listed.push_str(&format!(" and {} more", count - LISTED));
            }
            let songs = if count == 1 { "song" } else { "songs" };
            format!("{} · {count} {songs}: {listed}", set.church_name)
        }
    };
    Preview {
        page_title: format!("{title} · {}", set.church_name),
        title,
        description,
        site_name: set.church_name.clone(),
    }
}

/// Replaces the page `<title>` with the preview's, plus Open Graph tags.
fn with_preview(html: &str, preview: &Preview) -> String {
    let tags = format!(
        "<title>{}</title>\n    \
         <meta name=\"description\" content=\"{description}\" />\n    \
         <meta property=\"og:type\" content=\"website\" />\n    \
         <meta property=\"og:title\" content=\"{}\" />\n    \
         <meta property=\"og:description\" content=\"{description}\" />\n    \
         <meta property=\"og:site_name\" content=\"{}\" />\n  ",
        escape(&preview.page_title),
        escape(&preview.title),
        escape(&preview.site_name),
        description = escape(&preview.description),
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

    const HTML: &str =
        "<html><head><meta charset=\"UTF-8\" /><title>PSA150</title></head><body></body></html>";

    #[test]
    fn replaces_the_title_and_escapes() {
        let page = with_preview(
            HTML,
            &song_preview(&SongPreview {
                title: "Grace & \"Truth\"".into(),
                authors: String::new(),
                church_name: "Ordets <Tabernakel>".into(),
                public_library: true,
            }),
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

    #[test]
    fn private_songs_keep_their_title() {
        let page = with_preview(
            HTML,
            &song_preview(&SongPreview {
                title: "Secret".into(),
                authors: "Someone".into(),
                church_name: "Grace Church".into(),
                public_library: false,
            }),
        );
        assert!(!page.contains("Secret") && !page.contains("Someone"));
        assert!(page.contains("<title>A song from Grace Church</title>"));
    }

    #[test]
    fn sets_name_their_day_and_songs() {
        let set = |titles: &[&str], date| SetPreview {
            name: "Kvelds".into(),
            service_date: date,
            church_name: "Grace Church".into(),
            titles: titles.iter().map(|title| (*title).to_string()).collect(),
        };
        let dated = set_preview(&set(&["A", "B"], NaiveDate::from_ymd_opt(2026, 10, 18)));
        assert_eq!(dated.title, "Kvelds · Sunday 18 October 2026");
        assert_eq!(dated.description, "Grace Church · 2 songs: A, B");
        let many = set_preview(&set(&["1", "2", "3", "4", "5", "6", "7"], None));
        assert_eq!(many.title, "Kvelds");
        assert_eq!(
            many.description,
            "Grace Church · 7 songs: 1, 2, 3, 4, 5 and 2 more"
        );
        assert_eq!(
            set_preview(&set(&[], None)).description,
            "Grace Church · No songs yet"
        );
    }
}
