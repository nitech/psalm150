-- Each person's favourite songs in a church. A desktop's favourites are
-- those of the person who connected it (device_tokens.created_by).
CREATE TABLE song_favorites (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    church_id UUID NOT NULL,
    song_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, song_id),
    FOREIGN KEY (song_id, church_id) REFERENCES songs(id, church_id) ON DELETE CASCADE
);

CREATE INDEX song_favorites_church_user_idx ON song_favorites (church_id, user_id);
