use std::net::{Shutdown, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tiny_http::{Header, Method, Request, Response, Server};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteAction {
    Next,
    Prev,
    Blank,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteStatus {
    pub running: bool,
    pub port: u16,
    pub pin: String,
}

/// How often the worker checks the stop flag between requests.
const POLL: Duration = Duration::from_millis(250);
/// Wrong PINs in a row before actions are refused for `LOCKOUT`.
const MAX_PIN_FAILURES: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(60);

/// PIN-guarded HTTP remote for a phone on the same network (LAN or Tailscale).
///
/// The socket is bound synchronously so a failed bind (port in use, firewall)
/// reaches the caller instead of leaving a "running" server that serves nothing.
pub struct RemoteServer {
    server: Option<Arc<Server>>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    port: u16,
    pin: String,
}

impl RemoteServer {
    pub fn start(port: u16, pin: String) -> Result<(Self, Receiver<RemoteAction>), String> {
        let server = Server::http(format!("0.0.0.0:{port}"))
            .map_err(|e| format!("Could not listen on port {port}: {e}"))?;
        let bound_port = server
            .server_addr()
            .to_ip()
            .map(|addr| addr.port())
            .unwrap_or(port);
        let server = Arc::new(server);
        let stop = Arc::new(AtomicBool::new(false));
        let (action_tx, rx) = channel();

        let worker_server = server.clone();
        let worker_stop = stop.clone();
        let worker_pin = pin.clone();
        let worker = thread::spawn(move || {
            let mut guard = PinGuard::default();
            while !worker_stop.load(Ordering::SeqCst) {
                match worker_server.recv_timeout(POLL) {
                    Ok(Some(request)) => handle_request(request, &worker_pin, &mut guard, &action_tx),
                    Ok(None) => continue,
                    Err(_) => break,
                }
            }
        });

        Ok((
            Self {
                server: Some(server),
                stop,
                worker: Some(worker),
                port: bound_port,
                pin,
            },
            rx,
        ))
    }

    /// Stops within one poll interval and releases the port.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(server) = self.server.take() {
            server.unblock();
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
            // Dropping the last handle sets tiny_http's close flag.
            drop(server);
        }
        // tiny_http wakes its accept thread by connecting to the listen address,
        // which is 0.0.0.0 here and is refused on Windows, leaving the port bound.
        // Poke it over loopback so the listener actually closes.
        let addr = SocketAddr::from(([127, 0, 0, 1], self.port));
        if let Ok(stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
            let _ = stream.shutdown(Shutdown::Both);
        }
    }

    pub fn status(&self) -> RemoteStatus {
        RemoteStatus {
            running: true,
            port: self.port,
            pin: self.pin.clone(),
        }
    }
}

/// Counts wrong PINs so a phone (or a web page in the phone's browser)
/// cannot guess the PIN by brute force.
#[derive(Default)]
struct PinGuard {
    failures: u32,
    locked_until: Option<Instant>,
}

impl PinGuard {
    fn locked(&mut self) -> bool {
        match self.locked_until {
            Some(until) if Instant::now() < until => true,
            Some(_) => {
                self.locked_until = None;
                self.failures = 0;
                false
            }
            None => false,
        }
    }

    fn record(&mut self, ok: bool) {
        if ok {
            self.failures = 0;
            return;
        }
        self.failures += 1;
        if self.failures >= MAX_PIN_FAILURES {
            self.locked_until = Some(Instant::now() + LOCKOUT);
        }
    }
}

fn header<'a>(request: &'a Request, name: &str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

/// DNS rebinding guard: a page on some public domain that re-resolves to this
/// PC still sends its own name as Host. Accept IP literals, localhost and the
/// names a phone can reach this PC by without public DNS: a bare machine
/// name, `*.local` (mDNS) and `*.ts.net` (Tailscale MagicDNS).
fn host_allowed(host: Option<&str>) -> bool {
    let Some(host) = host else { return false };
    let host = host.trim().to_ascii_lowercase();
    if let Some(rest) = host.strip_prefix('[') {
        // [IPv6]:port
        return rest
            .split(']')
            .next()
            .is_some_and(|ip| ip.parse::<std::net::Ipv6Addr>().is_ok());
    }
    let name = host.rsplit_once(':').map_or(host.as_str(), |(name, _port)| name);
    let name = name.trim_end_matches('.');
    !name.is_empty()
        && (name.parse::<std::net::Ipv4Addr>().is_ok()
            || name == "localhost"
            || !name.contains('.')
            || name.ends_with(".local")
            || name.ends_with(".ts.net"))
}

fn handle_request(request: Request, pin: &str, guard: &mut PinGuard, actions: &Sender<RemoteAction>) {
    let host_ok = host_allowed(header(&request, "host"));
    let is_post = request.method() == &Method::Post;
    let locked = is_post && guard.locked();
    let pin_ok = header(&request, "x-psa150-pin") == Some(pin);
    if is_post && host_ok && !locked {
        guard.record(pin_ok);
    }

    let (status, content_type, body) = match (request.method(), request.url()) {
        _ if !host_ok => (403, "application/json", "{\"error\":\"forbidden host\"}".to_string()),
        (&Method::Get, "/") => (200, "text/html; charset=utf-8", include_str!("../assets/remote.html").to_string()),
        (&Method::Post, _) if locked => (429, "application/json", "{\"error\":\"too many wrong PINs\"}".to_string()),
        (&Method::Post, _) if !pin_ok => (401, "application/json", "{\"error\":\"unauthorized\"}".to_string()),
        (&Method::Post, "/next") => (200, "application/json", action(actions, RemoteAction::Next, "next")),
        (&Method::Post, "/prev") => (200, "application/json", action(actions, RemoteAction::Prev, "prev")),
        (&Method::Post, "/blank") => (200, "application/json", action(actions, RemoteAction::Blank, "blank")),
        _ => (404, "application/json", "{\"error\":\"not found\"}".to_string()),
    };

    let mut response = Response::from_string(body).with_status_code(status);
    if let Ok(header) = Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()) {
        response.add_header(header);
    }
    let _ = request.respond(response);
}

fn action(actions: &Sender<RemoteAction>, kind: RemoteAction, name: &str) -> String {
    let _ = actions.send(kind);
    format!("{{\"action\":\"{name}\"}}")
}
