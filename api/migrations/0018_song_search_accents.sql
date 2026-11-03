-- Song search ignores accents: `e` finds `é`, `u` finds `ü`. Letters are
-- decomposed (NFD) and their accent marks dropped. `å` is a letter of its own
-- in Norwegian, so it is kept (`æ` and `ø` do not decompose). Keep this in step
-- with `normalize_search` in api.rs.
--
-- The stored column is computed with the function, so it is dropped and added
-- again to recompute every revision.
ALTER TABLE song_revisions DROP COLUMN search_text;

CREATE OR REPLACE FUNCTION song_search_text(t text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    RETURN btrim(regexp_replace(
        regexp_replace(
            replace(
                regexp_replace(
                    normalize(replace(normalize(lower(t), NFC), 'å', chr(1)), NFD),
                    '[̀-ͯ]', '', 'g'),
                chr(1), 'å'),
            '[''’‘`´ʼ]', '', 'g'),
        '[^[:alnum:]]+', ' ', 'g'));

ALTER TABLE song_revisions ADD COLUMN search_text TEXT GENERATED ALWAYS AS (
    song_search_text(
        title || ' ' || authors || ' ' || coalesce(song_number, '') || ' '
        || regexp_replace(chordpro, '\[[^]]*\]|\{[^}]*\}', '', 'g'))
) STORED;

CREATE INDEX song_revisions_search_text_trgm_idx
    ON song_revisions USING gin (search_text gin_trgm_ops);
