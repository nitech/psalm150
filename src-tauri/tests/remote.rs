use std::time::Duration;

use psalm150_lib::remote::{RemoteAction, RemoteServer};

#[test]
fn remote_serves_page_guards_actions_with_pin_and_releases_port_on_stop() {
    let (server, actions) = RemoteServer::start(0, "4321".into()).expect("bind ephemeral port");
    let port = server.status().port;
    assert_ne!(port, 0, "status should report the actually bound port");

    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .build()
        .unwrap();
    let base = format!("http://127.0.0.1:{port}");

    let page = client.get(format!("{base}/")).send().expect("GET /");
    assert!(page.headers()["content-type"]
        .to_str()
        .unwrap()
        .starts_with("text/html"));
    assert!(page.text().unwrap().contains("Psalm150 remote"));

    let denied = client.post(format!("{base}/next")).send().unwrap();
    assert_eq!(denied.status(), 401);
    assert!(
        actions.try_recv().is_err(),
        "unauthorised request must not queue an action"
    );

    let accepted = client
        .post(format!("{base}/blank"))
        .header("X-PSA150-PIN", "4321")
        .send()
        .unwrap();
    assert_eq!(accepted.status(), 200);
    assert_eq!(
        actions.recv_timeout(Duration::from_secs(2)).unwrap(),
        RemoteAction::Blank
    );

    let missing = client
        .post(format!("{base}/nope"))
        .header("X-PSA150-PIN", "4321")
        .send()
        .unwrap();
    assert_eq!(missing.status(), 404);

    let started = std::time::Instant::now();
    server.stop();
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "stop() should return promptly"
    );

    // Re-binding is the real proof the listener is gone; a pooled keep-alive
    // connection from `client` would only time out and prove nothing.
    let mut released = false;
    for _ in 0..20 {
        if std::net::TcpListener::bind(("0.0.0.0", port)).is_ok() {
            released = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(released, "port {port} should be released after stop()");
}

#[test]
fn remote_rejects_foreign_hosts_and_locks_out_after_wrong_pins() {
    let (server, actions) = RemoteServer::start(0, "4321".into()).expect("bind ephemeral port");
    let base = format!("http://127.0.0.1:{}", server.status().port);
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .build()
        .unwrap();

    // DNS rebinding: a public name pointing at this PC is refused.
    let rebound = client
        .get(format!("{base}/"))
        .header("Host", "evil.example.com")
        .send()
        .unwrap();
    assert_eq!(rebound.status(), 403);
    let named = client
        .get(format!("{base}/"))
        .header("Host", "church-pc:8757")
        .send()
        .unwrap();
    assert_eq!(named.status(), 200);

    for _ in 0..5 {
        let wrong = client
            .post(format!("{base}/next"))
            .header("X-PSA150-PIN", "0000")
            .send()
            .unwrap();
        assert_eq!(wrong.status(), 401);
    }
    let locked = client
        .post(format!("{base}/next"))
        .header("X-PSA150-PIN", "4321")
        .send()
        .unwrap();
    assert_eq!(
        locked.status(),
        429,
        "the right PIN is refused during the lockout"
    );
    assert!(actions.try_recv().is_err());

    server.stop();
}
