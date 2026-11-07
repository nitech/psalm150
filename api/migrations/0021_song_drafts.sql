-- Each person's unsaved changes to a song, kept while they edit so that
-- leaving the editor never loses them: saved as a new revision, or
-- discarded, when they choose. song_id NULL is the song they are writing
-- that is not in the library yet (one per person and church).
CREATE TABLE song_drafts (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    song_id UUID,
    -- The revision the changes were made to; NULL for a new song.
    base_revision_id UUID,
    -- The title as the changes have it, for the list.
    title TEXT NOT NULL,
    chordpro TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT song_drafts_one_per_song UNIQUE NULLS NOT DISTINCT (user_id, church_id, song_id),
    FOREIGN KEY (song_id, church_id) REFERENCES songs(id, church_id) ON DELETE CASCADE
);
