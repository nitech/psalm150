use std::net::{Shutdown, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

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
            while !worker_stop.load(Ordering::SeqCst) {
                match worker_server.recv_timeout(POLL) {
                    Ok(Some(request)) => handle_request(request, &worker_pin, &action_tx),
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

fn handle_request(request: Request, pin: &str, actions: &Sender<RemoteAction>) {
    let pin_ok = request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("x-psa150-pin"))
        .map(|h| h.value.as_str() == pin)
        .unwrap_or(false);

    let (status, content_type, body) = match (request.method(), request.url()) {
        (&Method::Get, "/") => (200, "text/html; charset=utf-8", include_str!("../assets/remote.html").to_string()),
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
