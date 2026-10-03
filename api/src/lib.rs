pub mod api;
pub mod auth;
pub mod chordpro;
pub mod config;
pub mod error;
pub mod models;
pub mod pages;
pub mod remote;
pub mod sets;

use std::{path::PathBuf, sync::Arc};

use axum::{
    Router,
    extract::{Path, State},
    routing::get,
};
use sqlx::PgPool;
use tower_http::{compression::CompressionLayer, services::ServeDir, trace::TraceLayer};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub session_hours: i64,
    /// In-memory relay for remote control through the server.
    pub remote: Arc<remote::RemoteHub>,
}

impl AppState {
    pub fn new(pool: PgPool, session_hours: i64) -> Self {
        Self {
            pool,
            session_hours,
            remote: Arc::default(),
        }
    }
}

pub fn app(state: AppState, web_dist: PathBuf) -> Router {
    let mut router = Router::new()
        .nest("/api/v1", api::router())
        .route("/api/openapi.json", get(api::openapi));
    if web_dist.is_dir() {
        let index = web_dist.join("index.html");
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

    if web_dist.is_dir() {
        router.fallback_service(ServeDir::new(web_dist).append_index_html_on_directories(true))
    } else {
        tracing::warn!(path = %web_dist.display(), "web interface not found; running headlessly");
        router
    }
}
