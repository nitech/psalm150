//! What changed in a church's library, told to its desktops at once.
//!
//! Every song or set that is created, edited, deleted or restored is noted
//! here after its transaction commits, under a number that only grows. A
//! desktop asks `GET /library/changes?after=<cursor>&wait=25` and gets the
//! songs and sets changed since its cursor, or waits for the next change
//! (long polling, like the remote relay's commands). It then fetches what
//! changed, so a song edited on a phone is on the projector moments later.
//!
//! Kept in memory, like the relay: a restart starts a new `epoch`, and a
//! cursor from before it, or older than the changes kept, answers
//! `complete: false`; the desktop then compares its whole copy once
//! (`GET /songs/versions`, `GET /sets/snapshot`).

use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::Duration,
};

use axum::{
    Json, Router,
    extract::{Query, State},
    http::HeaderMap,
    routing::get,
};
use tokio::sync::watch;
use uuid::Uuid;

use crate::{
    AppState,
    auth::authenticate,
    error::{AppError, ErrorBody},
    models::{ChangesQuery, LibraryChanges},
};

/// Changes kept per church; a desktop further behind compares everything.
const KEPT: usize = 2000;
/// Longest long-poll wait a client may ask for.
const MAX_WAIT_SECONDS: u64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Song,
    Set,
}

struct Entry {
    seq: u64,
    kind: Kind,
    id: Uuid,
    /// The desktop that made the change, which needs not hear of it.
    device_id: Option<Uuid>,
}

#[derive(Default)]
struct ChurchLog {
    /// The number of the last change (0: none yet).
    last: u64,
    entries: VecDeque<Entry>,
}

pub struct ChangeHub {
    /// Tells cursors from before a restart apart.
    epoch: Uuid,
    churches: Mutex<HashMap<Uuid, ChurchLog>>,
    /// Bumped on every change; long polls wait on it.
    changes: watch::Sender<u64>,
}

impl Default for ChangeHub {
    fn default() -> Self {
        Self {
            epoch: Uuid::new_v4(),
            churches: Mutex::default(),
            changes: watch::channel(0).0,
        }
    }
}

impl ChangeHub {
    /// A song was created, edited, deleted or restored.
    pub fn song(&self, church_id: Uuid, song_id: Uuid, device_id: Option<Uuid>) {
        self.record(church_id, [(Kind::Song, song_id)], device_id);
    }

    /// Songs were added at once (an import).
    pub fn songs(
        &self,
        church_id: Uuid,
        song_ids: impl IntoIterator<Item = Uuid>,
        device_id: Option<Uuid>,
    ) {
        self.record(
            church_id,
            song_ids.into_iter().map(|id| (Kind::Song, id)),
            device_id,
        );
    }

    /// A set was created, edited, deleted or restored.
    pub fn set(&self, church_id: Uuid, set_id: Uuid, device_id: Option<Uuid>) {
        self.record(church_id, [(Kind::Set, set_id)], device_id);
    }

    fn record(
        &self,
        church_id: Uuid,
        changes: impl IntoIterator<Item = (Kind, Uuid)>,
        device_id: Option<Uuid>,
    ) {
        let mut churches = self
            .churches
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let log = churches.entry(church_id).or_default();
        let before = log.last;
        for (kind, id) in changes {
            log.last += 1;
            log.entries.push_back(Entry {
                seq: log.last,
                kind,
                id,
                device_id,
            });
            if log.entries.len() > KEPT {
                log.entries.pop_front();
            }
        }
        let grew = log.last != before;
        drop(churches);
        if grew {
            self.changes
                .send_modify(|version| *version = version.wrapping_add(1));
        }
    }

    /// What changed in the church after `after`, leaving out what `device_id`
    /// did itself.
    fn since(
        &self,
        church_id: Uuid,
        after: Option<&str>,
        device_id: Option<Uuid>,
    ) -> LibraryChanges {
        let churches = self
            .churches
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let empty = ChurchLog::default();
        let log = churches.get(&church_id).unwrap_or(&empty);
        let cursor = format!("{}.{}", self.epoch, log.last);
        let known = after.and_then(|after| parse_cursor(after, self.epoch));
        // The oldest change still kept; everything after `known` must be.
        let oldest = log.entries.front().map_or(log.last + 1, |entry| entry.seq);
        let Some(known) = known.filter(|known| *known <= log.last && known + 1 >= oldest) else {
            return LibraryChanges {
                cursor,
                complete: false,
                songs: Vec::new(),
                sets: Vec::new(),
            };
        };
        let mut songs = Vec::new();
        let mut sets = Vec::new();
        for entry in log.entries.iter().filter(|entry| entry.seq > known) {
            if device_id.is_some() && entry.device_id == device_id {
                continue;
            }
            let list = match entry.kind {
                Kind::Song => &mut songs,
                Kind::Set => &mut sets,
            };
            if !list.contains(&entry.id) {
                list.push(entry.id);
            }
        }
        LibraryChanges {
            cursor,
            complete: true,
            songs,
            sets,
        }
    }
}

/// `<epoch>.<number>` from this server run, else none.
fn parse_cursor(cursor: &str, epoch: Uuid) -> Option<u64> {
    let (cursor_epoch, number) = cursor.split_once('.')?;
    (Uuid::parse_str(cursor_epoch).ok()? == epoch).then_some(())?;
    number.parse().ok()
}

