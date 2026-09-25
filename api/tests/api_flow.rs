use std::path::PathBuf;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use psa150_server::{AppState, app};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;

#[sqlx::test(migrations = "./migrations")]
async fn private_library_flow(pool: PgPool) {
    let app = test_app(pool);

    let setup_status = send(&app, "GET", "/api/v1/setup", None, None).await;
    assert_eq!(setup_status.0, StatusCode::OK);
    assert_eq!(setup_status.1["initialized"], false);

    let setup = send(
        &app,
        "POST",
        "/api/v1/setup",
        None,
        Some(json!({
            "church_name": "Test Church",
            "owner_name": "Test Owner",
            "username": "owner",
            "password": "long-test-password"
        })),
    )
    .await;
    assert_eq!(setup.0, StatusCode::CREATED);
    let token = setup.1["token"].as_str().expect("setup token");

    let created = send(
        &app,
        "POST",
        "/api/v1/songs",
        Some(token),
        Some(json!({
            "chordpro": "{title: Be Thou My Vision}\n{author: Ancient Irish}\n{language: en}\n\nBe Thou my vision"
        })),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED);
    assert_eq!(created.1["title"], "Be Thou My Vision");
    let song_id = created.1["id"].as_str().expect("song id");
    let first_revision = created.1["revision_id"].as_str().expect("revision id");

    let updated = send(
        &app,
        "PUT",
        &format!("/api/v1/songs/{song_id}"),
        Some(token),
        Some(json!({
            "base_revision_id": first_revision,
            "chordpro": "{title: Be Thou My Vision}\n{author: Ancient Irish}\n{language: en}\n\nBe Thou my vision, O Lord of my heart"
        })),
    )
    .await;
    assert_eq!(updated.0, StatusCode::OK);
    assert_ne!(updated.1["revision_id"], first_revision);

    let stale = send(
        &app,
        "PUT",
        &format!("/api/v1/songs/{song_id}"),
        Some(token),
        Some(json!({
            "base_revision_id": first_revision,
            "chordpro": "{title: Stale edit}\n\nThis must not replace the current revision"
        })),
    )
    .await;
    assert_eq!(stale.0, StatusCode::CONFLICT);

    let list = send(&app, "GET", "/api/v1/songs?q=vision", Some(token), None).await;
    assert_eq!(list.0, StatusCode::OK);
    assert_eq!(list.1.as_array().expect("song list").len(), 1);

    let device = send(
        &app,
        "POST",
        "/api/v1/device-tokens",
        Some(token),
        Some(json!({ "name": "Sanctuary PC" })),
    )
    .await;
    assert_eq!(device.0, StatusCode::CREATED);
    let device_token = device.1["token"].as_str().expect("device token");
    let device_id = device.1["id"].as_str().expect("device id");
    let device_list = send(&app, "GET", "/api/v1/songs", Some(device_token), None).await;
    assert_eq!(device_list.0, StatusCode::OK);

    // Desktops edit songs (to keep Visual Song Book in step) but still cannot
    // manage device tokens.
    let denied = send(
        &app,
        "POST",
        "/api/v1/device-tokens",
        Some(device_token),
        Some(json!({ "name": "Rogue PC" })),
    )
    .await;
    assert_eq!(denied.0, StatusCode::FORBIDDEN);

    let device_song = send(
        &app,
        "POST",
        "/api/v1/songs",
        Some(device_token),
        Some(json!({ "chordpro": "{title: From VSB}\n\nFirst line" })),
    )
    .await;
    assert_eq!(device_song.0, StatusCode::CREATED);
    let device_song_id = device_song.1["id"].as_str().expect("device song id");
    let first_revision = device_song.1["revision_id"].as_str().expect("revision");

    let device_edit = send(
        &app,
        "PUT",
        &format!("/api/v1/songs/{device_song_id}"),
        Some(device_token),
        Some(json!({ "base_revision_id": first_revision, "chordpro": "{title: From VSB}\n\nEdited line" })),
    )
    .await;
    assert_eq!(device_edit.0, StatusCode::OK);

    let stale_delete = send(
        &app,
        "DELETE",
        &format!("/api/v1/songs/{device_song_id}?base_revision_id={first_revision}"),
        Some(device_token),
        None,
    )
    .await;
    assert_eq!(stale_delete.0, StatusCode::CONFLICT);

    let current_revision = device_edit.1["revision_id"].as_str().expect("revision");
    let device_delete = send(
        &app,
        "DELETE",
        &format!("/api/v1/songs/{device_song_id}?base_revision_id={current_revision}"),
        Some(device_token),
        None,
    )
    .await;
    assert_eq!(device_delete.0, StatusCode::NO_CONTENT);
    let gone = send(
        &app,
        "GET",
        &format!("/api/v1/songs/{device_song_id}"),
        Some(device_token),
        None,
    )
    .await;
    assert_eq!(gone.0, StatusCode::NOT_FOUND);

    let device_merge = send(
        &app,
        "POST",
        "/api/v1/songs/import",
        Some(device_token),
        Some(json!({ "songs": [
            {
                "filename": "be-thou-my-vision.pro",
                "chordpro": "{title: Be Thou My Vision}\n{author: Ancient Irish}\n{language: en}\n\nBe Thou my vision, O Lord of my heart"
            },
            {
                "filename": "amazing-grace.pro",
                "chordpro": "{title: Amazing Grace}\n{author: John Newton}\n\nAmazing grace"
            }
        ] })),
    )
    .await;
    assert_eq!(device_merge.0, StatusCode::CREATED);
    assert_eq!(device_merge.1["songs"].as_array().unwrap().len(), 1);
    assert_eq!(device_merge.1["skipped_existing"], 1);

    let merged_list = send(&app, "GET", "/api/v1/songs", Some(device_token), None).await;
    assert_eq!(merged_list.1.as_array().expect("merged song list").len(), 2);

    let revoked = send(
        &app,
        "DELETE",
        &format!("/api/v1/device-tokens/{device_id}"),
        Some(token),
        None,
    )
    .await;
    assert_eq!(revoked.0, StatusCode::NO_CONTENT);
    let after_revoke = send(&app, "GET", "/api/v1/songs", Some(device_token), None).await;
    assert_eq!(after_revoke.0, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn desktop_browser_sign_in_flow(pool: PgPool) {
    let app = test_app(pool.clone());

    let info = send(&app, "GET", "/api/v1/info", None, None).await;
    assert_eq!(info.0, StatusCode::OK);
    assert_eq!(info.1["service"], "psalm150-song-server");
    assert_eq!(info.1["initialized"], false);
    assert_eq!(info.1["desktop_sign_in"], true);
    assert!(info.1["version"].is_string());

    let setup = send(
        &app,
        "POST",
        "/api/v1/setup",
        None,
        Some(json!({
            "church_name": "Grace Chapel",
            "owner_name": "Test Owner",
            "username": "owner",
            "password": "long-test-password"
        })),
    )
    .await;
    assert_eq!(setup.0, StatusCode::CREATED);
    let session = setup.1["token"]
        .as_str()
        .expect("session token")
        .to_string();
    let info = send(&app, "GET", "/api/v1/info", None, None).await;
    assert_eq!(info.1["initialized"], true);

    let song = send(
        &app,
        "POST",
        "/api/v1/songs",
        Some(&session),
        Some(json!({ "chordpro": "{title: Amazing Grace}\n\nAmazing grace" })),
    )
    .await;
    assert_eq!(song.0, StatusCode::CREATED);

    let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-a-long-verifier";
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

    // Codes need a person session; the challenge must look like S256.
    let anonymous = send(
        &app,
        "POST",
        "/api/v1/desktop-auth/codes",
        None,
        Some(json!({ "device_name": "Sanctuary PC", "code_challenge": challenge })),
    )
    .await;
    assert_eq!(anonymous.0, StatusCode::UNAUTHORIZED);
    let bad_challenge = send(
        &app,
        "POST",
        "/api/v1/desktop-auth/codes",
        Some(&session),
        Some(json!({ "device_name": "Sanctuary PC", "code_challenge": "too-short" })),
    )
    .await;
    assert_eq!(bad_challenge.0, StatusCode::BAD_REQUEST);

    let issued = send(
        &app,
        "POST",
        "/api/v1/desktop-auth/codes",
        Some(&session),
        Some(json!({ "device_name": "  Sanctuary PC  ", "code_challenge": challenge })),
    )
    .await;
    assert_eq!(issued.0, StatusCode::CREATED);
    let code = issued.1["code"].as_str().expect("code").to_string();
    assert!(code.starts_with("psa_c_"));
    assert!(issued.1["expires_at"].is_string());

    let exchanged = send(
        &app,
        "POST",
        "/api/v1/desktop-auth/token",
        None,
        Some(json!({ "code": code, "code_verifier": verifier })),
    )
    .await;
    assert_eq!(exchanged.0, StatusCode::CREATED);
    let device_token = exchanged.1["token"].as_str().expect("token").to_string();
    assert!(device_token.starts_with("psa_d_"));
    assert_eq!(exchanged.1["device_name"], "Sanctuary PC");
    assert_eq!(exchanged.1["church_name"], "Grace Chapel");
    let device_id = exchanged.1["device_id"].as_str().expect("device id");

    // Single use.
    let reused = send(
        &app,
        "POST",
        "/api/v1/desktop-auth/token",
        None,
        Some(json!({ "code": code, "code_verifier": verifier })),
    )
    .await;
    assert_eq!(reused.0, StatusCode::BAD_REQUEST);
    assert_eq!(
        reused.1["error"],
        "the sign-in code is invalid or has expired"
    );

    // A wrong verifier is rejected and burns the code.
    let second = send(
        &app,
        "POST",
        "/api/v1/desktop-auth/codes",
        Some(&session),
        Some(json!({ "device_name": "Lobby PC", "code_challenge": challenge })),
    )
    .await;
    assert_eq!(second.0, StatusCode::CREATED);
    let second_code = second.1["code"].as_str().expect("code").to_string();
    let wrong = send(
        &app,
        "POST",
        "/api/v1/desktop-auth/token",
        None,
        Some(json!({ "code": second_code, "code_verifier": "not-the-verifier" })),
    )
    .await;
    assert_eq!(wrong.0, StatusCode::BAD_REQUEST);
    let after_wrong = send(
        &app,
        "POST",
        "/api/v1/desktop-auth/token",
        None,
        Some(json!({ "code": second_code, "code_verifier": verifier })),
    )
    .await;
    assert_eq!(after_wrong.0, StatusCode::BAD_REQUEST);

    let unknown = send(
        &app,
        "POST",
        "/api/v1/desktop-auth/token",
        None,
        Some(json!({ "code": "psa_c_unknown", "code_verifier": verifier })),
    )
    .await;
    assert_eq!(unknown.0, StatusCode::BAD_REQUEST);

    // The new token is an ordinary desktop token.
    let songs = send(&app, "GET", "/api/v1/songs", Some(&device_token), None).await;
    assert_eq!(songs.0, StatusCode::OK);
    assert_eq!(songs.1.as_array().expect("songs").len(), 1);
    let export = send_raw(&app, "/api/v1/songs/export", &device_token).await;
    assert_eq!(export, StatusCode::OK);

    let devices = send(&app, "GET", "/api/v1/device-tokens", Some(&session), None).await;
    assert!(
        devices
            .1
            .as_array()
            .expect("devices")
            .iter()
            .any(|device| device["id"] == device_id && device["name"] == "Sanctuary PC")
    );

    // Desktop tokens cannot approve other desktops.
    let from_device = send(
        &app,
        "POST",
        "/api/v1/desktop-auth/codes",
        Some(&device_token),
        Some(json!({ "device_name": "Rogue PC", "code_challenge": challenge })),
    )
    .await;
    assert_eq!(from_device.0, StatusCode::FORBIDDEN);

    // A code approved by someone who has since been disabled is refused.
    let pending = send(
        &app,
        "POST",
        "/api/v1/desktop-auth/codes",
        Some(&session),
        Some(json!({ "device_name": "Balcony PC", "code_challenge": challenge })),
    )
    .await;
    assert_eq!(pending.0, StatusCode::CREATED);
    sqlx::query("UPDATE users SET disabled_at = now()")
        .execute(&pool)
        .await
        .expect("disable user");
    let disabled = send(
        &app,
        "POST",
        "/api/v1/desktop-auth/token",
        None,
        Some(json!({ "code": pending.1["code"], "code_verifier": verifier })),
    )
    .await;
    assert_eq!(disabled.0, StatusCode::BAD_REQUEST);
}

async fn send_raw(app: &Router, uri: &str, token: &str) -> StatusCode {
    let request = Request::builder()
        .method("GET")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .expect("request");
    app.clone()
        .oneshot(request)
        .await
        .expect("response")
        .status()
}

fn test_app(pool: PgPool) -> Router {
    app(
        AppState {
            pool,
            session_hours: 1,
        },
        PathBuf::from("directory-that-does-not-exist"),
    )
}

async fn send(
    app: &Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let body = match body {
        Some(value) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            Body::from(value.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(builder.body(body).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .expect("response body");
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}
