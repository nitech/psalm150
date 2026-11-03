-- Song search ignores case and punctuation and tolerates typos.
--
-- `search_text` holds a revision's title, authors, number and lyrics as plain
-- lowercase words: apostrophes are dropped (`It’s` and `It's` are `its`),
-- other punctuation becomes a space, and ChordPro chords and directives are
-- left out, so a line matches across the chords in it. The search is
-- normalized the same way (`normalize_search` in api.rs) and matched as a
-- substring; when nothing matches, the trigram word similarity finds songs
-- with a misspelled word.
CREATE FUNCTION song_search_text(t text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    RETURN btrim(regexp_replace(
        regexp_replace(lower(t), '[''’‘`´ʼ]', '', 'g'),
        '[^[:alnum:]]+', ' ', 'g'));

ALTER TABLE song_revisions ADD COLUMN search_text TEXT GENERATED ALWAYS AS (
    song_search_text(
        title || ' ' || authors || ' ' || coalesce(song_number, '') || ' '
        || regexp_replace(chordpro, '\[[^]]*\]|\{[^}]*\}', '', 'g'))
) STORED;

CREATE INDEX song_revisions_search_text_trgm_idx
    ON song_revisions USING gin (search_text gin_trgm_ops);