pub fn router() -> Router<AppState> {
    Router::new().route("/library/changes", get(library_changes))
}

/// The songs and sets changed since a cursor, as they happen.
///
/// Without `after`, or with a cursor the server no longer knows (it was
/// restarted, or too much changed since), the answer is `complete: false`
/// with a new cursor: compare everything once (`GET /songs/versions`,
/// `GET /sets/snapshot`), then ask again with that cursor. Otherwise it lists
/// the songs and sets created, changed, deleted or restored since, leaving
/// out a desktop's own changes. With nothing new and `wait`, the request
/// stays open up to that many seconds until something changes (long
/// polling). Fetch each song or set listed to see what it is now; one that
/// answers 404 was deleted.
#[utoipa::path(
    get,
    path = "/api/v1/library/changes",
    security(("bearer" = [])),
    params(ChangesQuery),
    responses((status = 200, body = LibraryChanges), (status = 401, body = ErrorBody))
)]
pub async fn library_changes(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ChangesQuery>,
) -> Result<Json<LibraryChanges>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let device_id = auth.device_id.filter(|_| auth.is_device());
    let wait = query.wait.unwrap_or(0).min(MAX_WAIT_SECONDS);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(wait);
    // Subscribed before looking, so a change between the look and the wait
    // is not missed.
    let mut changed = state.changes.changes.subscribe();
    loop {
        let changes = state
            .changes
            .since(auth.church_id, query.after.as_deref(), device_id);
        let news = !changes.complete || !changes.songs.is_empty() || !changes.sets.is_empty();
        if news || tokio::time::Instant::now() >= deadline {
            return Ok(Json(changes));
        }
        // Another church's change wakes us too: look again, then wait again.
        if !matches!(
            tokio::time::timeout_at(deadline, changed.changed()).await,
            Ok(Ok(()))
        ) {
            let changes = state
                .changes
                .since(auth.church_id, query.after.as_deref(), device_id);
            return Ok(Json(changes));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(count: usize) -> Vec<Uuid> {
        (0..count).map(|_| Uuid::new_v4()).collect()
    }

    #[test]
    fn a_new_reader_compares_everything_once() {
        let hub = ChangeHub::default();
        let church = Uuid::new_v4();
        let first = hub.since(church, None, None);
        assert!(!first.complete);
        let again = hub.since(church, Some(&first.cursor), None);
        assert!(again.complete);
        assert!(again.songs.is_empty() && again.sets.is_empty());
        // A cursor from another run of the server.
        let other = format!("{}.0", Uuid::new_v4());
        assert!(!hub.since(church, Some(&other), None).complete);
        assert!(!hub.since(church, Some("nonsense"), None).complete);
    }

    #[test]
    fn lists_each_change_once_and_only_the_church_s_own() {
        let hub = ChangeHub::default();
        let church = Uuid::new_v4();
        let cursor = hub.since(church, None, None).cursor;
        let [song, set] = [Uuid::new_v4(), Uuid::new_v4()];
        hub.song(church, song, None);
        hub.song(church, song, None);
        hub.set(church, set, None);
        hub.song(Uuid::new_v4(), Uuid::new_v4(), None);
        let changes = hub.since(church, Some(&cursor), None);
        assert!(changes.complete);
        assert_eq!(changes.songs, vec![song]);
        assert_eq!(changes.sets, vec![set]);
        // Nothing new after the new cursor.
        let later = hub.since(church, Some(&changes.cursor), None);
        assert!(later.complete && later.songs.is_empty() && later.sets.is_empty());
    }

    #[test]
    fn leaves_out_a_desktop_s_own_changes() {
        let hub = ChangeHub::default();
        let church = Uuid::new_v4();
        let desktop = Uuid::new_v4();
        let cursor = hub.since(church, None, None).cursor;
        let [own, other] = [Uuid::new_v4(), Uuid::new_v4()];
        hub.song(church, own, Some(desktop));
        hub.song(church, other, None);
        assert_eq!(
            hub.since(church, Some(&cursor), Some(desktop)).songs,
            vec![other]
        );
        assert_eq!(
            hub.since(church, Some(&cursor), None).songs,
            vec![own, other]
        );
    }

    #[test]
    fn a_reader_too_far_behind_compares_everything() {
        let hub = ChangeHub::default();
        let church = Uuid::new_v4();
        let cursor = hub.since(church, None, None).cursor;
        hub.songs(church, ids(KEPT + 1), None);
        assert!(!hub.since(church, Some(&cursor), None).complete);
        // One that read recently still gets the rest.
        let recent = format!("{}.{}", hub.epoch, KEPT);
        let changes = hub.since(church, Some(&recent), None);
        assert!(changes.complete);
        assert_eq!(changes.songs.len(), 1);
    }

    #[tokio::test]
    async fn a_change_wakes_a_waiting_reader() {
        let hub = std::sync::Arc::new(ChangeHub::default());
        let mut changed = hub.changes.subscribe();
        let writer = hub.clone();
        let church = Uuid::new_v4();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            writer.set(church, Uuid::new_v4(), None);
        });
        tokio::time::timeout(Duration::from_secs(2), changed.changed())
            .await
            .expect("woken")
            .expect("open");
    }
}
