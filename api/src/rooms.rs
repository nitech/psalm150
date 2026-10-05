//! Rooms: every desktop has a short name, a flower unless someone chose
//! another, that leaders pick it by in the remote and that anyone may type
//! to follow the words it projects on their own phone, for instance people
//! who cannot read the screen.
//!
//! A desktop keeps its name until someone renames it (at the desktop, or a
//! leader on the web) or the desktop is revoked, which frees the name.
//! Names are unique on the server and matched without regard to case,
//! accents, spaces or punctuation (`room_key`).
//!
//! Following a room needs no account: `GET /public/rooms/{room_name}` and its
//! `/events` stream show the words while the desktop projects, unless the
//! church's owner closed its rooms or the desktop's operator stopped sharing.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::HeaderMap,
    response::Response,
    routing::{get, put},
};
use sqlx::{Connection, PgConnection};
use uuid::Uuid;

use crate::{
    AppState,
    auth::authenticate,
    error::{AppError, ErrorBody},
    models::{DesktopRoom, RoomNameRequest, RoomView},
    remote::{event_stream, live_events, require_device},
};

/// Room names handed out to desktops. Common, easy to spell and to say, and
/// without accents so that they are easy to type on any phone.
pub const FLOWERS: &[&str] = &[
    "Acacia",
    "Allium",
    "Alyssum",
    "Amaryllis",
    "Anemone",
    "Aster",
    "Azalea",
    "Begonia",
    "Bellflower",
    "Bluebell",
    "Bluebonnet",
    "Borage",
    "Buttercup",
    "Calendula",
    "Calla",
    "Camellia",
    "Carnation",
    "Celosia",
    "Chamomile",
    "Clover",
    "Columbine",
    "Coneflower",
    "Cornflower",
    "Cosmos",
    "Crocus",
    "Cyclamen",
    "Daffodil",
    "Dahlia",
    "Daisy",
    "Dandelion",
    "Dianthus",
    "Edelweiss",
    "Foxglove",
    "Freesia",
    "Fuchsia",
    "Gardenia",
    "Gentian",
    "Geranium",
    "Gerbera",
    "Gladiolus",
    "Goldenrod",
    "Heather",
    "Heliotrope",
    "Hellebore",
    "Hepatica",
    "Hibiscus",
    "Hollyhock",
    "Honeysuckle",
    "Hyacinth",
    "Hydrangea",
    "Iris",
    "Jacaranda",
    "Jasmine",
    "Jonquil",
    "Lantana",
    "Larkspur",
    "Lavender",
    "Lilac",
    "Lily",
    "Linnea",
    "Lobelia",
    "Lotus",
    "Lupin",
    "Magnolia",
    "Mallow",
    "Marigold",
    "Meadowsweet",
    "Mimosa",
    "Myrtle",
    "Narcissus",
    "Nasturtium",
    "Oleander",
    "Orchid",
    "Pansy",
    "Peony",
    "Periwinkle",
    "Petunia",
    "Phlox",
    "Plumeria",
    "Poppy",
    "Primrose",
    "Protea",
    "Ranunculus",
    "Rose",
    "Rosemary",
    "Saffron",
    "Salvia",
    "Snapdragon",
    "Snowdrop",
    "Speedwell",
    "Starflower",
    "Sunflower",
    "Tansy",
    "Thistle",
    "Trillium",
    "Tulip",
    "Valerian",
    "Verbena",
    "Violet",
    "Wallflower",
    "Windflower",
    "Wisteria",
    "Woodbine",
    "Yarrow",
    "Zinnia",
];

const MIN_ROOM_CHARS: usize = 2;
const MAX_ROOM_CHARS: usize = 30;
/// Tries at a random name before giving up, should other desktops keep
/// taking the one picked at the same moment.
const ASSIGN_ATTEMPTS: usize = 5;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/remote/desktop/room", put(rename_own_room))
        .route("/device-tokens/{device_id}/room", put(rename_room))
        .route("/public/rooms/{room_name}", get(get_room))
        .route("/public/rooms/{room_name}/events", get(room_events))
}

