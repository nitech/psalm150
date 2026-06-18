use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use tiny_http::{Header, Method, Response, Server};

#[derive(Debug, Clone, Copy)]
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

pub struct RemoteServer {
    stop: Arc<Mutex<bool>>,
    port: u16,
    pin: String,
}

impl RemoteServer {
    pub fn start(port: u16, pin: String) -> Result<(Self, std::sync::mpsc::Receiver<RemoteAction>), String> {
        let (action_tx, rx) = channel();
        let stop = Arc::new(Mutex::new(false));
        let stop_flag = stop.clone();
        let pin_clone = pin.clone();
        thread::spawn(move || {
            let addr = format!("0.0.0.0:{port}");
            if let Ok(server) = Server::http(&addr) {
                for request in server.incoming_requests() {
                    if *stop_flag.lock().unwrap() {
                        break;
                    }
                    let pin_ok = request
                        .headers()
                        .iter()
                        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("x-praise-pin"))
                        .map(|h| h.value.as_str() == pin_clone)
                        .unwrap_or(false);
                    if !pin_ok && request.method() != &Method::Get {
                        let _ = request.respond(Response::from_string("Unauthorized").with_status_code(401));
                        continue;
                    }
                    let body = match (request.method(), request.url()) {
                        (&Method::Get, "/") => include_str!("../assets/remote.html").to_string(),
                        (&Method::Post, "/next") => {
                            let _ = action_tx.send(RemoteAction::Next);
                            "{\"action\":\"next\"}".into()
                        }
                        (&Method::Post, "/prev") => {
                            let _ = action_tx.send(RemoteAction::Prev);
                            "{\"action\":\"prev\"}".into()
                        }
                        (&Method::Post, "/blank") => {
                            let _ = action_tx.send(RemoteAction::Blank);
                            "{\"action\":\"blank\"}".into()
                        }
                        _ => "{\"error\":\"not found\"}".into(),
                    };
                    let mut response = Response::from_string(body);
                    response.add_header(
                        Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
                    );
                    let _ = request.respond(response);
                }
            }
        });
        Ok((Self { stop, port, pin }, rx))
    }

    pub fn stop(self) {
        *self.stop.lock().unwrap() = true;
    }

    pub fn status(&self) -> RemoteStatus {
        RemoteStatus {
            running: true,
            port: self.port,
            pin: self.pin.clone(),
        }
    }
}
