use std::{env, net::SocketAddr, path::PathBuf};

use axum::http::HeaderName;

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: SocketAddr,
    pub database_url: String,
    pub web_dist: PathBuf,
    pub session_hours: i64,
    /// Where song recordings are kept as files.
    pub media_dir: PathBuf,
    /// A header the reverse proxy sets to the client's address, such as
    /// `X-Forwarded-For`, for limiting failed sign-ins per client.
    pub client_ip_header: Option<HeaderName>,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let database_url =
            env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is required".to_string())?;
        let bind = env::var("PSA150_BIND")
            .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
            .parse()
            .map_err(|error| format!("PSA150_BIND is invalid: {error}"))?;
        let web_dist = env::var("PSA150_WEB_DIST")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../web/dist"));
        let media_dir = env::var("PSA150_MEDIA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data/media"));
        let session_hours = env::var("PSA150_SESSION_HOURS")
            .unwrap_or_else(|_| "168".to_string())
            .parse::<i64>()
            .map_err(|error| format!("PSA150_SESSION_HOURS is invalid: {error}"))?;

        if session_hours < 1 {
            return Err("PSA150_SESSION_HOURS must be at least 1".to_string());
        }
        let client_ip_header = match env::var("PSA150_CLIENT_IP_HEADER") {
            Ok(name) if !name.trim().is_empty() => Some(
                HeaderName::try_from(name.trim())
                    .map_err(|error| format!("PSA150_CLIENT_IP_HEADER is invalid: {error}"))?,
            ),
            _ => None,
        };

        Ok(Self {
            bind,
            database_url,
            web_dist,
            session_hours,
            media_dir,
            client_ip_header,
        })
    }
}
