-- Every desktop has a room: a short name (a flower by default) that people
-- type on their phones to follow its projection, and that leaders pick it
-- by. room_key is the name folded for matching (lower case, no accents,
-- spaces or punctuation). It is unique across the server, because a room is
-- joined without saying which church it belongs to, and only among desktops
-- that are not revoked, so revoking a desktop frees its name. Desktops made
-- before rooms get theirs the next time they talk to the server.
ALTER TABLE device_tokens ADD COLUMN room_name TEXT;
ALTER TABLE device_tokens ADD COLUMN room_key TEXT;
CREATE UNIQUE INDEX device_tokens_room_key_unique
    ON device_tokens (room_key) WHERE revoked_at IS NULL;

-- An owner may stop sharing the church's projections in rooms.
ALTER TABLE churches ADD COLUMN public_rooms BOOLEAN NOT NULL DEFAULT true;
