-- A song's key, as its `{key}` directive writes it ("G", "F#m", "D / E"),
-- so song lists can show, sort and filter by it without reading the ChordPro.
ALTER TABLE song_revisions ADD COLUMN song_key TEXT;

-- Revisions stored before this read their key from the source, like the
-- metadata extraction does: `{key: X}`, else `{meta: key=X}`.
UPDATE song_revisions
SET song_key = coalesce(
    nullif(trim(substring(chordpro FROM '(?in)^\s*\{\s*key\s*:([^}]*)\}')), ''),
    nullif(trim(substring(chordpro FROM '(?in)^\s*\{\s*meta\s*:\s*key\s*=([^}]*)\}')), '')
);

-- The key's tonic as a pitch class, C = 0 to B = 11, so enharmonic spellings
-- (C# and Db) are one key. A compound key ("D / E") counts as its first.
-- H is the German and Nordic B. NULL when the key does not start with a note.
CREATE FUNCTION song_key_root(song_key TEXT) RETURNS SMALLINT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN (
    SELECT ((CASE upper(m[1])
                 WHEN 'C' THEN 0 WHEN 'D' THEN 2 WHEN 'E' THEN 4 WHEN 'F' THEN 5
                 WHEN 'G' THEN 7 WHEN 'A' THEN 9 WHEN 'B' THEN 11 WHEN 'H' THEN 11 END
             + CASE WHEN m[2] IN ('#', '♯') THEN 1 WHEN m[2] IN ('b', '♭') THEN -1 ELSE 0 END
             + 12) % 12)::smallint
    FROM regexp_match(song_key, '^\s*([A-Ha-h])([#♯b♭]?)') AS m
);

-- Whether the key is minor: "Am", "F#m7", "A moll", "a-moll", "C minor".
-- "Amaj7" and "A-dur" are major. NULL when there is no tonic.
CREATE FUNCTION song_key_minor(song_key TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN CASE
    WHEN song_key_root(song_key) IS NULL THEN NULL
    ELSE song_key ~* '^\s*[a-h][#♯b♭]?\s*-?\s*(m($|[^a])|min|moll)'
END;

ALTER TABLE song_revisions
    ADD COLUMN key_root SMALLINT GENERATED ALWAYS AS (song_key_root(song_key)) STORED,
    ADD COLUMN key_minor BOOLEAN GENERATED ALWAYS AS (song_key_minor(song_key)) STORED;
