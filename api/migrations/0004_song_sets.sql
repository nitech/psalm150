-- Sets: an ordered list of songs for one service, shared by the whole church.
-- Leaders, owners and desktops edit them; viewers read them. Every write
-- sends the version it was based on, so a stale edit is a 409 rather than a
-- silent overwrite (the same rule as song revisions, without keeping history).
CREATE TABLE song_sets (
    id UUID PRIMARY KEY,
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    service_date DATE,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_device UUID REFERENCES device_tokens(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by_device UUID REFERENCES device_tokens(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX song_sets_church_date_idx
    ON song_sets (church_id, service_date DESC NULLS LAST, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE song_set_items (
    id UUID PRIMARY KEY,
    set_id UUID NOT NULL REFERENCES song_sets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('song', 'blank')),
    song_id UUID REFERENCES songs(id) ON DELETE SET NULL,
    transpose SMALLINT NOT NULL DEFAULT 0 CHECK (transpose BETWEEN -11 AND 11),
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    UNIQUE (set_id, position)
);

CREATE INDEX song_set_items_song_idx ON song_set_items (song_id);
