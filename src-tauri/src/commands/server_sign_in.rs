//! Connect a server library by signing in through the browser instead of
//! pasting a desktop token.
//!
//! The desktop listens on a random `127.0.0.1` port and opens the song
//! server's web client in the default browser. After the person signs in and
//! approves, the browser is sent back to the loopback address with a one-time
//! code. The desktop exchanges the code, together with the secret behind the
//! `code_challenge` it sent (PKCE), for an ordinary `psa_d_` desktop token.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

use crate::commands::library::LibraryStatus;
use crate::commands::server_library::{normalize_server_url, synchronize};
use crate::AppState;

/// How long the desktop waits for the browser to come back.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);

/// Cancels the sign-in that is waiting for the browser, if any.
static PENDING_SIGN_IN: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

#[derive(Debug, Serialize)]
pub struct ServerProbe {
    /// The normalised URL (always ending in `/`).
    pub url: String,
    pub initialized: bool,
    /// False for servers that predate browser sign-in; they need a token.
    pub desktop_sign_in: bool,
}

#[derive(Deserialize)]
struct InfoResponse {
    service: String,
    initialized: bool,
    #[serde(default)]
    desktop_sign_in: bool,
}

#[derive(Deserialize)]
struct SetupResponse {
    initialized: bool,
}

#[derive(Deserialize)]
struct TokenResponse {
    token: String,
}

#[derive(Deserialize)]
struct ErrorResponse {
    error: String,
}

fn http_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(timeout)
        .timeout(timeout)
        .build()
        .map_err(|error| error.to_string())
}

/// Quick check that `url` is a Psalm150 song server, for the Settings field.
#[tauri::command]
pub async fn probe_song_server(url: String) -> Result<ServerProbe, String> {
    let url = normalize_server_url(&url)?;
    let base = url::Url::parse(&url).map_err(|error| error.to_string())?;
    let client = http_client(PROBE_TIMEOUT)?;
    let not_a_server = || "No Psalm150 song server answers at this address".to_string();

    let info = client
        .get(
            base.join("api/v1/info")
                .map_err(|error| error.to_string())?,
        )
        .send()
        .await
        .map_err(|_| "Could not reach this address".to_string())?;
    if info.status().is_success() {
        let body = info.text().await.map_err(|_| not_a_server())?;
        let info: InfoResponse = serde_json::from_str(&body).map_err(|_| not_a_server())?;
        if info.service != "psalm150-song-server" {
            return Err(not_a_server());
        }
        return Ok(ServerProbe {
            url,
            initialized: info.initialized,
            desktop_sign_in: info.desktop_sign_in,
        });
    }

    // Servers without /info still answer /setup.
    let setup = client
        .get(
            base.join("api/v1/setup")
                .map_err(|error| error.to_string())?,
        )
        .send()
        .await
        .map_err(|_| not_a_server())?;
    if !setup.status().is_success() {
        return Err(not_a_server());
    }
    let body = setup.text().await.map_err(|_| not_a_server())?;
    let setup: SetupResponse = serde_json::from_str(&body).map_err(|_| not_a_server())?;
    Ok(ServerProbe {
        url,
        initialized: setup.initialized,
        desktop_sign_in: false,
    })
}

/// Sign in through the browser, then connect and download the server library
/// exactly as `connect_server_library` does with a pasted token.
#[tauri::command]
pub async fn sign_in_server_library(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<LibraryStatus, String> {
    let url = normalize_server_url(&url)?;
    let verifier = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let request_state = Uuid::new_v4().simple().to_string();

    let listener = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|error| format!("Could not start the sign-in listener: {error}"))?;
    let port = listener
        .server_addr()
        .to_ip()
        .map(|address| address.port())
        .ok_or_else(|| "Could not start the sign-in listener".to_string())?;
    let redirect = format!("http://127.0.0.1:{port}/callback");

    let mut page = url::Url::parse(&url).map_err(|error| error.to_string())?;
    page.query_pairs_mut()
        .append_pair("desktop_redirect", &redirect)
        .append_pair("state", &request_state)
        .append_pair("code_challenge", &challenge)
        .append_pair("device_name", &device_name());

    let cancelled = Arc::new(AtomicBool::new(false));
    if let Some(previous) = PENDING_SIGN_IN.lock().replace(cancelled.clone()) {
        previous.store(true, Ordering::SeqCst);
    }

    // The page carries no secret: the code is useless without the verifier.
    eprintln!("[server] browser sign-in: {page}");
    app.opener()
        .open_url(page.as_str(), None::<&str>)
        .map_err(|error| format!("Could not open the browser: {error}"))?;

    let expected_state = request_state.clone();
    let waiting = cancelled.clone();
    let code = tauri::async_runtime::spawn_blocking(move || {
        wait_for_callback(&listener, &expected_state, &waiting)
    })
    .await
    .map_err(|error| error.to_string())?;
    {
        let mut pending = PENDING_SIGN_IN.lock();
        if pending
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &cancelled))
        {
            *pending = None;
        }
    }
    let code = code?;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }

    let token = exchange_code(&url, &code, &verifier).await?;
    synchronize(&app, &state, &url, &token, true).await
}

/// Stop waiting for the browser.
#[tauri::command]
pub fn cancel_server_sign_in() {
    if let Some(pending) = PENDING_SIGN_IN.lock().take() {
        pending.store(true, Ordering::SeqCst);
    }
}