/// What a room name is matched by: lower case, accents taken off, and only
/// letters and digits, so "Lily", "lily" and "LILY " are the same room, and
/// so are "Forget-me-not" and "forget me not".
pub fn room_key(name: &str) -> String {
    let mut key = String::with_capacity(name.len());
    for character in name.chars().flat_map(char::to_lowercase) {
        let folded = match character {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ą' => "a",
            'æ' => "ae",
            'ç' | 'ć' | 'č' => "c",
            'ď' | 'ð' => "d",
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ę' | 'ě' => "e",
            'ì' | 'í' | 'î' | 'ï' | 'ī' => "i",
            'ł' => "l",
            'ñ' | 'ń' | 'ň' => "n",
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => "o",
            'œ' => "oe",
            'ř' => "r",
            'ś' | 'š' => "s",
            'ß' => "ss",
            'ť' => "t",
            'þ' => "th",
            'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' => "u",
            'ý' | 'ÿ' => "y",
            'ź' | 'ż' | 'ž' => "z",
            other if other.is_alphanumeric() => {
                key.push(other);
                continue;
            }
            _ => continue,
        };
        key.push_str(folded);
    }
    key
}

/// A name someone chose, tidied: spaces collapsed, and only letters, digits,
/// spaces, hyphens and apostrophes. Returns the name and its key.
pub fn clean_room_name(name: &str) -> Result<(String, String), AppError> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    let allowed = name.chars().all(|character| {
        character.is_alphanumeric() || matches!(character, ' ' | '-' | '\'' | '’')
    });
    let length = name.chars().count();
    let key = room_key(&name);
    if !allowed
        || !(MIN_ROOM_CHARS..=MAX_ROOM_CHARS).contains(&length)
        || key.chars().count() < MIN_ROOM_CHARS
    {
        return Err(AppError::BadRequest(format!(
            "a room name has {MIN_ROOM_CHARS} to {MAX_ROOM_CHARS} letters, digits, spaces, \
             hyphens or apostrophes"
        )));
    }
    Ok((name, key))
}

/// Gives the desktop a room name: `requested`, or a random flower that no
/// other desktop uses. A requested name another desktop has is a `409`.
pub async fn assign_room_name(
    connection: &mut PgConnection,
    device_id: Uuid,
    requested: Option<&str>,
) -> Result<String, AppError> {
    if let Some(requested) = requested {
        let (name, key) = clean_room_name(requested)?;
        if set_room_name(connection, device_id, &name, &key).await? {
            return Ok(name);
        }
        return Err(AppError::Conflict(format!(
            "another desktop is already called {name}"
        )));
    }
    for _ in 0..ASSIGN_ATTEMPTS {
        let taken = sqlx::query_scalar::<_, String>(
            "SELECT room_key FROM device_tokens
             WHERE revoked_at IS NULL AND room_key IS NOT NULL AND id <> $1",
        )
        .bind(device_id)
        .fetch_all(&mut *connection)
        .await?;
        let name = free_flower(&taken);
        let key = room_key(&name);
        if set_room_name(connection, device_id, &name, &key).await? {
            return Ok(name);
        }
    }
    Err(AppError::Conflict(
        "could not find a free room name; try again".into(),
    ))
}

/// A random flower no one has, or with all of them taken, a numbered one
/// ("Lily 2").
fn free_flower(taken: &[String]) -> String {
    let random = |count: usize| (Uuid::new_v4().as_u128() % count as u128) as usize;
    let is_free = |name: &String| !taken.contains(&room_key(name));
    for number in 1.. {
        let free = FLOWERS
            .iter()
            .map(|flower| {
                if number == 1 {
                    (*flower).to_string()
                } else {
                    format!("{flower} {number}")
                }
            })
            .filter(is_free)
            .collect::<Vec<_>>();
        if !free.is_empty() {
            return free[random(free.len())].clone();
        }
    }
    unreachable!("some numbered flower is always free")
}

/// False when another desktop already has the name. Runs in a savepoint, so
/// a clash does not spoil a surrounding transaction.
async fn set_room_name(
    connection: &mut PgConnection,
    device_id: Uuid,
    name: &str,
    key: &str,
) -> Result<bool, AppError> {
    let mut savepoint = connection.begin().await?;
    let updated = sqlx::query(
        "UPDATE device_tokens SET room_name = $1, room_key = $2
         WHERE id = $3 AND revoked_at IS NULL",
    )
    .bind(name)
    .bind(key)
    .bind(device_id)
    .execute(&mut *savepoint)
    .await;
    match updated {
        Ok(result) if result.rows_affected() == 0 => {
            Err(AppError::NotFound("desktop was not found".into()))
        }
        Ok(_) => {
            savepoint.commit().await?;
            Ok(true)
        }
        Err(sqlx::Error::Database(error)) if error.is_unique_violation() => {
            savepoint.rollback().await?;
            Ok(false)
        }
        Err(error) => Err(error.into()),
    }
}

