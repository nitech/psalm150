-- How far each person moves a song when they read it, in semitones: up
-- (positive) or down. A desktop's are those of the person who connected it,
-- as with favourites. Reading a song as written keeps no row.
CREATE TABLE song_transpositions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    church_id UUID NOT NULL,
    song_id UUID NOT NULL,
    semitones SMALLINT NOT NULL CHECK (semitones BETWEEN -11 AND 11 AND semitones <> 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, song_id),
    FOREIGN KEY (song_id, church_id) REFERENCES songs(id, church_id) ON DELETE CASCADE
);

CREATE INDEX song_transpositions_church_user_idx ON song_transpositions (church_id, user_id);