/// "Psalm150 on <computer name>", shown to the person approving the sign-in
/// and used as the desktop token's name on the server.
fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .map(|name| format!("Psalm150 on {name}"))
        .unwrap_or_else(|| "Psalm150 desktop".into())
}

/// Serve the loopback address until the browser brings a code (or an error),
/// the operator cancels, or the sign-in times out.
fn wait_for_callback(
    listener: &tiny_http::Server,
    expected_state: &str,
    cancelled: &AtomicBool,
) -> Result<String, String> {
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err("SIGN_IN_CANCELLED: Sign-in was cancelled".into());
        }
        if Instant::now() >= deadline {
            return Err("The browser sign-in timed out. Try again.".into());
        }
        let Ok(Some(request)) = listener.recv_timeout(Duration::from_millis(250)) else {
            continue;
        };
        let Ok(address) = url::Url::parse(&format!("http://127.0.0.1{}", request.url())) else {
            let _ = request.respond(tiny_http::Response::empty(400));
            continue;
        };
        if address.path() != "/callback" {
            let _ = request.respond(tiny_http::Response::empty(404));
            continue;
        }
        let param = |name: &str| {
            address
                .query_pairs()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.into_owned())
        };
        if param("state").as_deref() != Some(expected_state) {
            let _ = request.respond(callback_page(
                400,
                "This sign-in link is out of date",
                "Start the sign-in again from Psalm150.",
            ));
            continue;
        }
        if let Some(code) = param("code").filter(|code| !code.is_empty()) {
            let _ = request.respond(callback_page(
                200,
                "Psalm150 is connecting",
                "You can close this tab and return to Psalm150.",
            ));
            return Ok(code);
        }
        let _ = request.respond(callback_page(
            200,
            "Sign-in cancelled",
            "Psalm150 was not connected. You can close this tab.",
        ));
        return Err("SIGN_IN_CANCELLED: Sign-in was cancelled in the browser".into());
    }
}

fn callback_page(
    status: u16,
    heading: &str,
    text: &str,
) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let html = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Psalm150</title>\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
         <style>body{{font-family:system-ui,sans-serif;background:#141414;color:#eee;display:grid;\
         place-items:center;min-height:100vh;margin:0}}main{{max-width:420px;padding:24px;text-align:center}}\
         h1{{font-size:1.4rem}}p{{color:#aaa}}</style></head>\
         <body><main><h1>{heading}</h1><p>{text}</p></main></body></html>"
    );
    let content_type = tiny_http::Header::from_bytes("Content-Type", "text/html; charset=utf-8")
        .expect("static header");
    tiny_http::Response::from_string(html)
        .with_status_code(status)
        .with_header(content_type)
}

async fn exchange_code(server_url: &str, code: &str, verifier: &str) -> Result<String, String> {
    let endpoint = url::Url::parse(server_url)
        .and_then(|base| base.join("api/v1/desktop-auth/token"))
        .map_err(|error| error.to_string())?;
    let response = http_client(Duration::from_secs(20))?
        .post(endpoint)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(serde_json::json!({ "code": code, "code_verifier": verifier }).to_string())
        .send()
        .await
        .map_err(|error| format!("Could not reach the song server: {error}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let message = serde_json::from_str::<ErrorResponse>(&body)
            .map(|error| error.error)
            .unwrap_or_else(|_| body.trim().to_string());
        return Err(format!("The song server refused the sign-in: {message}"));
    }
    let token = serde_json::from_str::<TokenResponse>(&body)
        .map_err(|_| "The song server sent an invalid sign-in response".to_string())?
        .token;
    if !token.starts_with("psa_d_") {
        return Err("The song server sent an invalid desktop token".into());
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn challenge_matches_rfc_7636_example() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn callback_returns_the_code_and_ignores_other_requests() {
        let listener = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = listener.server_addr().to_ip().unwrap().port();
        let client = std::thread::spawn(move || {
            let get = |path: &str| {
                reqwest::blocking::get(format!("http://127.0.0.1:{port}{path}"))
                    .map(|response| response.status().as_u16())
                    .unwrap_or(0)
            };
            (
                get("/favicon.ico"),
                get("/callback?code=abc&state=wrong"),
                get("/callback?code=abc&state=s1"),
            )
        });
        let code = wait_for_callback(&listener, "s1", &AtomicBool::new(false));
        assert_eq!(code.unwrap(), "abc");
        assert_eq!(client.join().unwrap(), (404, 400, 200));
    }

    #[test]
    fn a_browser_cancel_ends_the_wait() {
        let listener = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = listener.server_addr().to_ip().unwrap().port();
        std::thread::spawn(move || {
            let _ = reqwest::blocking::get(format!(
                "http://127.0.0.1:{port}/callback?error=access_denied&state=s1"
            ));
        });
        let error = wait_for_callback(&listener, "s1", &AtomicBool::new(false)).unwrap_err();
        assert!(error.starts_with("SIGN_IN_CANCELLED"));
    }

    #[test]
    fn cancelling_stops_waiting() {
        let listener = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let error = wait_for_callback(&listener, "s1", &AtomicBool::new(true)).unwrap_err();
        assert!(error.starts_with("SIGN_IN_CANCELLED"));
    }
}
