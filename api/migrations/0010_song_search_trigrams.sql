-- Song search matches `%q%` against the title, authors, number and the whole
-- ChordPro text. Without these, every search (anyone may search a public
-- library, signed in or not) reads every revision. Trigram indexes answer
-- it from the index once the search has a word of three letters or digits;
-- shorter searches skip the ChordPro text (see search_songs).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX song_revisions_title_trgm_idx
    ON song_revisions USING gin (title gin_trgm_ops);
CREATE INDEX song_revisions_authors_trgm_idx
    ON song_revisions USING gin (authors gin_trgm_ops);
CREATE INDEX song_revisions_number_trgm_idx
    ON song_revisions USING gin (song_number gin_trgm_ops);
CREATE INDEX song_revisions_chordpro_trgm_idx
    ON song_revisions USING gin (chordpro gin_trgm_ops);

-- The matching revisions are joined back to their songs by this.
CREATE INDEX songs_current_revision_idx ON songs (current_revision_id);
