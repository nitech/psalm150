use std::path::Path;
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

pub struct LibraryWatcher {
    _watcher: RecommendedWatcher,
    pub receiver: Receiver<()>,
}

impl LibraryWatcher {
    pub fn new(folder: &Path) -> Result<Self, String> {
        let (tx, rx) = channel();
        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                            let _ = tx.send(());
                        }
                        _ => {}
                    }
                }
            },
            Config::default().with_poll_interval(Duration::from_secs(2)),
        )
        .map_err(|e| e.to_string())?;

        watcher
            .watch(folder, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;

        Ok(Self {
            _watcher: watcher,
            receiver: rx,
        })
    }
}
