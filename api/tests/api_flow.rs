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
    let count = |search: &'static str| {
        let app = app.clone();
        async move {
            let uri = format!("/api/v1/songs?q={search}");
            let list = send(&app, "GET", &uri, Some(token), None).await;
            assert_eq!(list.0, StatusCode::OK, "{search}");
            list.1.as_array().expect("song list").len()
        }
    };
    // Lyrics match from a word of three letters; shorter searches look at the
    // title, authors and number only. `%` and `_` are plain characters.
    assert_eq!(count("lord%20of%20my").await, 1);
    assert_eq!(count("my").await, 1, "title");
    assert_eq!(count("O").await, 1, "title");
    assert_eq!(count("of").await, 0, "lyrics need three letters");
    assert_eq!(count("%25").await, 0);
    assert_eq!(count("_").await, 0);
    let long = send(
        &app,
        "GET",
        &format!("/api/v1/songs?q={}", "a".repeat(201)),
        Some(token),
        None,
    )
    .await;
    assert_eq!(long.0, StatusCode::BAD_REQUEST);

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
    assert_eq!(info.1["desktop_api"], 1);
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
async fn songs_sort_by_number(pool: PgPool) {
    let app = test_app(pool);
    let (token, _) = owner_and_desktop(&app).await;
    // The desktop's `{meta: song_num=…}` and an explicit `{number}` both count.
    for (title, number) in [
        ("Ten", "{meta: song_num=10}"),
        ("Nine", "{meta: song_num=9}"),
        ("None", ""),
        ("Twelve a", "{number: 12a}"),
        ("Hundred", "{meta: song_num=100}"),
    ] {
        // Imported, so a song without a number stays without one.
        let created = send(
            &app,
            "POST",
            "/api/v1/songs/import",
            Some(&token),
            Some(json!({ "songs": [{ "filename": format!("{title}.pro"), "chordpro": format!("{{title: {title}}}\n{number}\n\nWords") }] })),
        )
        .await;
        assert_eq!(created.0, StatusCode::CREATED);
    }
    let titles = |page: &Value| -> Vec<String> {
        page.as_array()
            .expect("song page")
            .iter()
            .map(|song| song["title"].as_str().expect("title").to_string())
            .collect()
    };

    let ascending = send(&app, "GET", "/api/v1/songs?sort=number", Some(&token), None).await;
    assert_eq!(ascending.1[0]["song_number"], "9");
    assert_eq!(
        titles(&ascending.1),
        ["Nine", "Ten", "Twelve a", "Hundred", "None"]
    );
    let descending = send(
        &app,
        "GET",
        "/api/v1/songs?sort=number&direction=desc&limit=2&offset=1",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(titles(&descending.1), ["Twelve a", "Ten"]);
    let by_title = send(
        &app,
        "GET",
        "/api/v1/songs?sort=title&direction=desc",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(titles(&by_title.1)[0], "Twelve a");
    let bad = send(&app, "GET", "/api/v1/songs?sort=tempo", Some(&token), None).await;
    assert_eq!(bad.0, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrations = "./migrations")]
async fn songs_filter_and_sort_by_key(pool: PgPool) {
    let app = test_app(pool);
    let (token, _) = owner_and_desktop(&app).await;
    for (title, key) in [
        ("G song", "{key: G}"),
        ("Gm song", "{key: Gm7}"),
        ("Db song", "{meta: key=Db}"),
        ("C# minor song", "{key: c#-moll}"),
        ("Bb song", "{key: Bb}"),
        ("Compound", "{key: D / E}"),
        ("Major seventh", "{key: Amaj7}"),
        ("Without key", ""),
        ("Not a note", "{key: ?}"),
    ] {
        let created = send(
            &app,
            "POST",
            "/api/v1/songs",
            Some(&token),
            Some(json!({ "chordpro": format!("{{title: {title}}}
{key}

Words") })),
        )
        .await;
        assert_eq!(created.0, StatusCode::CREATED);
    }
    let titles = |page: &Value| -> Vec<String> {
        page.as_array()
            .expect("song page")
            .iter()
            .map(|song| song["title"].as_str().expect("title").to_string())
            .collect()
    };
    let get = |uri: &'static str| send(&app, "GET", uri, Some(&token), None);

    let by_key = get("/api/v1/songs?sort=key").await;
    assert_eq!(
        titles(&by_key.1),
        [
            "Db song",
            "C# minor song",
            "Compound",
            "G song",
            "Gm song",
            "Major seventh",
            "Bb song",
            "Not a note",
            "Without key"
        ]
    );
    assert_eq!(by_key.1[0]["song_key"], "Db");
    assert_eq!(by_key.1[8]["song_key"], Value::Null);
    let descending = get("/api/v1/songs?sort=key&direction=desc&limit=2").await;
    assert_eq!(titles(&descending.1), ["Bb song", "Major seventh"]);

    // Enharmonic spellings find each other; a compound key counts as its first.
    let sharp = get("/api/v1/songs?key=C%23&sort=title").await;
    assert_eq!(titles(&sharp.1), ["C# minor song", "Db song"]);
    let several = get("/api/v1/songs?key=G,%20D&sort=title").await;
    assert_eq!(titles(&several.1), ["Compound", "G song", "Gm song"]);
    let minor = get("/api/v1/songs?key=G,C%23&key_mode=minor&sort=title").await;
    assert_eq!(titles(&minor.1), ["C# minor song", "Gm song"]);
    let major = get("/api/v1/songs?key_mode=major&sort=key").await;
    assert_eq!(
        titles(&major.1),
        ["Db song", "Compound", "G song", "Major seventh", "Bb song"]
    );
    let searched = get("/api/v1/songs?key=G&q=minor").await;
    assert!(titles(&searched.1).is_empty());
    let unknown = get("/api/v1/songs?key=X").await;
    assert_eq!(unknown.0, StatusCode::OK);
    assert!(titles(&unknown.1).is_empty());
    let bad_mode = get("/api/v1/songs?key_mode=dorian").await;
    assert_eq!(bad_mode.0, StatusCode::BAD_REQUEST);

    let keys = get("/api/v1/songs/keys").await;
    assert_eq!(keys.0, StatusCode::OK);
    assert_eq!(
        keys.1,
        json!([
            { "root": 1, "minor": false, "songs": 1 },
            { "root": 1, "minor": true, "songs": 1 },
            { "root": 2, "minor": false, "songs": 1 },
            { "root": 7, "minor": false, "songs": 1 },
            { "root": 7, "minor": true, "songs": 1 },
            { "root": 9, "minor": false, "songs": 1 },
            { "root": 10, "minor": false, "songs": 1 }
        ])
    );
    let public_keys = send(&app, "GET", "/api/v1/public/songs/keys", None, None).await;
    assert_eq!(public_keys.1, json!([]));
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
    assert!(html.contains("<title>A song from Test Church</title>"));

    // A shared set's link names the set, its day, its church and its songs.
    let set = send(
        &app,
        "POST",
        "/api/v1/sets",
        Some(&owner),
        Some(json!({
            "name": "Kvelds",
            "service_date": "2026-10-18",
            "items": [{ "kind": "song", "song_id": song_id }, { "kind": "blank" }]
        })),
    )
    .await;
    let set_id = set.1["id"].as_str().unwrap().to_string();
    let key = send(
        &app,
        "PUT",
        &format!("/api/v1/sets/{set_id}/share"),
        Some(&owner),
        Some(json!({})),
    )
    .await
    .1["key"]
        .as_str()
        .unwrap()
        .to_string();
    let (status, html) = page(format!("/shared/{key}")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(html.contains("<title>Kvelds · Sunday 18 October 2026 · Test Church</title>"));
    assert!(html.contains("content=\"Test Church · 1 song: Amazing Grace\""));
    // A stopped or made-up link only loads the app, which says it is gone.
    let (status, html) = page("/shared/0123456789abcdef0123456789abcdef".into()).await;
    assert_eq!(status, StatusCode::OK);
    assert!(html.contains("<title>PSA150</title>"));

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
async fn shared_sets_flow(pool: PgPool) {
    let app = test_app(pool.clone());
    let (session, desktop) = owner_and_desktop(&app).await;
    let viewer = viewer_session(&app, &pool).await;
    let (grace, _) = create_song(&app, &session, "Amazing Grace").await;
    let (vision, _) = create_song(&app, &session, "Be Thou My Vision").await;
    let (other, _) = create_song(&app, &session, "Not In The Set").await;
    let created = send(
        &app,
        "POST",
        "/api/v1/sets",
        Some(&session),
        Some(json!({
            "name": "Sunday morning",
            "service_date": "2026-10-04",
            "items": [
                { "kind": "song", "song_id": grace, "transpose": 2, "note": "Capo 2" },
                { "kind": "blank" }
            ]
        })),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED);
    assert_eq!(created.1["shared"], false);
    let set_id = created.1["id"].as_str().expect("set id").to_string();
    let share_uri = format!("/api/v1/sets/{set_id}/share");

    // Not shared yet; only leaders and owners may share, never a desktop.
    assert_eq!(
        send(&app, "GET", &share_uri, Some(&session), None).await.0,
        StatusCode::NOT_FOUND
    );
    for token in [&viewer, &desktop] {
        let refused = send(
            &app,
            "PUT",
            &share_uri,
            Some(token),
            Some(json!({ "editable": false })),
        )
        .await;
        assert_eq!(refused.0, StatusCode::FORBIDDEN);
    }

    // A read-only link.
    let shared = send(&app, "PUT", &share_uri, Some(&session), Some(json!({}))).await;
    assert_eq!(shared.0, StatusCode::OK);
    assert_eq!(shared.1["editable"], false);
    let key = shared.1["key"].as_str().expect("key").to_string();
    assert_eq!(key.len(), 32);
    let detail = send(
        &app,
        "GET",
        &format!("/api/v1/sets/{set_id}"),
        Some(&viewer),
        None,
    )
    .await;
    assert_eq!(detail.1["shared"], true);
    let list = send(&app, "GET", "/api/v1/sets", Some(&viewer), None).await;
    assert_eq!(list.1[0]["shared"], true);
    // Viewers see that a set is shared, not its link.
    assert_eq!(
        send(&app, "GET", &share_uri, Some(&viewer), None).await.0,
        StatusCode::FORBIDDEN
    );

    // Anyone with the link reads the set and its songs, without a token.
    let public = format!("/api/v1/public/sets/{key}");
    let read = send(&app, "GET", &public, None, None).await;
    assert_eq!(read.0, StatusCode::OK);
    assert_eq!(read.1["name"], "Sunday morning");
    assert_eq!(read.1["church_name"], "Test Church");
    assert_eq!(read.1["editable"], false);
    assert_eq!(read.1["items"][0]["song"]["title"], "Amazing Grace");
    assert_eq!(read.1["items"][0]["transpose"], 2);
    assert_eq!(read.1["items"][1]["kind"], "blank");
    assert!(read.1.get("id").is_none());
    let song = send(&app, "GET", &format!("{public}/songs/{grace}"), None, None).await;
    assert_eq!(song.0, StatusCode::OK);
    assert!(
        song.1["chordpro"]
            .as_str()
            .unwrap()
            .contains("Amazing Grace")
    );
    // A read-only link opens only the set's own songs, and changes nothing.
    assert_eq!(
        send(&app, "GET", &format!("{public}/songs/{other}"), None, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(&app, "GET", &format!("{public}/songs"), None, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let add = send(
        &app,
        "POST",
        &format!("{public}/items"),
        None,
        Some(json!({ "song_id": vision })),
    )
    .await;
    assert_eq!(add.0, StatusCode::FORBIDDEN);
    // The church's songs and sets stay closed to the link.
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/api/v1/public/songs/{grace}"),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(&app, "GET", "/api/v1/sets", None, None).await.0,
        StatusCode::UNAUTHORIZED
    );

    // Made editable, the link keeps its key.
    let editable = send(
        &app,
        "PUT",
        &share_uri,
        Some(&session),
        Some(json!({ "editable": true })),
    )
    .await;
    assert_eq!(editable.0, StatusCode::OK);
    assert_eq!(editable.1["key"], key);
    assert_eq!(editable.1["editable"], true);

    // People with the link search the library and add songs.
    let found = send(&app, "GET", &format!("{public}/songs?q=vision"), None, None).await;
    assert_eq!(found.0, StatusCode::OK);
    assert_eq!(found.1.as_array().unwrap().len(), 1);
    assert_eq!(found.1[0]["title"], "Be Thou My Vision");
    let added = send(
        &app,
        "POST",
        &format!("{public}/items"),
        None,
        Some(json!({ "song_id": vision })),
    )
    .await;
    assert_eq!(added.0, StatusCode::OK);
    assert_eq!(added.1["version"], 2);
    assert_eq!(added.1["items"][2]["song"]["title"], "Be Thou My Vision");
    assert_eq!(added.1["items"][2]["transpose"], 0);
    // Existing items keep their id, transpose and note.
    assert_eq!(added.1["items"][0]["id"], read.1["items"][0]["id"]);
    assert_eq!(added.1["items"][0]["note"], "Capo 2");
    let first = send(
        &app,
        "POST",
        &format!("{public}/items"),
        None,
        Some(json!({ "song_id": other, "position": 0 })),
    )
    .await;
    assert_eq!(first.0, StatusCode::OK);
    assert_eq!(first.1["items"][0]["song"]["title"], "Not In The Set");
    assert_eq!(first.1["items"].as_array().unwrap().len(), 4);
    // Only songs of this library.
    let foreign = send(
        &app,
        "POST",
        &format!("{public}/items"),
        None,
        Some(json!({ "song_id": uuid::Uuid::new_v4() })),
    )
    .await;
    assert_eq!(foreign.0, StatusCode::BAD_REQUEST);

    // They remove songs, but not the blank screen.
    let blank = first.1["items"][2]["id"].as_str().unwrap().to_string();
    assert_eq!(first.1["items"][2]["kind"], "blank");
    assert_eq!(
        send(
            &app,
            "DELETE",
            &format!("{public}/items/{blank}"),
            None,
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let removed_id = first.1["items"][0]["id"].as_str().unwrap().to_string();
    let removed = send(
        &app,
        "DELETE",
        &format!("{public}/items/{removed_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(removed.0, StatusCode::OK);
    assert_eq!(removed.1["version"], 4);
    assert_eq!(removed.1["items"].as_array().unwrap().len(), 3);
    assert_eq!(
        send(
            &app,
            "DELETE",
            &format!("{public}/items/{removed_id}"),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );

    // The church sees the change as a new version; an edit based on the old
    // one is refused as usual.
    let church_view = send(
        &app,
        "GET",
        &format!("/api/v1/sets/{set_id}"),
        Some(&desktop),
        None,
    )
    .await;
    assert_eq!(church_view.1["version"], 4);
    assert_eq!(
        church_view.1["items"][2]["song"]["title"],
        "Be Thou My Vision"
    );
    let stale = send(
        &app,
        "PUT",
        &format!("/api/v1/sets/{set_id}"),
        Some(&session),
        Some(json!({
            "base_version": 1, "name": "Sunday morning", "service_date": null, "items": []
        })),
    )
    .await;
    assert_eq!(stale.0, StatusCode::CONFLICT);

    // A deleted set's link answers 404 and comes back with the set.
    let deleted = send(
        &app,
        "DELETE",
        &format!("/api/v1/sets/{set_id}"),
        Some(&session),
        None,
    )
    .await;
    assert_eq!(deleted.0, StatusCode::NO_CONTENT);
    assert_eq!(
        send(&app, "GET", &public, None, None).await.0,
        StatusCode::NOT_FOUND
    );
    let restored = send(
        &app,
        "POST",
        &format!("/api/v1/sets/{set_id}/restore"),
        Some(&session),
        None,
    )
    .await;
    assert_eq!(restored.0, StatusCode::OK);
    assert_eq!(
        send(&app, "GET", &public, None, None).await.0,
        StatusCode::OK
    );

    // Stopping the share ends the link; sharing again makes a new one.
    assert_eq!(
        send(&app, "DELETE", &share_uri, Some(&session), None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        send(&app, "GET", &public, None, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(&app, "GET", &format!("{public}/songs/{grace}"), None, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let again = send(&app, "PUT", &share_uri, Some(&session), Some(json!({}))).await;
    assert_ne!(again.1["key"], key);
    assert_eq!(again.1["editable"], false);
    // A key that could never have been made is turned away.
    assert_eq!(
        send(&app, "GET", "/api/v1/public/sets/not-a-key", None, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn leading_a_shared_set(pool: PgPool) {
    let app = test_app(pool.clone());
    let (session, desktop) = owner_and_desktop(&app).await;
    let viewer = viewer_session(&app, &pool).await;
    let (grace, _) = create_song(&app, &session, "Amazing Grace").await;
    let created = send(
        &app,
        "POST",
        "/api/v1/sets",
        Some(&session),
        Some(json!({
            "name": "Sunday morning",
            "items": [{ "kind": "song", "song_id": grace }, { "kind": "blank" }]
        })),
    )
    .await;
    let set_id = created.1["id"].as_str().unwrap().to_string();
    let first = created.1["items"][0]["id"].as_str().unwrap().to_string();
    let second = created.1["items"][1]["id"].as_str().unwrap().to_string();
    let live = format!("/api/v1/sets/{set_id}/live");
    let key = send(
        &app,
        "PUT",
        &format!("/api/v1/sets/{set_id}/share"),
        Some(&session),
        Some(json!({})),
    )
    .await
    .1["key"]
        .as_str()
        .unwrap()
        .to_string();

    let idle = send(&app, "GET", &live, Some(&viewer), None).await;
    assert_eq!(idle.0, StatusCode::OK);
    assert_eq!(idle.1["leading"], false);
    assert_eq!(idle.1["viewers"], 0);

    // A shared-link page opens the set: it counts, and hears nobody leads.
    let (status, mut events) = open_events(
        &app,
        &format!("/api/v1/public/sets/{key}/live/events"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (name, data) = next_event(&mut events).await;
    assert_eq!(name, "live");
    assert!(data["item_id"].is_null());
    assert_eq!(
        send(&app, "GET", &live, Some(&session), None).await.1["viewers"],
        1
    );

    // Only leaders and owners lead, and only with an item of the set.
    for token in [&viewer, &desktop] {
        let refused = send(
            &app,
            "PUT",
            &live,
            Some(token),
            Some(json!({ "item_id": first })),
        )
        .await;
        assert_eq!(refused.0, StatusCode::FORBIDDEN);
    }
    let stranger = send(
        &app,
        "PUT",
        &live,
        Some(&session),
        Some(json!({ "item_id": uuid::Uuid::new_v4() })),
    )
    .await;
    assert_eq!(stranger.0, StatusCode::BAD_REQUEST);

    // The leader moves; the page hears each move.
    let led = send(
        &app,
        "PUT",
        &live,
        Some(&session),
        Some(json!({ "item_id": first })),
    )
    .await;
    assert_eq!(led.0, StatusCode::OK);
    assert_eq!(led.1["leading"], true);
    assert_eq!(led.1["viewers"], 1);
    assert_eq!(led.1["leader_name"], "Test Owner");
    let (_, data) = next_event(&mut events).await;
    assert_eq!(data["item_id"], first);
    assert_eq!(data["leader_name"], "Test Owner");
    send(
        &app,
        "PUT",
        &live,
        Some(&session),
        Some(json!({ "item_id": second })),
    )
    .await;
    let (_, data) = next_event(&mut events).await;
    assert_eq!(data["item_id"], second);
    // Viewers see who leads too.
    let watched = send(&app, "GET", &live, Some(&viewer), None).await;
    assert_eq!(watched.1["item_id"], second);

    // Stopping leaves the page where it is and says nobody leads.
    assert_eq!(
        send(&app, "DELETE", &live, Some(&session), None).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, data) = next_event(&mut events).await;
    assert!(data["item_id"].is_null());

    // A closed page stops counting.
    drop(events);
    tokio::task::yield_now().await;
    assert_eq!(
        send(&app, "GET", &live, Some(&session), None).await.1["viewers"],
        0
    );

    // Unknown links, and other churches' or unknown sets, are 404.
    let (status, _) = open_events(&app, "/api/v1/public/sets/not-a-key/live/events", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let unknown = format!("/api/v1/sets/{}/live", uuid::Uuid::new_v4());
    assert_eq!(
        send(&app, "GET", &unknown, Some(&session), None).await.0,
        StatusCode::NOT_FOUND
    );
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

#[sqlx::test(migrations = "./migrations")]
async fn rooms_flow(pool: PgPool) {
    let app = test_app(pool.clone());
    let (session, desktop) = owner_and_desktop(&app).await;

    // Every desktop has a room, a flower by default.
    let room = send(&app, "GET", "/api/v1/remote/desktop", Some(&desktop), None).await;
    assert_eq!(room.0, StatusCode::OK);
    let flower = room.1["room_name"].as_str().expect("room name").to_string();
    assert!(psa150_server::rooms::FLOWERS.contains(&flower.as_str()));
    assert_eq!(room.1["public_rooms"], true);
    let people_only = send(&app, "GET", "/api/v1/remote/desktop", Some(&session), None).await;
    assert_eq!(people_only.0, StatusCode::FORBIDDEN);

    // A second desktop never gets the same name.
    let second = send(
        &app,
        "POST",
        "/api/v1/device-tokens",
        Some(&session),
        Some(json!({ "name": "Youth room PC" })),
    )
    .await;
    assert_eq!(second.0, StatusCode::CREATED);
    let second_id = second.1["id"].as_str().expect("id").to_string();
    let second_token = second.1["token"].as_str().expect("token").to_string();
    assert_ne!(second.1["room_name"], flower.as_str());

    // The operator renames the room; names are matched loosely and unique.
    let renamed = send(
        &app,
        "PUT",
        "/api/v1/remote/desktop/room",
        Some(&desktop),
        Some(json!({ "room_name": "  Main   Hall " })),
    )
    .await;
    assert_eq!(renamed.0, StatusCode::OK);
    assert_eq!(renamed.1["room_name"], "Main Hall");
    let clash = send(
        &app,
        "PUT",
        "/api/v1/remote/desktop/room",
        Some(&second_token),
        Some(json!({ "room_name": "main-hall" })),
    )
    .await;
    assert_eq!(clash.0, StatusCode::CONFLICT);
    let invalid = send(
        &app,
        "PUT",
        "/api/v1/remote/desktop/room",
        Some(&second_token),
        Some(json!({ "room_name": "<b>" })),
    )
    .await;
    assert_eq!(invalid.0, StatusCode::BAD_REQUEST);

    // Leaders rename any of the church's desktops; viewers do not.
    let leader_rename = send(
        &app,
        "PUT",
        &format!("/api/v1/device-tokens/{second_id}/room"),
        Some(&session),
        Some(json!({ "room_name": "Youth" })),
    )
    .await;
    assert_eq!(leader_rename.0, StatusCode::OK);
    assert_eq!(leader_rename.1["room_name"], "Youth");
    let viewer = viewer_session(&app, &pool).await;
    let viewer_rename = send(
        &app,
        "PUT",
        &format!("/api/v1/device-tokens/{second_id}/room"),
        Some(&viewer),
        Some(json!({ "room_name": null })),
    )
    .await;
    assert_eq!(viewer_rename.0, StatusCode::FORBIDDEN);
    let tokens = send(&app, "GET", "/api/v1/device-tokens", Some(&session), None).await;
    let names = tokens.1.as_array().expect("tokens");
    assert!(names.iter().any(|token| token["room_name"] == "Youth"));

    // Anyone may look into a room. Before the desktop reports, it is offline.
    let offline = send(&app, "GET", "/api/v1/public/rooms/main%20hall", None, None).await;
    assert_eq!(offline.0, StatusCode::OK);
    assert_eq!(offline.1["room_name"], "Main Hall");
    assert_eq!(offline.1["status"], "offline");
    let unknown = send(&app, "GET", "/api/v1/public/rooms/nowhere", None, None).await;
    assert_eq!(unknown.0, StatusCode::NOT_FOUND);

    let projecting = json!({
        "accepts_commands": true,
        "projecting": true,
        "shares_room": true,
        "song_title": "Amazing Grace",
        "slide_index": 0,
        "slide_labels": ["Verse 1", "Verse 2"],
        "slides": [
            { "label": "Verse 1", "lines": ["Amazing grace, how sweet the sound", "That saved a wretch like me"] },
            { "label": "Verse 2", "lines": ["'Twas grace that taught my heart to fear"] }
        ]
    });
    report(&app, &desktop, projecting.clone()).await;
    let live = send(&app, "GET", "/api/v1/public/rooms/MAINHALL", None, None).await;
    assert_eq!(live.1["status"], "live");
    assert_eq!(live.1["song_title"], "Amazing Grace");
    assert_eq!(live.1["slide_index"], 0);
    assert_eq!(
        live.1["slides"][1]["lines"][0],
        "'Twas grace that taught my heart to fear"
    );

    // Leaders pick desktops by their room names.
    let listed = send(&app, "GET", "/api/v1/remote/desktops", Some(&session), None).await;
    assert_eq!(listed.1[0]["room_name"], "Main Hall");
    assert_eq!(listed.1[0]["name"], "Sanctuary PC");

    // The room follows the projection as it happens.
    let (status, mut events) =
        open_events(&app, "/api/v1/public/rooms/main-hall/events", None).await;
    assert_eq!(status, StatusCode::OK);
    let (name, first) = next_event(&mut events).await;
    assert_eq!(name, "room");
    assert_eq!(first["slide_index"], 0);
    let mut next_slide = projecting.clone();
    next_slide["slide_index"] = json!(1);
    report(&app, &desktop, next_slide.clone()).await;
    let (_, moved) = next_event(&mut events).await;
    assert_eq!(moved["slide_index"], 1);
    let mut blanked = next_slide.clone();
    blanked["blanked"] = json!(true);
    report(&app, &desktop, blanked).await;
    let (_, blank) = next_event(&mut events).await;
    assert_eq!(blank["status"], "blank");

    // The operator can stop sharing: the room stays but shows no words.
    let mut private = next_slide.clone();
    private["shares_room"] = json!(false);
    report(&app, &desktop, private).await;
    let (_, idle) = next_event(&mut events).await;
    assert_eq!(idle["status"], "idle");
    assert_eq!(idle["slides"], json!([]));
    assert_eq!(idle["song_title"], Value::Null);
    report(&app, &desktop, next_slide).await;
    let (_, back) = next_event(&mut events).await;
    assert_eq!(back["status"], "live");

    // Leaders' phones get the desktop list pushed too.
    let (status, mut desktops) =
        open_events(&app, "/api/v1/remote/desktops/events", Some(&session)).await;
    assert_eq!(status, StatusCode::OK);
    let (name, list) = next_event(&mut desktops).await;
    assert_eq!(name, "desktops");
    assert_eq!(list[0]["state"]["slide_index"], 1);
    let (status, _) = open_events(&app, "/api/v1/remote/desktops/events", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // An owner can close the church's rooms.
    let closed = send(
        &app,
        "PUT",
        "/api/v1/church",
        Some(&session),
        Some(json!({ "public_rooms": false })),
    )
    .await;
    assert_eq!(closed.0, StatusCode::OK);
    assert_eq!(closed.1["public_rooms"], false);
    let (_, shut) = next_event(&mut events).await;
    assert_eq!(shut["status"], "idle");
    let gone = send(&app, "GET", "/api/v1/public/rooms/main%20hall", None, None).await;
    assert_eq!(gone.0, StatusCode::NOT_FOUND);
    let info = send(&app, "GET", "/api/v1/info", None, None).await;
    assert_eq!(info.1["rooms"], false);
    let not_owner = send(
        &app,
        "PUT",
        "/api/v1/church",
        Some(&viewer),
        Some(json!({ "public_rooms": true })),
    )
    .await;
    assert_eq!(not_owner.0, StatusCode::FORBIDDEN);
    send(
        &app,
        "PUT",
        "/api/v1/church",
        Some(&session),
        Some(json!({ "public_rooms": true })),
    )
    .await;

    // Revoking a desktop frees its name.
    let first_id = listed.1[0]["device_id"].as_str().expect("id").to_string();
    let revoked = send(
        &app,
        "DELETE",
        &format!("/api/v1/device-tokens/{first_id}"),
        Some(&session),
        None,
    )
    .await;
    assert_eq!(revoked.0, StatusCode::NO_CONTENT);
    let freed = send(&app, "GET", "/api/v1/public/rooms/main%20hall", None, None).await;
    assert_eq!(freed.0, StatusCode::NOT_FOUND);
    let taken_over = send(
        &app,
        "PUT",
        "/api/v1/remote/desktop/room",
        Some(&second_token),
        Some(json!({ "room_name": "Main Hall" })),
    )
    .await;
    assert_eq!(taken_over.0, StatusCode::OK);
}

#[sqlx::test(migrations = "./migrations")]
async fn desktops_made_before_rooms_get_one(pool: PgPool) {
    let app = test_app(pool.clone());
    let (_, desktop) = owner_and_desktop(&app).await;
    sqlx::query("UPDATE device_tokens SET room_name = NULL, room_key = NULL")
        .execute(&pool)
        .await
        .expect("forget room");
    report(&app, &desktop, json!({ "accepts_commands": true })).await;
    let room = sqlx::query_scalar::<_, Option<String>>("SELECT room_name FROM device_tokens")
        .fetch_one(&pool)
        .await
        .expect("room");
    assert!(room.is_some_and(|room| psa150_server::rooms::FLOWERS.contains(&room.as_str())));
}

async fn report(app: &Router, desktop: &str, state: Value) {
    let reported = send(
        app,
        "PUT",
        "/api/v1/remote/desktop",
        Some(desktop),
        Some(state),
    )
    .await;
    assert_eq!(reported.0, StatusCode::NO_CONTENT);
}

type EventBody = axum::body::BodyDataStream;

async fn open_events(app: &Router, uri: &str, token: Option<&str>) -> (StatusCode, EventBody) {
    let mut builder = Request::builder().method("GET").uri(uri);
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let response = app
        .clone()
        .oneshot(builder.body(Body::empty()).expect("request"))
        .await
        .expect("response");
    (response.status(), response.into_body().into_data_stream())
}

/// The next server-sent event's name and JSON data, skipping keep-alives.
async fn next_event(events: &mut EventBody) -> (String, Value) {
    use futures_util::StreamExt;
    let mut text = String::new();
    loop {
        if let Some(end) = text.find("\n\n") {
            let block = text[..end].to_string();
            text.drain(..end + 2);
            let mut name = String::new();
            let mut data = String::new();
            for line in block.lines() {
                if let Some(value) = line.strip_prefix("event:") {
                    name = value.trim().to_string();
                } else if let Some(value) = line.strip_prefix("data:") {
                    data.push_str(value.trim_start());
                }
            }
            if !data.is_empty() {
                return (name, serde_json::from_str(&data).expect("event json"));
            }
            continue;
        }
        let chunk = tokio::time::timeout(std::time::Duration::from_secs(5), events.next())
            .await
            .expect("an event within five seconds")
            .expect("stream open")
            .expect("chunk");
        text.push_str(std::str::from_utf8(&chunk).expect("utf-8"));
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn api_tokens_act_as_their_person(pool: PgPool) {
    let app = test_app(pool.clone());
    let (owner, desktop) = owner_and_desktop(&app).await;

    // Any token says whose it is and what it may do.
    let me = send(&app, "GET", "/api/v1/session", Some(&owner), None).await;
    assert_eq!(me.0, StatusCode::OK);
    assert_eq!(me.1["kind"], "session");
    assert_eq!(me.1["role"], "owner");
    assert_eq!(me.1["username"], "owner");
    assert_eq!(me.1["display_name"], "Test Owner");
    assert_eq!(me.1["church_name"], "Test Church");
    assert!(me.1["expires_at"].is_string());
    let desk = send(&app, "GET", "/api/v1/session", Some(&desktop), None).await;
    assert_eq!(desk.1["kind"], "desktop");
    assert_eq!(desk.1["role"], Value::Null);
    assert_eq!(desk.1["device_name"], "Sanctuary PC");

    // An API token takes its person's role unless made with less, and lasts
    // until it is revoked.
    let made = send(
        &app,
        "POST",
        "/api/v1/api-tokens",
        Some(&owner),
        Some(json!({ "name": "  Automation " })),
    )
    .await;
    assert_eq!(made.0, StatusCode::CREATED);
    assert_eq!(made.1["name"], "Automation");
    assert_eq!(made.1["role"], "owner");
    assert_eq!(made.1["expires_at"], Value::Null);
    let automation = made.1["token"].as_str().expect("token").to_string();
    assert!(automation.starts_with("psa_a_"));
    let me = send(&app, "GET", "/api/v1/session", Some(&automation), None).await;
    assert_eq!(me.1["kind"], "api");
    assert_eq!(me.1["role"], "owner");
    assert_eq!(me.1["username"], "owner");
    assert_eq!(me.1["expires_at"], Value::Null);

    // It does whatever its person can, owner work included.
    let renamed = send(
        &app,
        "PUT",
        "/api/v1/church",
        Some(&automation),
        Some(json!({ "name": " Grace Chapel " })),
    )
    .await;
    assert_eq!(renamed.0, StatusCode::OK);
    assert_eq!(renamed.1["name"], "Grace Chapel");
    assert_eq!(renamed.1["public_library"], false);
    let blank = send(
        &app,
        "PUT",
        "/api/v1/church",
        Some(&automation),
        Some(json!({ "name": "  " })),
    )
    .await;
    assert_eq!(blank.0, StatusCode::BAD_REQUEST);
    let device = send(
        &app,
        "POST",
        "/api/v1/device-tokens",
        Some(&automation),
        Some(json!({ "name": "Lobby PC" })),
    )
    .await;
    assert_eq!(device.0, StatusCode::CREATED);
    add_member(&app, &automation, "lea", "Lea Leader", "leader").await;
    let (song_id, _) = create_song(&app, &automation, "Amazing Grace").await;

    // A read-only token reads, but cannot write or give itself more.
    let website = send(
        &app,
        "POST",
        "/api/v1/api-tokens",
        Some(&owner),
        Some(json!({ "name": "Church website", "role": "viewer" })),
    )
    .await;
    assert_eq!(website.0, StatusCode::CREATED);
    assert_eq!(website.1["role"], "viewer");
    let website = website.1["token"].as_str().expect("token").to_string();
    let read = send(
        &app,
        "GET",
        &format!("/api/v1/songs/{song_id}"),
        Some(&website),
        None,
    )
    .await;
    assert_eq!(read.0, StatusCode::OK);
    for (method, uri, body) in [
        (
            "POST",
            "/api/v1/songs",
            json!({ "chordpro": "{title: Spam}" }),
        ),
        ("PUT", "/api/v1/church", json!({ "public_library": true })),
        (
            "POST",
            "/api/v1/device-tokens",
            json!({ "name": "Rogue PC" }),
        ),
        ("GET", "/api/v1/members", Value::Null),
    ] {
        let body = (!body.is_null()).then_some(body);
        let denied = send(&app, method, uri, Some(&website), body).await;
        assert_eq!(denied.0, StatusCode::FORBIDDEN, "{method} {uri}");
    }
    let more = send(
        &app,
        "POST",
        "/api/v1/api-tokens",
        Some(&website),
        Some(json!({ "name": "Escalate", "role": "leader" })),
    )
    .await;
    assert_eq!(more.0, StatusCode::BAD_REQUEST);
    let copy = send(
        &app,
        "POST",
        "/api/v1/api-tokens",
        Some(&website),
        Some(json!({ "name": "Copy" })),
    )
    .await;
    assert_eq!(copy.0, StatusCode::CREATED);
    assert_eq!(copy.1["role"], "viewer");

    // A token that runs out cannot make one that lasts longer.
    let expires_at = (chrono::Utc::now() + chrono::Duration::hours(1))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let short = send(
        &app,
        "POST",
        "/api/v1/api-tokens",
        Some(&owner),
        Some(json!({ "name": "One hour", "expires_at": expires_at })),
    )
    .await;
    let short_expiry = short.1["expires_at"].clone();
    let mut made_ids = vec![short.1["id"].as_str().expect("id").to_string()];
    let short = short.1["token"].as_str().expect("token").to_string();
    for body in [
        json!({ "name": "Forever" }),
        json!({ "name": "Next year", "expires_at": "2099-01-01T00:00:00Z" }),
    ] {
        let child = send(&app, "POST", "/api/v1/api-tokens", Some(&short), Some(body)).await;
        assert_eq!(child.0, StatusCode::CREATED);
        assert_eq!(child.1["expires_at"], short_expiry);
        made_ids.push(child.1["id"].as_str().expect("id").to_string());
    }
    for id in made_ids {
        let revoked = send(
            &app,
            "DELETE",
            &format!("/api/v1/api-tokens/{id}"),
            Some(&owner),
            None,
        )
        .await;
        assert_eq!(revoked.0, StatusCode::NO_CONTENT);
    }

    // Desktops are not people and make no API tokens.
    let refused = send(
        &app,
        "POST",
        "/api/v1/api-tokens",
        Some(&desktop),
        Some(json!({ "name": "Desk" })),
    )
    .await;
    assert_eq!(refused.0, StatusCode::FORBIDDEN);
    let refused = send(&app, "GET", "/api/v1/api-tokens", Some(&desktop), None).await;
    assert_eq!(refused.0, StatusCode::FORBIDDEN);

    // People see their own tokens; owners see and revoke everyone's.
    let lea = sign_in(&app, "lea", MEMBER_PASSWORD).await;
    let lea_token = make_api_token(&app, &lea, "Lea's script").await;
    let mine = send(&app, "GET", "/api/v1/api-tokens", Some(&lea), None).await;
    assert_eq!(names(&mine.1), ["Lea's script"]);
    let all = send(&app, "GET", "/api/v1/api-tokens", Some(&owner), None).await;
    assert_eq!(
        names(&all.1),
        ["Automation", "Church website", "Copy", "Lea's script"]
    );
    assert_eq!(all.1[3]["user_display_name"], "Lea Leader");
    let automation_id = all.1[0]["id"].as_str().expect("id").to_string();
    let lea_token_id = all.1[3]["id"].as_str().expect("id").to_string();
    let not_hers = send(
        &app,
        "DELETE",
        &format!("/api/v1/api-tokens/{automation_id}"),
        Some(&lea),
        None,
    )
    .await;
    assert_eq!(not_hers.0, StatusCode::NOT_FOUND);
    let revoked = send(
        &app,
        "DELETE",
        &format!("/api/v1/api-tokens/{lea_token_id}"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(revoked.0, StatusCode::NO_CONTENT);
    let after = send(&app, "GET", "/api/v1/songs", Some(&lea_token), None).await;
    assert_eq!(after.0, StatusCode::UNAUTHORIZED);

    // A token past its expiry stops working; an expiry in the past is refused.
    let past = send(
        &app,
        "POST",
        "/api/v1/api-tokens",
        Some(&owner),
        Some(json!({ "name": "Old", "expires_at": "2020-01-01T00:00:00Z" })),
    )
    .await;
    assert_eq!(past.0, StatusCode::BAD_REQUEST);
    let soon = send(
        &app,
        "POST",
        "/api/v1/api-tokens",
        Some(&owner),
        Some(json!({ "name": "Soon", "expires_at": "2999-01-01T00:00:00Z" })),
    )
    .await;
    assert_eq!(soon.0, StatusCode::CREATED);
    assert!(soon.1["expires_at"].is_string());
    let soon_token = soon.1["token"].as_str().expect("token").to_string();
    assert_eq!(
        send(&app, "GET", "/api/v1/songs", Some(&soon_token), None)
            .await
            .0,
        StatusCode::OK
    );
    sqlx::query(
        "UPDATE api_tokens SET expires_at = now() - interval '1 minute' WHERE name = 'Soon'",
    )
    .execute(&pool)
    .await
    .expect("expire");
    let expired = send(&app, "GET", "/api/v1/songs", Some(&soon_token), None).await;
    assert_eq!(expired.0, StatusCode::UNAUTHORIZED);

    // Signing out ends the token that signs out, whatever its kind, and
    // nothing else.
    for token in [&automation, &desktop, &owner] {
        let out = send(&app, "DELETE", "/api/v1/session", Some(token), None).await;
        assert_eq!(out.0, StatusCode::NO_CONTENT);
        let after = send(&app, "GET", "/api/v1/songs", Some(token), None).await;
        assert_eq!(after.0, StatusCode::UNAUTHORIZED);
    }
    let still = send(&app, "GET", "/api/v1/songs", Some(&website), None).await;
    assert_eq!(still.0, StatusCode::OK);
}

#[sqlx::test(migrations = "./migrations")]
async fn owners_manage_members(pool: PgPool) {
    let app = test_app(pool.clone());
    let (owner, desktop) = owner_and_desktop(&app).await;
    let owner_id = send(&app, "GET", "/api/v1/session", Some(&owner), None)
        .await
        .1["user_id"]
        .as_str()
        .expect("owner id")
        .to_string();

    let lea_id = add_member(&app, &owner, "lea", "Lea Leader", "leader").await;
    let vic_id = add_member(&app, &owner, " vic ", "Vic Viewer", "viewer").await;
    for (body, status) in [
        (
            json!({ "username": "LEA", "display_name": "Another", "password": MEMBER_PASSWORD, "role": "viewer" }),
            StatusCode::CONFLICT,
        ),
        (
            json!({ "username": "sam", "display_name": "Sam", "password": "short", "role": "viewer" }),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({ "username": "sam", "display_name": "  ", "password": MEMBER_PASSWORD, "role": "viewer" }),
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let refused = send(&app, "POST", "/api/v1/members", Some(&owner), Some(body)).await;
        assert_eq!(refused.0, status);
    }
    let members = send(&app, "GET", "/api/v1/members", Some(&owner), None).await;
    assert_eq!(members.0, StatusCode::OK);
    let usernames = members
        .1
        .as_array()
        .expect("members")
        .iter()
        .map(|member| member["username"].as_str().expect("username"))
        .collect::<Vec<_>>();
    assert_eq!(usernames, ["lea", "owner", "vic"]);

    // Only owners run the church.
    let lea = sign_in(&app, "lea", MEMBER_PASSWORD).await;
    let vic = sign_in(&app, "vic", MEMBER_PASSWORD).await;
    for token in [&lea, &vic, &desktop] {
        let denied = send(&app, "GET", "/api/v1/members", Some(token), None).await;
        assert_eq!(denied.0, StatusCode::FORBIDDEN);
    }
    let denied = send(
        &app,
        "PATCH",
        &format!("/api/v1/members/{vic_id}"),
        Some(&lea),
        Some(json!({ "role": "owner" })),
    )
    .await;
    assert_eq!(denied.0, StatusCode::FORBIDDEN);

    // A new role applies at once to the person's sessions and API tokens.
    let lea_token = make_api_token(&app, &lea, "Lea's script").await;
    let demoted = patch_member(&app, &owner, &lea_id, json!({ "role": "viewer" })).await;
    assert_eq!(demoted.1["role"], "viewer");
    let me = send(&app, "GET", "/api/v1/session", Some(&lea_token), None).await;
    assert_eq!(me.1["role"], "viewer");
    let write = send(
        &app,
        "POST",
        "/api/v1/songs",
        Some(&lea_token),
        Some(json!({ "chordpro": "{title: Not now}" })),
    )
    .await;
    assert_eq!(write.0, StatusCode::FORBIDDEN);
    patch_member(&app, &owner, &lea_id, json!({ "role": "leader" })).await;
    create_song(&app, &lea_token, "Be Thou My Vision").await;

    // An owner's password reset signs the person out; API tokens stay.
    let reset = patch_member(
        &app,
        &owner,
        &lea_id,
        json!({ "password": "a-brand-new-password" }),
    )
    .await;
    assert_eq!(reset.0, StatusCode::OK);
    let old = send(&app, "GET", "/api/v1/songs", Some(&lea), None).await;
    assert_eq!(old.0, StatusCode::UNAUTHORIZED);
    sign_in(&app, "lea", "a-brand-new-password").await;
    let kept = send(&app, "GET", "/api/v1/songs", Some(&lea_token), None).await;
    assert_eq!(kept.0, StatusCode::OK);

    // Disabling locks the person out and revokes their API tokens for good.
    let vic_token = make_api_token(&app, &vic, "Vic's reader").await;
    let disabled = patch_member(&app, &owner, &vic_id, json!({ "disabled": true })).await;
    assert_eq!(disabled.1["disabled"], true);
    for token in [&vic, &vic_token] {
        let locked = send(&app, "GET", "/api/v1/songs", Some(token), None).await;
        assert_eq!(locked.0, StatusCode::UNAUTHORIZED);
    }
    assert_eq!(
        try_sign_in(&app, "vic", MEMBER_PASSWORD).await,
        StatusCode::UNAUTHORIZED
    );
    let enabled = patch_member(&app, &owner, &vic_id, json!({ "disabled": false })).await;
    assert_eq!(enabled.1["disabled"], false);
    sign_in(&app, "vic", MEMBER_PASSWORD).await;
    let still_revoked = send(&app, "GET", "/api/v1/songs", Some(&vic_token), None).await;
    assert_eq!(still_revoked.0, StatusCode::UNAUTHORIZED);

    // Account details, with usernames unique regardless of case.
    let renamed = patch_member(
        &app,
        &owner,
        &vic_id,
        json!({ "display_name": "Victoria", "username": "victoria" }),
    )
    .await;
    assert_eq!(renamed.1["display_name"], "Victoria");
    assert_eq!(renamed.1["username"], "victoria");
    let taken = patch_member(&app, &owner, &vic_id, json!({ "username": "LEA" })).await;
    assert_eq!(taken.0, StatusCode::CONFLICT);
    let unknown = patch_member(
        &app,
        &owner,
        &uuid::Uuid::new_v4().to_string(),
        json!({ "role": "viewer" }),
    )
    .await;
    assert_eq!(unknown.0, StatusCode::NOT_FOUND);

    // An owner's own password needs the current one, so not here.
    let own = patch_member(
        &app,
        &owner,
        &owner_id,
        json!({ "password": "taken-over-pass" }),
    )
    .await;
    assert_eq!(own.0, StatusCode::FORBIDDEN);
    assert_eq!(
        try_sign_in(&app, "owner", "long-test-password").await,
        StatusCode::OK
    );

    // The church always keeps an owner who is not disabled.
    for body in [json!({ "role": "leader" }), json!({ "disabled": true })] {
        let last = patch_member(&app, &owner, &owner_id, body).await;
        assert_eq!(last.0, StatusCode::CONFLICT);
    }
    let last = send(
        &app,
        "DELETE",
        &format!("/api/v1/members/{owner_id}"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(last.0, StatusCode::CONFLICT);
    patch_member(&app, &owner, &lea_id, json!({ "role": "owner" })).await;
    let stepped_down = patch_member(&app, &owner, &owner_id, json!({ "role": "leader" })).await;
    assert_eq!(stepped_down.1["role"], "leader");
    let no_longer = send(&app, "GET", "/api/v1/members", Some(&owner), None).await;
    assert_eq!(no_longer.0, StatusCode::FORBIDDEN);
    let lea = sign_in(&app, "lea", "a-brand-new-password").await;

    // Someone who also belongs to another church: only their role here
    // changes, and removing them leaves their account to the other church.
    let other_church = uuid::Uuid::new_v4();
    sqlx::query("INSERT INTO churches (id, name, slug) VALUES ($1, 'Other Church', 'other')")
        .bind(other_church)
        .execute(&pool)
        .await
        .expect("church");
    sqlx::query(
        "INSERT INTO memberships (user_id, church_id, role)
         SELECT id, $1, 'owner' FROM users WHERE username = 'owner'",
    )
    .bind(other_church)
    .execute(&pool)
    .await
    .expect("membership");
    let theirs = patch_member(&app, &lea, &owner_id, json!({ "display_name": "Renamed" })).await;
    assert_eq!(theirs.0, StatusCode::FORBIDDEN);
    let theirs = patch_member(
        &app,
        &lea,
        &owner_id,
        json!({ "password": "taken-over-pass" }),
    )
    .await;
    assert_eq!(theirs.0, StatusCode::FORBIDDEN);
    let role = patch_member(&app, &lea, &owner_id, json!({ "role": "viewer" })).await;
    assert_eq!(role.1["role"], "viewer");
    let removed = send(
        &app,
        "DELETE",
        &format!("/api/v1/members/{owner_id}"),
        Some(&lea),
        None,
    )
    .await;
    assert_eq!(removed.0, StatusCode::NO_CONTENT);
    assert_eq!(
        try_sign_in(&app, "owner", "long-test-password").await,
        StatusCode::OK
    );
    let elsewhere = send(&app, "GET", "/api/v1/session", Some(&owner), None).await;
    assert_eq!(elsewhere.0, StatusCode::UNAUTHORIZED);

    // Removing someone in no other church keeps their account, disabled and
    // without a username, so the name can be used again.
    let removed = send(
        &app,
        "DELETE",
        &format!("/api/v1/members/{vic_id}"),
        Some(&lea),
        None,
    )
    .await;
    assert_eq!(removed.0, StatusCode::NO_CONTENT);
    assert_eq!(
        try_sign_in(&app, "victoria", MEMBER_PASSWORD).await,
        StatusCode::UNAUTHORIZED
    );
    let members = send(&app, "GET", "/api/v1/members", Some(&lea), None).await;
    assert_eq!(members.1.as_array().map(Vec::len), Some(1));
    let again = send(
        &app,
        "DELETE",
        &format!("/api/v1/members/{vic_id}"),
        Some(&lea),
        None,
    )
    .await;
    assert_eq!(again.0, StatusCode::NOT_FOUND);
    let (username, disabled, display_name) = sqlx::query_as::<_, (Option<String>, bool, String)>(
        "SELECT username, disabled_at IS NOT NULL, display_name FROM users WHERE id = $1",
    )
    .bind(uuid::Uuid::parse_str(&vic_id).expect("id"))
    .fetch_one(&pool)
    .await
    .expect("removed account");
    assert_eq!(
        (username, disabled, display_name.as_str()),
        (None, true, "Victoria")
    );
    let reused = add_member(&app, &lea, "Victoria", "Another Victoria", "viewer").await;
    assert_ne!(reused, vic_id);
    sign_in(&app, "victoria", MEMBER_PASSWORD).await;
}

#[sqlx::test(migrations = "./migrations")]
async fn people_change_passwords_and_choose_a_church(pool: PgPool) {
    let app = test_app(pool.clone());
    let (owner, desktop) = owner_and_desktop(&app).await;
    let elsewhere = sign_in(&app, "owner", "long-test-password").await;
    let script = make_api_token(&app, &owner, "Script").await;
    let change = |token: String, current: &'static str, new: &'static str| {
        let app = app.clone();
        async move {
            send(
                &app,
                "PUT",
                "/api/v1/account/password",
                Some(&token),
                Some(json!({ "current_password": current, "new_password": new })),
            )
            .await
            .0
        }
    };

    assert_eq!(
        change(owner.clone(), "wrong-password", "another-long-password").await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        change(owner.clone(), "long-test-password", "short").await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        change(
            desktop.clone(),
            "long-test-password",
            "another-long-password"
        )
        .await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        change(owner.clone(), "long-test-password", "another-long-password").await,
        StatusCode::NO_CONTENT
    );

    // This session and API tokens go on; the person's other sessions end.
    for (token, status) in [
        (&owner, StatusCode::OK),
        (&script, StatusCode::OK),
        (&elsewhere, StatusCode::UNAUTHORIZED),
    ] {
        assert_eq!(
            send(&app, "GET", "/api/v1/songs", Some(token), None)
                .await
                .0,
            status
        );
    }
    assert_eq!(
        try_sign_in(&app, "owner", "long-test-password").await,
        StatusCode::UNAUTHORIZED
    );
    sign_in(&app, "owner", "another-long-password").await;

    // A person in several churches picks one; without a choice, the first.
    let second = uuid::Uuid::new_v4();
    sqlx::query("INSERT INTO churches (id, name, slug) VALUES ($1, 'Second Church', 'second')")
        .bind(second)
        .execute(&pool)
        .await
        .expect("church");
    sqlx::query(
        "INSERT INTO memberships (user_id, church_id, role)
         SELECT id, $1, 'leader' FROM users WHERE username = 'owner'",
    )
    .bind(second)
    .execute(&pool)
    .await
    .expect("membership");
    let default = send(
        &app,
        "POST",
        "/api/v1/session",
        None,
        Some(json!({ "username": "owner", "password": "another-long-password" })),
    )
    .await;
    assert_eq!(default.1["church_name"], "Test Church");
    let chosen = send(
        &app,
        "POST",
        "/api/v1/session",
        None,
        Some(json!({ "username": "owner", "password": "another-long-password", "church_id": second })),
    )
    .await;
    assert_eq!(chosen.0, StatusCode::OK);
    assert_eq!(chosen.1["church_name"], "Second Church");
    assert_eq!(chosen.1["role"], "leader");
    let unknown = send(
        &app,
        "POST",
        "/api/v1/session",
        None,
        Some(json!({ "username": "owner", "password": "another-long-password", "church_id": uuid::Uuid::new_v4() })),
    )
    .await;
    assert_eq!(unknown.0, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn deleted_songs_and_sets_come_back(pool: PgPool) {
    let app = test_app(pool.clone());
    let (owner, desktop) = owner_and_desktop(&app).await;
    let viewer = viewer_session(&app, &pool).await;
    let (song, first) = create_song(&app, &owner, "Amazing Grace").await;
    let (other, other_revision) = create_song(&app, &owner, "Be Thou My Vision").await;
    let edited = send(
        &app,
        "PUT",
        &format!("/api/v1/songs/{song}"),
        Some(&owner),
        Some(json!({ "base_revision_id": first, "chordpro": "{title: Amazing Grace}\n\n[D]How sweet" })),
    )
    .await;
    assert_eq!(edited.0, StatusCode::OK);
    let second = edited.1["revision_id"]
        .as_str()
        .expect("revision")
        .to_string();

    // Any earlier revision can be read in full.
    let old = send(
        &app,
        "GET",
        &format!("/api/v1/songs/{song}/revisions/{first}"),
        Some(&viewer),
        None,
    )
    .await;
    assert_eq!(old.0, StatusCode::OK);
    assert_eq!(old.1["id"], first);
    assert_eq!(old.1["song_id"], song);
    // Created without a number, so it got the first one.
    assert_eq!(
        old.1["chordpro"],
        "{title: Amazing Grace}\n{meta: song_num=1}\n\n[G]Words"
    );
    assert_eq!(old.1["parent_revision_id"], Value::Null);
    for uri in [
        format!("/api/v1/songs/{song}/revisions/{}", uuid::Uuid::new_v4()),
        format!("/api/v1/songs/{song}/revisions/{other_revision}"),
        format!("/api/v1/songs/{other}/revisions/{first}"),
    ] {
        let missing = send(&app, "GET", &uri, Some(&viewer), None).await;
        assert_eq!(missing.0, StatusCode::NOT_FOUND, "{uri}");
    }

    // A deleted song is listed until someone restores it, with its history.
    let deleted = send(
        &app,
        "DELETE",
        &format!("/api/v1/songs/{song}"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(deleted.0, StatusCode::NO_CONTENT);
    let trash = send(&app, "GET", "/api/v1/songs/deleted", Some(&viewer), None).await;
    assert_eq!(trash.0, StatusCode::OK);
    assert_eq!(trash.1.as_array().map(Vec::len), Some(1));
    assert_eq!(trash.1[0]["id"], song);
    assert_eq!(trash.1[0]["revision_id"], second);
    assert_eq!(trash.1[0]["title"], "Amazing Grace");
    assert!(trash.1[0]["deleted_at"].is_string());
    let restore_uri = format!("/api/v1/songs/{song}/restore");
    let refused = send(&app, "POST", &restore_uri, Some(&viewer), None).await;
    assert_eq!(refused.0, StatusCode::FORBIDDEN);
    let restored = send(&app, "POST", &restore_uri, Some(&desktop), None).await;
    assert_eq!(restored.0, StatusCode::OK);
    assert_eq!(restored.1["revision_id"], second);
    let again = send(&app, "POST", &restore_uri, Some(&owner), None).await;
    assert_eq!(again.0, StatusCode::OK);
    let history = send(
        &app,
        "GET",
        &format!("/api/v1/songs/{song}/revisions"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(history.1.as_array().map(Vec::len), Some(2));
    let trash = send(&app, "GET", "/api/v1/songs/deleted", Some(&owner), None).await;
    assert_eq!(trash.1, json!([]));
    let missing = send(
        &app,
        "POST",
        &format!("/api/v1/songs/{}/restore", uuid::Uuid::new_v4()),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(missing.0, StatusCode::NOT_FOUND);

    // Sets too, as a new version with their items.
    let set = send(
        &app,
        "POST",
        "/api/v1/sets",
        Some(&owner),
        Some(json!({ "name": "Sunday", "items": [{ "kind": "song", "song_id": song }] })),
    )
    .await;
    let set_id = set.1["id"].as_str().expect("set id").to_string();
    let deleted = send(
        &app,
        "DELETE",
        &format!("/api/v1/sets/{set_id}?base_version=1"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(deleted.0, StatusCode::NO_CONTENT);
    let trash = send(&app, "GET", "/api/v1/sets/deleted", Some(&viewer), None).await;
    assert_eq!(trash.1[0]["id"], set_id);
    assert_eq!(trash.1[0]["version"], 2);
    assert_eq!(trash.1[0]["item_count"], 1);
    let refused = send(
        &app,
        "POST",
        &format!("/api/v1/sets/{set_id}/restore"),
        Some(&viewer),
        None,
    )
    .await;
    assert_eq!(refused.0, StatusCode::FORBIDDEN);
    let restored = send(
        &app,
        "POST",
        &format!("/api/v1/sets/{set_id}/restore"),
        Some(&desktop),
        None,
    )
    .await;
    assert_eq!(restored.0, StatusCode::OK);
    assert_eq!(restored.1["version"], 3);
    assert_eq!(restored.1["items"][0]["song"]["title"], "Amazing Grace");
    let trash = send(&app, "GET", "/api/v1/sets/deleted", Some(&owner), None).await;
    assert_eq!(trash.1, json!([]));

    // Sets page like songs.
    for name in ["Evening", "Morning"] {
        send(
            &app,
            "POST",
            "/api/v1/sets",
            Some(&owner),
            Some(json!({ "name": name })),
        )
        .await;
    }
    let page = send(&app, "GET", "/api/v1/sets?limit=2", Some(&owner), None).await;
    let rest = send(
        &app,
        "GET",
        "/api/v1/sets?limit=2&offset=2",
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(page.1.as_array().map(Vec::len), Some(2));
    assert_eq!(rest.1.as_array().map(Vec::len), Some(1));
    assert!(!page.1.as_array().unwrap().contains(&rest.1[0]));
}

#[sqlx::test(migrations = "./migrations")]
async fn wrong_passwords_are_limited(pool: PgPool) {
    // The proxy names the client in X-Forwarded-For.
    let app = app(
        AppState::new(pool, 1)
            .with_client_ip_header(Some(header::HeaderName::from_static("x-forwarded-for"))),
        PathBuf::from("directory-that-does-not-exist"),
    );
    let (owner, _) = owner_and_desktop(&app).await;
    add_member(&app, &owner, "lea", "Lea Leader", "leader").await;
    let sign_in_from = |client: &'static str, username: &'static str, password: &'static str| {
        let app = app.clone();
        async move {
            send_from(
                &app,
                client,
                "POST",
                "/api/v1/session",
                None,
                json!({ "username": username, "password": password }),
            )
            .await
        }
    };

    // Setup, once done, is refused before any password is hashed.
    let again = send(
        &app,
        "POST",
        "/api/v1/setup",
        None,
        Some(json!({
            "church_name": "Another",
            "owner_name": "Someone",
            "username": "someone",
            "password": "long-test-password"
        })),
    )
    .await;
    assert_eq!(again.0, StatusCode::CONFLICT);

    // Signing in clears the username's count of wrong passwords.
    for _ in 0..4 {
        let wrong = sign_in_from("198.51.100.1", "owner", "wrong-password").await;
        assert_eq!(wrong.0, StatusCode::UNAUTHORIZED);
    }
    let right = sign_in_from("198.51.100.1", "owner", "long-test-password").await;
    assert_eq!(right.0, StatusCode::OK);

    // Five wrong passwords for one username, from anywhere, close it for a
    // while, even to the right password; other people still sign in.
    for client in [
        "198.51.100.2",
        "198.51.100.3",
        "198.51.100.4",
        "198.51.100.5",
        "198.51.100.6",
    ] {
        let wrong = sign_in_from(client, "owner", "wrong-password").await;
        assert_eq!(wrong.0, StatusCode::UNAUTHORIZED);
    }
    let (status, headers, body) = sign_in_from("198.51.100.7", "OWNER", "long-test-password").await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    let wait = headers[header::RETRY_AFTER]
        .to_str()
        .expect("Retry-After")
        .parse::<u64>()
        .expect("seconds");
    assert!((1..=900).contains(&wait), "{wait}");
    assert!(
        body["error"]
            .as_str()
            .expect("error")
            .starts_with("too many failed sign-ins; try again in"),
        "{body}"
    );
    let other = sign_in_from("198.51.100.7", "lea", MEMBER_PASSWORD).await;
    assert_eq!(other.0, StatusCode::OK);

    // Thirty failures from one client, for any usernames (unknown ones
    // too), make that client wait; other clients go on.
    for number in 0..30 {
        let unknown = send_from(
            &app,
            "203.0.113.50",
            "POST",
            "/api/v1/session",
            None,
            json!({ "username": format!("nobody-{number}"), "password": "wrong-password" }),
        )
        .await;
        assert_eq!(unknown.0, StatusCode::UNAUTHORIZED);
    }
    let blocked = sign_in_from("203.0.113.50", "lea", MEMBER_PASSWORD).await;
    assert_eq!(blocked.0, StatusCode::TOO_MANY_REQUESTS);
    let elsewhere = sign_in_from("203.0.113.51", "lea", MEMBER_PASSWORD).await;
    assert_eq!(elsewhere.0, StatusCode::OK);

    // A stolen session cannot guess the current password either.
    let lea = elsewhere.2["token"].as_str().expect("token").to_string();
    for _ in 0..5 {
        let wrong = send(
            &app,
            "PUT",
            "/api/v1/account/password",
            Some(&lea),
            Some(json!({ "current_password": "wrong-password", "new_password": "a-new-long-password" })),
        )
        .await;
        assert_eq!(wrong.0, StatusCode::FORBIDDEN);
    }
    let (status, headers, _) = send_from(
        &app,
        "203.0.113.51",
        "PUT",
        "/api/v1/account/password",
        Some(&lea),
        json!({ "current_password": MEMBER_PASSWORD, "new_password": "a-new-long-password" }),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert!(headers.contains_key(header::RETRY_AFTER));
}

#[sqlx::test(migrations = "./migrations")]
async fn openapi_describes_every_operation(pool: PgPool) {
    let app = test_app(pool);
    let (status, doc) = send(&app, "GET", "/api/openapi.json", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        doc["components"]["securitySchemes"]["bearer"]["scheme"],
        "bearer"
    );

    // Everything else needs a token, and says so.
    let public = [
        "GET /api/v1/health",
        "GET /api/v1/info",
        "GET /api/v1/setup",
        "POST /api/v1/setup",
        "POST /api/v1/session",
        "GET /api/v1/public/songs",
        "GET /api/v1/public/songs/keys",
        "GET /api/v1/public/songs/{song_id}",
        "GET /api/v1/public/rooms/{room_name}",
        "GET /api/v1/public/rooms/{room_name}/events",
        "GET /api/v1/public/sets/{share_key}",
        "GET /api/v1/public/sets/{share_key}/songs",
        "GET /api/v1/public/sets/{share_key}/songs/{song_id}",
        "POST /api/v1/public/sets/{share_key}/items",
        "DELETE /api/v1/public/sets/{share_key}/items/{item_id}",
        "GET /api/v1/public/sets/{share_key}/live/events",
        "POST /api/v1/desktop-auth/token",
        "GET /api/v1/public/account-links/{token}",
        "POST /api/v1/public/account-links/{token}",
    ];
    let mut operations = 0;
    for (path, item) in doc["paths"].as_object().expect("paths") {
        for (method, operation) in item.as_object().expect("path item") {
            let method = method.to_uppercase();
            if !["GET", "POST", "PUT", "PATCH", "DELETE"].contains(&method.as_str()) {
                continue;
            }
            let name = format!("{method} {path}");
            // Every operation says what it does and sits in one section.
            assert!(
                operation["summary"]
                    .as_str()
                    .is_some_and(|summary| !summary.trim().is_empty()),
                "{name} has no summary; give its handler a doc comment"
            );
            let tag = operation["tags"][0].as_str().unwrap_or_default();
            assert!(
                operation["tags"]
                    .as_array()
                    .is_some_and(|tags| tags.len() == 1)
                    && doc["tags"]
                        .as_array()
                        .is_some_and(|tags| tags.iter().any(|known| known["name"] == tag)),
                "{name} is in no section; add its path to GROUPS in api.rs"
            );
            let secured = operation["security"]
                .as_array()
                .is_some_and(|list| list.iter().any(|item| item.get("bearer").is_some()));
            assert_eq!(secured, !public.contains(&name.as_str()), "{name}");

            // A documented operation is routed: the router's own 404 has no
            // body, and a path it knows without the method is a 405.
            let uri = path
                .split('/')
                .map(|part| {
                    if part.starts_with('{') {
                        "8f14e45f-ceea-467a-9f3c-6b1b8d0c7e01"
                    } else {
                        part
                    }
                })
                .collect::<Vec<_>>()
                .join("/");
            let (status, body) = send(&app, &method, &uri, None, None).await;
            assert_ne!(status, StatusCode::METHOD_NOT_ALLOWED, "{name}");
            assert!(
                !(status == StatusCode::NOT_FOUND && body.is_null()),
                "{name} is documented but not routed"
            );
            operations += 1;
        }
    }
    assert!(operations >= 48, "{operations} operations");
}

const MEMBER_PASSWORD: &str = "member-password-1";

async fn add_member(
    app: &Router,
    owner: &str,
    username: &str,
    display_name: &str,
    role: &str,
) -> String {
    let created = send(
        app,
        "POST",
        "/api/v1/members",
        Some(owner),
        Some(json!({
            "username": username,
            "display_name": display_name,
            "password": MEMBER_PASSWORD,
            "role": role
        })),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED);
    assert_eq!(created.1["username"], username.trim());
    assert_eq!(created.1["role"], role);
    assert_eq!(created.1["disabled"], false);
    created.1["user_id"].as_str().expect("user id").to_string()
}

async fn patch_member(
    app: &Router,
    owner: &str,
    user_id: &str,
    body: Value,
) -> (StatusCode, Value) {
    send(
        app,
        "PATCH",
        &format!("/api/v1/members/{user_id}"),
        Some(owner),
        Some(body),
    )
    .await
}

async fn try_sign_in(app: &Router, username: &str, password: &str) -> StatusCode {
    send(
        app,
        "POST",
        "/api/v1/session",
        None,
        Some(json!({ "username": username, "password": password })),
    )
    .await
    .0
}

async fn sign_in(app: &Router, username: &str, password: &str) -> String {
    let login = send(
        app,
        "POST",
        "/api/v1/session",
        None,
        Some(json!({ "username": username, "password": password })),
    )
    .await;
    assert_eq!(login.0, StatusCode::OK, "{username} signs in");
    login.1["token"].as_str().expect("session").to_string()
}

async fn make_api_token(app: &Router, token: &str, name: &str) -> String {
    let made = send(
        app,
        "POST",
        "/api/v1/api-tokens",
        Some(token),
        Some(json!({ "name": name })),
    )
    .await;
    assert_eq!(made.0, StatusCode::CREATED);
    made.1["token"].as_str().expect("API token").to_string()
}

fn names(list: &Value) -> Vec<String> {
    list.as_array()
        .expect("list")
        .iter()
        .map(|item| item["name"].as_str().expect("name").to_string())
        .collect()
}

/// Like `send`, from a client the proxy names in `X-Forwarded-For`, with the
/// response headers.
async fn send_from(
    app: &Router,
    client: &str,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Value,
) -> (StatusCode, header::HeaderMap, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-forwarded-for", format!("10.0.0.9, {client}"))
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let response = app
        .clone()
        .oneshot(builder.body(Body::from(body.to_string())).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .expect("response body");
    (
        status,
        headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
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

/// Looking online is for song editors, and a too short search is refused
/// before anything is fetched (so this test needs no network).
#[sqlx::test(migrations = "./migrations")]
async fn online_search_is_for_song_editors(pool: PgPool) {
    let app = test_app(pool.clone());
    let (owner, _) = owner_and_desktop(&app).await;
    let viewer = viewer_session(&app, &pool).await;

    let anonymous = send(&app, "GET", "/api/v1/songs/online?q=way+maker", None, None).await;
    assert_eq!(anonymous.0, StatusCode::UNAUTHORIZED);
    let viewing = send(
        &app,
        "GET",
        "/api/v1/songs/online?q=way+maker",
        Some(&viewer),
        None,
    )
    .await;
    assert_eq!(viewing.0, StatusCode::FORBIDDEN);
    let short = send(&app, "GET", "/api/v1/songs/online?q=ab", Some(&owner), None).await;
    assert_eq!(short.0, StatusCode::BAD_REQUEST);
}

/// A song created without a number gets the next one after the highest in
/// the library; one with a number keeps it; imports are left as they are.
#[sqlx::test(migrations = "./migrations")]
async fn new_songs_get_the_next_number(pool: PgPool) {
    let app = test_app(pool);
    let (token, _) = owner_and_desktop(&app).await;
    let create = |chordpro: &'static str| {
        let app = app.clone();
        let token = token.clone();
        async move {
            let created = send(
                &app,
                "POST",
                "/api/v1/songs",
                Some(&token),
                Some(json!({ "chordpro": chordpro })),
            )
            .await;
            assert_eq!(created.0, StatusCode::CREATED);
            created.1
        }
    };
    let first = create("{title: First}\n\nWords").await;
    assert_eq!(first["song_number"], "1");
    let kept = create("{title: Numbered}\n{meta: song_num=41}\n\nWords").await;
    assert_eq!(kept["song_number"], "41");
    let next = create("{title: Next}\n\nWords").await;
    assert_eq!(next["song_number"], "42");
    let song = send(
        &app,
        "GET",
        &format!("/api/v1/songs/{}", next["id"].as_str().unwrap()),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(
        song.1["chordpro"],
        "{title: Next}\n{meta: song_num=42}\n\nWords"
    );

    let imported = send(
        &app,
        "POST",
        "/api/v1/songs/import",
        Some(&token),
        Some(json!({ "songs": [{ "filename": "x.pro", "chordpro": "{title: Imported}\n\nOther words" }] })),
    )
    .await;
    assert_eq!(imported.0, StatusCode::CREATED, "{}", imported.1);
    assert!(
        imported.1["songs"][0]["song_number"].is_null(),
        "{}",
        imported.1
    );
}

/// Owners invite people and reset passwords with one-time links; the person
/// chooses the password and is signed in.
#[sqlx::test(migrations = "./migrations")]
async fn invite_and_reset_links(pool: PgPool) {
    let app = test_app(pool.clone());
    let (owner, desktop) = owner_and_desktop(&app).await;
    let viewer = viewer_session(&app, &pool).await;

    // Only owners make links.
    for token in [&viewer, &desktop] {
        let refused = send(
            &app,
            "POST",
            "/api/v1/members/invites",
            Some(token),
            Some(json!({ "role": "leader" })),
        )
        .await;
        assert_eq!(refused.0, StatusCode::FORBIDDEN);
    }

    let invite = send(
        &app,
        "POST",
        "/api/v1/members/invites",
        Some(&owner),
        Some(json!({ "role": "leader", "display_name": " Ida " })),
    )
    .await;
    assert_eq!(invite.0, StatusCode::CREATED);
    assert_eq!(invite.1["kind"], "invite");
    assert_eq!(invite.1["display_name"], "Ida");
    let token = invite.1["token"]
        .as_str()
        .expect("invite token")
        .to_string();
    assert_eq!(invite.1["path"], format!("/invite/{token}"));
    let invite_id = invite.1["id"].as_str().expect("invite id").to_string();

    let links = send(&app, "GET", "/api/v1/members/links", Some(&owner), None).await;
    assert_eq!(links.0, StatusCode::OK);
    assert_eq!(links.1.as_array().expect("links").len(), 1);

    let opened = send(
        &app,
        "GET",
        &format!("/api/v1/public/account-links/{token}"),
        None,
        None,
    )
    .await;
    assert_eq!(opened.0, StatusCode::OK);
    assert_eq!(opened.1["kind"], "invite");
    assert_eq!(opened.1["church_name"], "Test Church");
    assert_eq!(opened.1["role"], "leader");
    assert!(opened.1.get("token").is_none());

    let use_link = |token: String, body: Value| {
        let app = app.clone();
        async move {
            send(
                &app,
                "POST",
                &format!("/api/v1/public/account-links/{token}"),
                None,
                Some(body),
            )
            .await
        }
    };
    // A taken username, a short password and no username are refused; the
    // link still works afterwards.
    for (body, status) in [
        (
            json!({ "username": "OWNER", "password": MEMBER_PASSWORD }),
            StatusCode::CONFLICT,
        ),
        (
            json!({ "username": "ida", "password": "short" }),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({ "password": MEMBER_PASSWORD }),
            StatusCode::BAD_REQUEST,
        ),
    ] {
        assert_eq!(use_link(token.clone(), body).await.0, status);
    }
    let joined = use_link(
        token.clone(),
        json!({ "username": "ida", "password": MEMBER_PASSWORD }),
    )
    .await;
    assert_eq!(joined.0, StatusCode::OK);
    assert_eq!(joined.1["display_name"], "Ida");
    assert_eq!(joined.1["role"], "leader");
    let ida_id = joined.1["user_id"].as_str().expect("ida id").to_string();
    let ida = joined.1["token"].as_str().expect("session").to_string();
    assert_eq!(
        send(&app, "GET", "/api/v1/session", Some(&ida), None)
            .await
            .0,
        StatusCode::OK
    );
    sign_in(&app, "ida", MEMBER_PASSWORD).await;

    // Used once, it is gone.
    let again = use_link(
        token.clone(),
        json!({ "username": "ida2", "password": MEMBER_PASSWORD }),
    )
    .await;
    assert_eq!(again.0, StatusCode::NOT_FOUND);
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/api/v1/public/account-links/{token}"),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(
            &app,
            "DELETE",
            &format!("/api/v1/members/links/{invite_id}"),
            Some(&owner),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );

    // A revoked invite does not work.
    let revoked = send(
        &app,
        "POST",
        "/api/v1/members/invites",
        Some(&owner),
        Some(json!({ "role": "viewer" })),
    )
    .await;
    let revoked_token = revoked.1["token"].as_str().expect("token").to_string();
    let revoked_id = revoked.1["id"].as_str().expect("id");
    assert_eq!(
        send(
            &app,
            "DELETE",
            &format!("/api/v1/members/links/{revoked_id}"),
            Some(&owner),
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let dead = use_link(
        revoked_token,
        json!({ "username": "zed", "display_name": "Zed", "password": MEMBER_PASSWORD }),
    )
    .await;
    assert_eq!(dead.0, StatusCode::NOT_FOUND);

    // Reset links: not for yourself; a new one replaces the last.
    let owner_id = send(&app, "GET", "/api/v1/session", Some(&owner), None)
        .await
        .1["user_id"]
        .as_str()
        .expect("owner id")
        .to_string();
    let own = send(
        &app,
        "POST",
        &format!("/api/v1/members/{owner_id}/reset-link"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(own.0, StatusCode::FORBIDDEN);
    let first = send(
        &app,
        "POST",
        &format!("/api/v1/members/{ida_id}/reset-link"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(first.0, StatusCode::CREATED);
    let first_token = first.1["token"].as_str().expect("token").to_string();
    let reset = send(
        &app,
        "POST",
        &format!("/api/v1/members/{ida_id}/reset-link"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(reset.0, StatusCode::CREATED);
    assert_eq!(reset.1["kind"], "reset");
    assert_eq!(reset.1["display_name"], "Ida");
    let reset_token = reset.1["token"].as_str().expect("token").to_string();
    assert_eq!(reset.1["path"], format!("/reset-password/{reset_token}"));
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/api/v1/public/account-links/{first_token}"),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let opened = send(
        &app,
        "GET",
        &format!("/api/v1/public/account-links/{reset_token}"),
        None,
        None,
    )
    .await;
    assert_eq!(opened.1["username"], "ida");

    let new_password = "a-brand-new-password";
    let done = use_link(reset_token.clone(), json!({ "password": new_password })).await;
    assert_eq!(done.0, StatusCode::OK);
    assert_eq!(done.1["user_id"], ida_id.as_str());
    // Her other sessions ended; the new password works, the old does not.
    assert_eq!(
        send(&app, "GET", "/api/v1/session", Some(&ida), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        try_sign_in(&app, "ida", MEMBER_PASSWORD).await,
        StatusCode::UNAUTHORIZED
    );
    sign_in(&app, "ida", new_password).await;
    assert_eq!(
        use_link(reset_token, json!({ "password": new_password }))
            .await
            .0,
        StatusCode::NOT_FOUND
    );

    // A disabled person's reset link stops working.
    let later = send(
        &app,
        "POST",
        &format!("/api/v1/members/{ida_id}/reset-link"),
        Some(&owner),
        None,
    )
    .await;
    let later_token = later.1["token"].as_str().expect("token").to_string();
    assert_eq!(
        patch_member(&app, &owner, &ida_id, json!({ "disabled": true }))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/api/v1/public/account-links/{later_token}"),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(
            &app,
            "POST",
            &format!("/api/v1/members/{ida_id}/reset-link"),
            Some(&owner),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

/// Sends `body` as it is, with `content_type`, and returns the answer's
/// status, `Content-Type` and bytes.
async fn send_bytes(
    app: &Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    content_type: &str,
    body: Vec<u8>,
) -> (StatusCode, String, Vec<u8>) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, content_type);
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let response = app
        .clone()
        .oneshot(builder.body(Body::from(body)).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = to_bytes(response.into_body(), 64 * 1024 * 1024)
        .await
        .expect("response body");
    (status, content_type, bytes.to_vec())
}

/// Leaders and owners record a song and link YouTube videos of it; everyone
/// in the church lists them and plays the recordings.
#[sqlx::test(migrations = "./migrations")]
async fn song_recordings_and_videos(pool: PgPool) {
    let app = test_app(pool.clone());
    let (owner, desktop) = owner_and_desktop(&app).await;
    let viewer = viewer_session(&app, &pool).await;
    let (song_id, _) = create_song(&app, &owner, "Amazing Grace").await;
    let media = format!("/api/v1/songs/{song_id}/media");
    let recordings = format!("/api/v1/songs/{song_id}/recordings");
    let audio = vec![26u8, 69, 223, 163, 1, 2, 3, 4];

    let empty = send(&app, "GET", &media, Some(&viewer), None).await;
    assert_eq!(empty.0, StatusCode::OK);
    assert_eq!(empty.1, json!({ "recordings": [], "videos": [] }));

    // Only leaders and owners record.
    for token in [&viewer, &desktop] {
        let refused = send_bytes(
            &app,
            "POST",
            &recordings,
            Some(token),
            "audio/webm",
            audio.clone(),
        )
        .await;
        assert_eq!(refused.0, StatusCode::FORBIDDEN);
    }
    let not_audio = send_bytes(
        &app,
        "POST",
        &recordings,
        Some(&owner),
        "text/html",
        audio.clone(),
    )
    .await;
    assert_eq!(not_audio.0, StatusCode::BAD_REQUEST);
    let nothing = send_bytes(
        &app,
        "POST",
        &recordings,
        Some(&owner),
        "audio/webm",
        Vec::new(),
    )
    .await;
    assert_eq!(nothing.0, StatusCode::BAD_REQUEST);

    let saved = send_bytes(
        &app,
        "POST",
        &format!("{recordings}?title=Piano%20intro&duration_ms=4200"),
        Some(&owner),
        "audio/webm;codecs=opus",
        audio.clone(),
    )
    .await;
    assert_eq!(saved.0, StatusCode::CREATED);
    let saved: Value = serde_json::from_slice(&saved.2).expect("json");
    assert_eq!(saved["title"], "Piano intro");
    assert_eq!(saved["content_type"], "audio/webm;codecs=opus");
    assert_eq!(saved["duration_ms"], 4200);
    assert_eq!(saved["byte_size"], audio.len());
    assert_eq!(saved["created_by_name"], "Test Owner");
    let recording_id = saved["id"].as_str().expect("id");

    // Everyone in the church plays it back, as it was recorded.
    let audio_path = format!("{recordings}/{recording_id}/audio");
    for token in [&viewer, &desktop] {
        let played = send_bytes(
            &app,
            "GET",
            &audio_path,
            Some(token),
            "audio/webm",
            Vec::new(),
        )
        .await;
        assert_eq!(played.0, StatusCode::OK);
        assert_eq!(played.1, "audio/webm;codecs=opus");
        assert_eq!(played.2, audio);
    }
    let anonymous = send(&app, "GET", &audio_path, None, None).await;
    assert_eq!(anonymous.0, StatusCode::UNAUTHORIZED);

    // YouTube links in any usual form, kept as the video and its start.
    let videos = format!("/api/v1/songs/{song_id}/videos");
    let not_youtube = send(
        &app,
        "POST",
        &videos,
        Some(&owner),
        Some(json!({ "url": "https://vimeo.com/1" })),
    )
    .await;
    assert_eq!(not_youtube.0, StatusCode::BAD_REQUEST);
    let refused = send(
        &app,
        "POST",
        &videos,
        Some(&viewer),
        Some(json!({ "url": "https://youtu.be/dQw4w9WgXcQ" })),
    )
    .await;
    assert_eq!(refused.0, StatusCode::FORBIDDEN);
    let linked = send(
        &app,
        "POST",
        &videos,
        Some(&owner),
        Some(json!({ "url": "https://youtu.be/dQw4w9WgXcQ?t=1m5s", "title": " Live in Oslo " })),
    )
    .await;
    assert_eq!(linked.0, StatusCode::CREATED);
    assert_eq!(linked.1["title"], "Live in Oslo");
    assert_eq!(linked.1["video_id"], "dQw4w9WgXcQ");
    assert_eq!(linked.1["start_seconds"], 65);
    assert_eq!(
        linked.1["url"],
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=65s"
    );
    let video_id = linked.1["id"].as_str().expect("id").to_string();

    let listed = send(&app, "GET", &media, Some(&desktop), None).await;
    assert_eq!(listed.0, StatusCode::OK);
    assert_eq!(listed.1["recordings"][0]["id"], recording_id);
    assert!(listed.1["recordings"][0].get("audio").is_none());
    assert_eq!(listed.1["videos"][0]["id"], video_id.as_str());

    // A song that is not in the church has none.
    let other = send(
        &app,
        "GET",
        "/api/v1/songs/00000000-0000-0000-0000-000000000000/media",
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(other.0, StatusCode::NOT_FOUND);

    // Removing is for leaders and owners too.
    let recording_path = format!("{recordings}/{recording_id}");
    let refused = send(&app, "DELETE", &recording_path, Some(&viewer), None).await;
    assert_eq!(refused.0, StatusCode::FORBIDDEN);
    let removed = send(&app, "DELETE", &recording_path, Some(&owner), None).await;
    assert_eq!(removed.0, StatusCode::NO_CONTENT);
    let again = send(&app, "DELETE", &recording_path, Some(&owner), None).await;
    assert_eq!(again.0, StatusCode::NOT_FOUND);
    let removed = send(
        &app,
        "DELETE",
        &format!("{videos}/{video_id}"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(removed.0, StatusCode::NO_CONTENT);
    let empty = send(&app, "GET", &media, Some(&viewer), None).await;
    assert_eq!(empty.1, json!({ "recordings": [], "videos": [] }));

    // A deleted song's recordings are not played.
    let saved = send_bytes(
        &app,
        "POST",
        &recordings,
        Some(&owner),
        "audio/mp4",
        audio.clone(),
    )
    .await;
    assert_eq!(saved.0, StatusCode::CREATED);
    let saved: Value = serde_json::from_slice(&saved.2).expect("json");
    assert_eq!(saved["title"], "Recording");
    let deleted = send(
        &app,
        "DELETE",
        &format!("/api/v1/songs/{song_id}"),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(deleted.0, StatusCode::NO_CONTENT);
    let gone = send(
        &app,
        "GET",
        &format!("{recordings}/{}/audio", saved["id"].as_str().expect("id")),
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(gone.0, StatusCode::NOT_FOUND);
}
