use axum::{
    Json,
    http::{HeaderValue, StatusCode, header::RETRY_AFTER},
    response::IntoResponse,
};
use serde::Serialize;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Unauthorized(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    /// Too many wrong passwords; sent with `Retry-After`.
    #[error("{message}")]
    TooManyRequests {
        message: String,
        retry_after_seconds: u64,
    },
    #[error("database operation failed")]
    Database(#[from] sqlx::Error),
    #[error("internal server error")]
    Internal(String),
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    pub error: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::TooManyRequests { .. } => StatusCode::TOO_MANY_REQUESTS,
            Self::Database(_) | Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status.is_server_error() {
            tracing::error!(error = %self, "request failed");
        }

        let mut response = (
            status,
            Json(ErrorBody {
                error: self.to_string(),
            }),
        )
            .into_response();
        if let Self::TooManyRequests {
            retry_after_seconds,
            ..
        } = self
        {
            response
                .headers_mut()
                .insert(RETRY_AFTER, HeaderValue::from(retry_after_seconds));
        }
        response
    }
}
