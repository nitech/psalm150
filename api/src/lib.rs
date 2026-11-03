pub mod access;
pub mod account_links;
pub mod api;
pub mod auth;
pub mod chordpro;
pub mod config;
pub mod error;
pub mod favorites;
pub mod live_sets;
pub mod models;
pub mod online;
pub mod pages;
pub mod remote;
pub mod rooms;
pub mod sets;
pub mod shared_sets;
pub mod song_media;
pub mod throttle;

use std::{path::PathBuf, sync::Arc};

use axum::{
    Router,
    extract::{Path, State},
    http::{HeaderName, HeaderValue, header},
    routing::get,
};
use sqlx::PgPool;
use tower_http::{
    compression::CompressionLayer, services::ServeDir, set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub session_hours: i64,
    /// In-memory relay for remote control through the server.
    pub remote: Arc<remote::RemoteHub>,
    /// In-memory record of who leads which set and how many follow it.
    pub live_sets: Arc<live_sets::LiveSets>,
    /// In-memory counts of wrong passwords.
    pub throttle: Arc<throttle::Throttle>,
    /// Where recordings are kept, and their play links.
    pub media: Arc<song_media::MediaStore>,
    /// Online song lookup with its memory of recent answers.
    pub online: Arc<online::OnlineSearch>,
    /// Where the reverse proxy puts the client's address
    /// (`PSA150_CLIENT_IP_HEADER`); without it, the connection's peer.
    pub client_ip_header: Option<HeaderName>,
}

impl AppState {
    pub fn new(pool: PgPool, session_hours: i64) -> Self {
        Self {
            pool,
            session_hours,
            remote: Arc::default(),
            live_sets: Arc::default(),
            throttle: Arc::default(),
            online: Arc::default(),
            media: Arc::new(song_media::MediaStore::new(PathBuf::from("data/media"))),
            client_ip_header: None,
        }
    }

    /// Keeps recordings under `dir` (`PSA150_MEDIA_DIR`).
    pub fn with_media_dir(mut self, dir: PathBuf) -> Self {
        self.media = Arc::new(song_media::MediaStore::new(dir));
        self
    }

    pub fn with_client_ip_header(mut self, header: Option<HeaderName>) -> Self {
        self.client_ip_header = header;
        self
    }
}

pub fn app(state: AppState, web_dist: PathBuf) -> Router {
    let mut router = Router::new()
        .nest("/api/v1", api::router())
        .route("/api/openapi.json", get(api::openapi));
    if web_dist.is_dir() {
        let index = web_dist.join("index.html");
        // Following a room: `/join` asks for its name, `/join/{name}` opens it.
        // `/api/docs` is the API reference. Invite and reset links let a
        // person choose their password.
        for path in [
            "/join",
            "/join/{room_name}",
            "/api/docs",
            "/invite/{token}",
            "/reset-password/{token}",
        ] {
            let index = index.clone();
            router = router.route(path, get(move || pages::app_page(index.clone())));
        }
        // A set shared on a link, with its name, day and songs for link previews.
        let shared_index = index.clone();
        router = router.route(
            "/shared/{share_key}",
            get(
                move |State(state): State<AppState>, Path(share_key): Path<String>| {
                    pages::shared_set_page(state, share_key, shared_index.clone())
                },
            ),
        );
        router = router.route(
            "/songs/{song_id}",
            get(
                move |State(state): State<AppState>, Path(song_id): Path<String>| {
                    pages::song_page(state, song_id, index.clone())
                },
            ),
        );
    }
    let router = router
        .with_state(state)
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http());

    let router = if web_dist.is_dir() {
        router.fallback_service(ServeDir::new(web_dist).append_index_html_on_directories(true))
    } else {
        tracing::warn!(path = %web_dist.display(), "web interface not found; running headlessly");
        router
    };
    security_headers(router)
}

/// On every response, the files included: the app loads nothing from other
/// sites and is never shown inside another site's frame. Styles allow inline
/// `style` attributes, which the reader's text size uses. The recorder
/// plays back what it just recorded from a `blob:` URL.
fn security_headers(router: Router) -> Router {
    const POLICY: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
        img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; \
        base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
    let headers = [
        (header::CONTENT_SECURITY_POLICY, POLICY),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        (header::X_FRAME_OPTIONS, "DENY"),
        // Sign-in links carry the desktop's redirect and state.
        (header::REFERRER_POLICY, "no-referrer"),
    ];
    headers.into_iter().fold(router, |router, (name, value)| {
        router.layer(SetResponseHeaderLayer::if_not_present(
            name,
            HeaderValue::from_static(value),
        ))
    })
}
