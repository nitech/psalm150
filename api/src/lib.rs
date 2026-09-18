pub mod api;
pub mod auth;
pub mod chordpro;
pub mod config;
pub mod error;
pub mod models;

use std::path::PathBuf;

use axum::{Router, routing::get};
use sqlx::PgPool;
use tower_http::{compression::CompressionLayer, services::ServeDir, trace::TraceLayer};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub session_hours: i64,
}

pub fn app(state: AppState, web_dist: PathBuf) -> Router {
    let router = Router::new()
        .nest("/api/v1", api::router())
        .route("/api/openapi.json", get(api::openapi))
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
