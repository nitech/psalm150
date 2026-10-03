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

#[sqlx::test(migrations = "./migrations")]
async fn songs_page_in_title_order(pool: PgPool) {
    let app = test_app(pool);
    let (token, _) = owner_and_desktop(&app).await;
    for title in ["Gamma", "Alpha", "Be Thou My Vision", "Beta"] {
        create_song(&app, &token, title).await;
    }
    let titles = |page: &Value| -> Vec<String> {
        page.as_array()
            .expect("song page")
            .iter()
            .map(|song| song["title"].as_str().expect("title").to_string())
            .collect()
    };

    // `offset` skips rows in title order (a space sorts before a letter), so
    // pages never overlap.
    let first = send(&app, "GET", "/api/v1/songs?limit=2", Some(&token), None).await;
    let second = send(
        &app,
        "GET",
        "/api/v1/songs?limit=2&offset=2",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(second.0, StatusCode::OK);
    assert_eq!(titles(&first.1), ["Alpha", "Be Thou My Vision"]);
    assert_eq!(titles(&second.1), ["Beta", "Gamma"]);
    let past_end = send(&app, "GET", "/api/v1/songs?offset=50", Some(&token), None).await;
    assert!(titles(&past_end.1).is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn public_library_flow(pool: PgPool) {
    let app = test_app(pool.clone());
    let (owner, desktop) = owner_and_desktop(&app).await;
    let (song_id, _) = create_song(&app, &owner, "Amazing Grace").await;
    let song_uri = format!("/api/v1/public/songs/{song_id}");

    // Private by default: nothing is readable without signing in.
    let info = send(&app, "GET", "/api/v1/info", None, None).await;
    assert_eq!(info.1["public_library"], false);
    assert_eq!(info.1["public_library_name"], Value::Null);
    let hidden = send(&app, "GET", "/api/v1/public/songs", None, None).await;
    assert_eq!(hidden.0, StatusCode::OK);
    assert!(hidden.1.as_array().expect("songs").is_empty());
    let hidden = send(&app, "GET", &song_uri, None, None).await;
    assert_eq!(hidden.0, StatusCode::NOT_FOUND);

    // Only a person owner opens the library.
    let viewer = viewer_session(&app, &pool).await;
    for token in [&viewer, &desktop] {
        let denied = send(
            &app,
            "PUT",
            "/api/v1/church",
            Some(token),
            Some(json!({ "public_library": true })),
        )
        .await;
        assert_eq!(denied.0, StatusCode::FORBIDDEN);
    }
    let church = send(&app, "GET", "/api/v1/church", Some(&viewer), None).await;
    assert_eq!(church.1["public_library"], false);
    let opened = send(
        &app,
        "PUT",
        "/api/v1/church",
        Some(&owner),
        Some(json!({ "public_library": true })),
    )
    .await;
    assert_eq!(opened.0, StatusCode::OK);
    assert_eq!(opened.1["public_library"], true);

    let info = send(&app, "GET", "/api/v1/info", None, None).await;
    assert_eq!(info.1["public_library"], true);
    assert_eq!(info.1["public_library_name"], "Test Church");
    let found = send(&app, "GET", "/api/v1/public/songs?q=grace", None, None).await;
    assert_eq!(found.1.as_array().expect("songs").len(), 1);
    let song = send(&app, "GET", &song_uri, None, None).await;
    assert_eq!(song.0, StatusCode::OK);
    assert_eq!(song.1["title"], "Amazing Grace");

    // Read only: writes and sets still need a sign-in.
    let write = send(
        &app,
        "POST",
        "/api/v1/songs",
        None,
        Some(json!({ "chordpro": "{title: Spam}" })),
    )
    .await;
    assert_eq!(write.0, StatusCode::UNAUTHORIZED);
    let sets = send(&app, "GET", "/api/v1/sets", None, None).await;
    assert_eq!(sets.0, StatusCode::UNAUTHORIZED);

    // Deleted songs are gone from the public library too.
    let deleted = send(
        &app,
        "DELETE",
        &format!("/api/v1/songs/{song_id}"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(deleted.0, StatusCode::NO_CONTENT);
    let gone = send(&app, "GET", &song_uri, None, None).await;
    assert_eq!(gone.0, StatusCode::NOT_FOUND);

    let closed = send(
        &app,
        "PUT",
        "/api/v1/church",
        Some(&owner),
        Some(json!({ "public_library": false })),
    )
    .await;
    assert_eq!(closed.1["public_library"], false);
    let info = send(&app, "GET", "/api/v1/info", None, None).await;
    assert_eq!(info.1["public_library"], false);
}

#[sqlx::test(migrations = "./migrations")]
async fn song_permalink_page(pool: PgPool) {
    let web = std::env::temp_dir().join(format!("psa150-web-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&web).expect("web dir");
    std::fs::write(
        web.join("index.html"),
        "<html><head><title>PSA150</title></head><body><div id=\"app\"></div></body></html>",
    )
    .expect("index");
    let app = app(AppState::new(pool, 1), web.clone());
    let (owner, _) = owner_and_desktop(&app).await;
    let (song_id, _) = create_song(&app, &owner, "Amazing Grace").await;
    let page = |path: String| {
        let app = app.clone();
        async move {
            let response = app
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .body(Body::empty())
                        .expect("request"),
                )
                .await
                .expect("response");
            let status = response.status();
            let body = to_bytes(response.into_body(), 1024 * 1024)
                .await
                .expect("body");
            (status, String::from_utf8(body.to_vec()).expect("utf-8"))
        }
    };

    // Private: the app loads, but the song's title stays on the server.
    let (status, html) = page(format!("/songs/{song_id}")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(html.contains("<div id=\"app\">"));
    assert!(!html.contains("Amazing Grace"));

    send(
        &app,
        "PUT",
        "/api/v1/church",
        Some(&owner),
        Some(json!({ "public_library": true })),
    )
    .await;
    let (_, html) = page(format!("/songs/{song_id}")).await;
    assert!(html.contains("<title>Amazing Grace · Test Church</title>"));
    assert!(html.contains("<meta property=\"og:title\" content=\"Amazing Grace\" />"));

    // Unknown or malformed ids still load the app, which says "Not found".
    let (status, html) = page("/songs/not-a-song".into()).await;
    assert_eq!(status, StatusCode::OK);
    assert!(html.contains("<title>PSA150</title>"));
    std::fs::remove_dir_all(web).ok();
}

/// Sets up the server and returns (owner session, desktop token).
async fn owner_and_desktop(app: &Router) -> (String, String) {
    let setup = send(
        app,
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
    let session = setup.1["token"].as_str().expect("session").to_string();
    let device = send(
        app,
        "POST",
        "/api/v1/device-tokens",
        Some(&session),
        Some(json!({ "name": "Sanctuary PC" })),
    )
    .await;
    assert_eq!(device.0, StatusCode::CREATED);
    let device = device.1["token"]
        .as_str()
        .expect("device token")
        .to_string();
    (session, device)
}

async fn viewer_session(app: &Router, pool: &PgPool) -> String {
    let church_id = sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM churches LIMIT 1")
        .fetch_one(pool)
        .await
        .expect("church");
    let hash = psa150_server::auth::hash_password("viewer-password-1".into())
        .await
        .expect("hash");
    let user_id = uuid::Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, display_name, username, password_hash) VALUES ($1, 'Viewer', 'viewer', $2)",
    )
    .bind(user_id)
    .bind(hash)
    .execute(pool)
    .await
    .expect("viewer");
    sqlx::query("INSERT INTO memberships (user_id, church_id, role) VALUES ($1, $2, 'viewer')")
        .bind(user_id)
        .bind(church_id)
        .execute(pool)
        .await
        .expect("membership");
    let login = send(
        app,
        "POST",
        "/api/v1/session",
        None,
        Some(json!({ "username": "viewer", "password": "viewer-password-1" })),
    )
    .await;
    assert_eq!(login.0, StatusCode::OK);
    login.1["token"].as_str().expect("viewer token").to_string()
}

async fn create_song(app: &Router, token: &str, title: &str) -> (String, String) {
    let created = send(
        app,
        "POST",
        "/api/v1/songs",
        Some(token),
        Some(json!({ "chordpro": format!("{{title: {title}}}\n\n[G]Words") })),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED);
    (
        created.1["id"].as_str().expect("id").to_string(),
        created.1["revision_id"]
            .as_str()
            .expect("revision")
            .to_string(),
    )
}

#[sqlx::test(migrations = "./migrations")]
async fn sets_flow(pool: PgPool) {
    let app = test_app(pool.clone());
    let (session, desktop) = owner_and_desktop(&app).await;
    let (grace, grace_revision) = create_song(&app, &session, "Amazing Grace").await;
    let (vision, _) = create_song(&app, &session, "Be Thou My Vision").await;

    // A desktop creates a set offline with its own id, then uploads it.
    let set_id = uuid::Uuid::new_v4().to_string();
    let created = send(
        &app,
        "POST",
        "/api/v1/sets",
        Some(&desktop),
        Some(json!({
            "id": set_id,
            "name": "  Sunday morning ",
            "service_date": "2026-10-04",
            "items": [
                { "kind": "song", "song_id": grace, "transpose": 2, "note": "Capo 2" },
                { "kind": "blank" }
            ]
        })),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED);
    assert_eq!(created.1["id"], set_id);
    assert_eq!(created.1["name"], "Sunday morning");
    assert_eq!(created.1["version"], 1);
    assert_eq!(created.1["items"][0]["song"]["title"], "Amazing Grace");
    assert_eq!(created.1["items"][0]["song"]["revision_id"], grace_revision);
    assert_eq!(created.1["items"][0]["transpose"], 2);
    assert_eq!(created.1["items"][1]["kind"], "blank");
    let grace_item = created.1["items"][0]["id"].clone();

    // Uploading the same offline set twice does not create a second one.
    let again = send(
        &app,
        "POST",
        "/api/v1/sets",
        Some(&desktop),
        Some(json!({ "id": set_id, "name": "Duplicate" })),
    )
    .await;
    assert_eq!(again.0, StatusCode::CONFLICT);

    // A leader on a phone reorders it, keeping item identity.
    let updated = send(
        &app,
        "PUT",
        &format!("/api/v1/sets/{set_id}"),
        Some(&session),
        Some(json!({
            "base_version": 1,
            "name": "Sunday morning",
            "service_date": "2026-10-04",
            "items": [
                { "kind": "song", "song_id": vision },
                { "id": grace_item, "kind": "song", "song_id": grace, "transpose": 2 }
            ]
        })),
    )
    .await;
    assert_eq!(updated.0, StatusCode::OK);
    assert_eq!(updated.1["version"], 2);
    assert_eq!(updated.1["items"][1]["id"], grace_item);
    assert_eq!(updated.1["items"][0]["song"]["title"], "Be Thou My Vision");

    // The desktop's edit based on version 1 is refused, not merged.
    let stale = send(
        &app,
        "PUT",
        &format!("/api/v1/sets/{set_id}"),
        Some(&desktop),
        Some(json!({ "base_version": 1, "name": "Old", "items": [] })),
    )
    .await;
    assert_eq!(stale.0, StatusCode::CONFLICT);

    // Viewers read sets but cannot change them.
    let viewer = viewer_session(&app, &pool).await;
    let list = send(&app, "GET", "/api/v1/sets", Some(&viewer), None).await;
    assert_eq!(list.0, StatusCode::OK);
    assert_eq!(list.1[0]["item_count"], 2);
    let refused = send(
        &app,
        "POST",
        "/api/v1/sets",
        Some(&viewer),
        Some(json!({ "name": "Mine" })),
    )
    .await;
    assert_eq!(refused.0, StatusCode::FORBIDDEN);

    // Songs must exist in this library; bad shapes are rejected.
    let unknown = send(
        &app,
        "POST",
        "/api/v1/sets",
        Some(&session),
        Some(
            json!({ "name": "X", "items": [{ "kind": "song", "song_id": uuid::Uuid::new_v4() }] }),
        ),
    )
    .await;
    assert_eq!(unknown.0, StatusCode::BAD_REQUEST);
    let no_song = send(
        &app,
        "POST",
        "/api/v1/sets",
        Some(&session),
        Some(json!({ "name": "X", "items": [{ "kind": "song" }] })),
    )
    .await;
    assert_eq!(no_song.0, StatusCode::BAD_REQUEST);
    let transpose = send(
        &app,
        "POST",
        "/api/v1/sets",
        Some(&session),
        Some(json!({ "name": "X", "items": [{ "kind": "song", "song_id": grace, "transpose": 12 }] })),
    )
    .await;
    assert_eq!(transpose.0, StatusCode::BAD_REQUEST);

    // A deleted song stays in the set without its details.
    let deleted = send(
        &app,
        "DELETE",
        &format!("/api/v1/songs/{vision}"),
        Some(&session),
        None,
    )
    .await;
    assert_eq!(deleted.0, StatusCode::NO_CONTENT);
    let snapshot = send(&app, "GET", "/api/v1/sets/snapshot", Some(&desktop), None).await;
    assert_eq!(snapshot.0, StatusCode::OK);
    assert_eq!(snapshot.1.as_array().map(Vec::len), Some(1));
    assert_eq!(snapshot.1[0]["items"][0]["song"], Value::Null);
    assert_eq!(snapshot.1[0]["items"][1]["song"]["title"], "Amazing Grace");

    // Deleting needs the current version when one is given.
    let stale_delete = send(
        &app,
        "DELETE",
        &format!("/api/v1/sets/{set_id}?base_version=1"),
        Some(&session),
        None,
    )
    .await;
    assert_eq!(stale_delete.0, StatusCode::CONFLICT);
    let removed = send(
        &app,
        "DELETE",
        &format!("/api/v1/sets/{set_id}?base_version=2"),
        Some(&session),
        None,
    )
    .await;
    assert_eq!(removed.0, StatusCode::NO_CONTENT);
    let gone = send(
        &app,
        "GET",
        &format!("/api/v1/sets/{set_id}"),
        Some(&session),
        None,
    )
    .await;
    assert_eq!(gone.0, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn remote_control_flow(pool: PgPool) {
    let app = test_app(pool.clone());
    let (session, desktop) = owner_and_desktop(&app).await;
    let (song, _) = create_song(&app, &session, "Amazing Grace").await;

    // Nothing is online yet.
    let none = send(&app, "GET", "/api/v1/remote/desktops", Some(&session), None).await;
    assert_eq!(none.1, json!([]));

    // Only desktop tokens report state.
    let not_device = send(
        &app,
        "PUT",
        "/api/v1/remote/desktop",
        Some(&session),
        Some(json!({ "accepts_commands": true })),
    )
    .await;
    assert_eq!(not_device.0, StatusCode::FORBIDDEN);

    let report = send(
        &app,
        "PUT",
        "/api/v1/remote/desktop",
        Some(&desktop),
        Some(json!({
            "accepts_commands": false,
            "projecting": true,
            "song_title": "Amazing Grace",
            "slide_index": 0,
            "slide_labels": ["Verse 1", "Chorus"]
        })),
    )
    .await;
    assert_eq!(report.0, StatusCode::NO_CONTENT);
    let listed = send(&app, "GET", "/api/v1/remote/desktops", Some(&session), None).await;
    assert_eq!(listed.1[0]["name"], "Sanctuary PC");
    assert_eq!(listed.1[0]["online"], true);
    assert_eq!(listed.1[0]["state"]["slide_labels"][1], "Chorus");
    let device_id = listed.1[0]["device_id"]
        .as_str()
        .expect("device id")
        .to_string();
    let commands_uri = format!("/api/v1/remote/desktops/{device_id}/commands");

    // The operator has not allowed remote control.
    let refused = send(
        &app,
        "POST",
        &commands_uri,
        Some(&session),
        Some(json!({ "action": "next" })),
    )
    .await;
    assert_eq!(refused.0, StatusCode::CONFLICT);

    send(
        &app,
        "PUT",
        "/api/v1/remote/desktop",
        Some(&desktop),
        Some(json!({ "accepts_commands": true })),
    )
    .await;
    let sent = send(
        &app,
        "POST",
        &commands_uri,
        Some(&session),
        Some(json!({ "action": "next" })),
    )
    .await;
    assert_eq!(sent.0, StatusCode::ACCEPTED);
    assert_eq!(sent.1["issued_by"], "Test Owner");
    let project = send(
        &app,
        "POST",
        &commands_uri,
        Some(&session),
        Some(json!({ "action": "project_song", "song_id": song })),
    )
    .await;
    assert_eq!(project.0, StatusCode::ACCEPTED);
    let missing = send(
        &app,
        "POST",
        &commands_uri,
        Some(&session),
        Some(json!({ "action": "show_slide" })),
    )
    .await;
    assert_eq!(missing.0, StatusCode::BAD_REQUEST);
    let set = send(
        &app,
        "POST",
        "/api/v1/sets",
        Some(&session),
        Some(json!({ "name": "Evening", "items": [{ "kind": "song", "song_id": song }] })),
    )
    .await;
    let set_id = set.1["id"].clone();
    let outside = send(
        &app,
        "POST",
        &commands_uri,
        Some(&session),
        Some(json!({ "action": "project_set_item", "set_id": set_id, "item_index": 1 })),
    )
    .await;
    assert_eq!(outside.0, StatusCode::BAD_REQUEST);
    let inside = send(
        &app,
        "POST",
        &commands_uri,
        Some(&session),
        Some(json!({ "action": "project_set_item", "set_id": set_id, "item_index": 0 })),
    )
    .await;
    assert_eq!(inside.0, StatusCode::ACCEPTED);

    // Viewers watch but do not steer.
    let viewer = viewer_session(&app, &pool).await;
    let viewer_list = send(&app, "GET", "/api/v1/remote/desktops", Some(&viewer), None).await;
    assert_eq!(viewer_list.0, StatusCode::OK);
    let viewer_command = send(
        &app,
        "POST",
        &commands_uri,
        Some(&viewer),
        Some(json!({ "action": "blank" })),
    )
    .await;
    assert_eq!(viewer_command.0, StatusCode::FORBIDDEN);

    // The desktop receives the queued commands in order, once.
    let received = send(
        &app,
        "GET",
        "/api/v1/remote/desktop/commands",
        Some(&desktop),
        None,
    )
    .await;
    assert_eq!(received.0, StatusCode::OK);
    assert_eq!(received.1[0]["action"], "next");
    assert_eq!(received.1[1]["action"], "project_song");
    assert_eq!(received.1[1]["song_id"], song);
    assert_eq!(received.1[2]["action"], "project_set_item");
    let empty = send(
        &app,
        "GET",
        "/api/v1/remote/desktop/commands?wait=0",
        Some(&desktop),
        None,
    )
    .await;
    assert_eq!(empty.1, json!([]));

    // A long poll wakes up when a command arrives.
    let waiter = {
        let app = app.clone();
        let desktop = desktop.clone();
        tokio::spawn(async move {
            send(
                &app,
                "GET",
                "/api/v1/remote/desktop/commands?wait=10",
                Some(&desktop),
                None,
            )
            .await
        })
    };
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let started = std::time::Instant::now();
    send(
        &app,
        "POST",
        &commands_uri,
        Some(&session),
        Some(json!({ "action": "blank" })),
    )
    .await;
    let woke = waiter.await.expect("waiter");
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    assert_eq!(woke.1[0]["action"], "blank");

    // Leaving takes the desktop off the list's online commands path.
    let left = send(
        &app,
        "DELETE",
        "/api/v1/remote/desktop",
        Some(&desktop),
        None,
    )
    .await;
    assert_eq!(left.0, StatusCode::NO_CONTENT);
    let offline = send(
        &app,
        "POST",
        &commands_uri,
        Some(&session),
        Some(json!({ "action": "next" })),
    )
    .await;
    assert_eq!(offline.0, StatusCode::NOT_FOUND);
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
        AppState::new(pool, 1),
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