/// Who a desktop is, for the remote relay.
pub struct DesktopIdentity {
    pub church_id: Uuid,
    pub name: String,
    pub room_name: String,
    /// The church shares its projections in rooms.
    pub rooms_open: bool,
}

#[derive(sqlx::FromRow)]
struct IdentityRow {
    church_id: Uuid,
    name: String,
    room_name: Option<String>,
    public_rooms: bool,
}

/// The desktop's names and its church's room setting. A desktop made before
/// rooms gets its room name here.
pub async fn desktop_identity(
    state: &AppState,
    device_id: Uuid,
) -> Result<DesktopIdentity, AppError> {
    let row = sqlx::query_as::<_, IdentityRow>(
        "SELECT d.church_id, d.name, d.room_name, c.public_rooms
         FROM device_tokens d
         JOIN churches c ON c.id = d.church_id
         WHERE d.id = $1",
    )
    .bind(device_id)
    .fetch_one(&state.pool)
    .await?;
    let room_name = match row.room_name {
        Some(room_name) => room_name,
        None => {
            let mut connection = state.pool.acquire().await?;
            assign_room_name(&mut connection, device_id, None).await?
        }
    };
    Ok(DesktopIdentity {
        church_id: row.church_id,
        name: row.name,
        room_name,
        rooms_open: row.public_rooms,
    })
}

fn desktop_room(device_id: Uuid, identity: DesktopIdentity) -> DesktopRoom {
    DesktopRoom {
        device_id,
        room_name: identity.room_name,
        public_rooms: identity.rooms_open,
    }
}

/// The desktop asking: its room.
#[utoipa::path(
    get,
    path = "/api/v1/remote/desktop",
    security(("bearer" = [])),
    responses((status = 200, body = DesktopRoom), (status = 403, body = ErrorBody))
)]
pub async fn own_room(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<DesktopRoom>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let device_id = require_device(&auth)?;
    let identity = desktop_identity(&state, device_id).await?;
    Ok(Json(desktop_room(device_id, identity)))
}

/// The desktop renames its own room; a left-out `room_name` picks a new
/// random flower.
#[utoipa::path(
    put,
    path = "/api/v1/remote/desktop/room",
    security(("bearer" = [])),
    request_body = RoomNameRequest,
    responses(
        (status = 200, body = DesktopRoom),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn rename_own_room(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<RoomNameRequest>,
) -> Result<Json<DesktopRoom>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    let device_id = require_device(&auth)?;
    rename(&state, device_id, request).await
}

/// A leader renames one of the church's desktops' rooms; a left-out
/// `room_name` picks a new random flower.
#[utoipa::path(
    put,
    path = "/api/v1/device-tokens/{device_id}/room",
    security(("bearer" = [])),
    params(("device_id" = Uuid, Path)),
    request_body = RoomNameRequest,
    responses(
        (status = 200, body = DesktopRoom),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub async fn rename_room(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<Uuid>,
    Json(request): Json<RoomNameRequest>,
) -> Result<Json<DesktopRoom>, AppError> {
    let auth = authenticate(&headers, &state).await?;
    auth.require_editor()?;
    let ours = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM device_tokens
         WHERE id = $1 AND church_id = $2 AND revoked_at IS NULL)",
    )
    .bind(device_id)
    .bind(auth.church_id)
    .fetch_one(&state.pool)
    .await?;
    if !ours {
        return Err(AppError::NotFound("desktop was not found".into()));
    }
    rename(&state, device_id, request).await
}

async fn rename(
    state: &AppState,
    device_id: Uuid,
    request: RoomNameRequest,
) -> Result<Json<DesktopRoom>, AppError> {
    let requested = request
        .room_name
        .as_deref()
        .filter(|name| !name.trim().is_empty());
    let mut connection = state.pool.acquire().await?;
    let room_name = assign_room_name(&mut connection, device_id, requested).await?;
    drop(connection);
    state.remote.rename_room(device_id, &room_name);
    let identity = desktop_identity(state, device_id).await?;
    Ok(Json(desktop_room(device_id, identity)))
}

