use std::path::PathBuf;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use psa150_server::{AppState, app};
use serde_json::{Value, json};
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