/// The desktop whose room this is, and the room's name as stored. Rooms of a
/// church that closed them are not found, just like names no one has.
async fn find_room(state: &AppState, room_name: &str) -> Result<(Uuid, String), AppError> {
    let not_found = || AppError::NotFound(format!("there is no room called {}", room_name.trim()));
    let key = room_key(room_name);
    if key.is_empty() {
        return Err(not_found());
    }
    sqlx::query_as::<_, (Uuid, String)>(
        "SELECT d.id, d.room_name
         FROM device_tokens d
         JOIN churches c ON c.id = d.church_id AND c.public_rooms
         WHERE d.room_key = $1 AND d.revoked_at IS NULL",
    )
    .bind(key)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(not_found)
}

/// Anyone: what the room shows now. Words are included only while the
/// desktop projects and shares them.
#[utoipa::path(
    get,
    path = "/api/v1/public/rooms/{room_name}",
    params(("room_name" = String, Path)),
    responses((status = 200, body = RoomView), (status = 404, body = ErrorBody))
)]
pub async fn get_room(
    State(state): State<AppState>,
    Path(room_name): Path<String>,
) -> Result<Json<RoomView>, AppError> {
    let (device_id, room_name) = find_room(&state, &room_name).await?;
    Ok(Json(state.remote.room_view(device_id, &room_name)))
}

/// Anyone: the room as server-sent events, for `EventSource`. A `room` event
/// carries the same `RoomView` as `GET /public/rooms/{room_name}`, straight
/// away and whenever it changes.
#[utoipa::path(
    get,
    path = "/api/v1/public/rooms/{room_name}/events",
    params(("room_name" = String, Path)),
    responses(
        (status = 200, content_type = "text/event-stream", body = RoomView),
        (status = 404, body = ErrorBody)
    )
)]
pub async fn room_events(
    State(state): State<AppState>,
    Path(room_name): Path<String>,
) -> Result<Response, AppError> {
    let (device_id, room_name) = find_room(&state, &room_name).await?;
    let hub = state.remote.clone();
    let events = live_events(state.remote.subscribe(), "room", move || {
        let view = hub.room_view(device_id, &room_name);
        async move { serde_json::to_string(&view).ok() }
    });
    Ok(event_stream(events))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_ignore_case_accents_and_spacing() {
        assert_eq!(room_key("Lily"), "lily");
        assert_eq!(room_key("  LILY "), "lily");
        assert_eq!(room_key("Forget-me-not"), "forgetmenot");
        assert_eq!(room_key("Blåklokke"), "blaklokke");
        assert_eq!(room_key("Hjertegræs"), "hjertegraes");
        assert_eq!(room_key("Lily 2"), "lily2");
    }

    #[test]
    fn flowers_are_distinct_and_valid() {
        let mut keys = FLOWERS
            .iter()
            .map(|flower| room_key(flower))
            .collect::<Vec<_>>();
        keys.sort();
        keys.dedup();
        assert_eq!(keys.len(), FLOWERS.len());
        for flower in FLOWERS {
            assert!(clean_room_name(flower).is_ok(), "{flower}");
            assert!(flower.is_ascii(), "{flower}");
        }
    }

    #[test]
    fn chosen_names_are_tidied_and_checked() {
        assert_eq!(
            clean_room_name("  Main   hall ").expect("valid").0,
            "Main hall"
        );
        assert!(clean_room_name("A").is_err());
        assert!(clean_room_name("--").is_err());
        assert!(clean_room_name("<script>").is_err());
        assert!(clean_room_name(&"x".repeat(31)).is_err());
    }

    #[test]
    fn free_flowers_skip_taken_names_and_then_number() {
        let all = FLOWERS
            .iter()
            .map(|flower| room_key(flower))
            .collect::<Vec<_>>();
        let mut taken = all[1..].to_vec();
        assert_eq!(free_flower(&taken), FLOWERS[0]);
        taken.push(all[0].clone());
        let numbered = free_flower(&taken);
        assert!(numbered.ends_with(" 2"), "{numbered}");
    }
}
