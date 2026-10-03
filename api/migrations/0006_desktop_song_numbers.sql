-- The desktop writes a song's number as `{meta: song_num=227}`, which the
-- metadata extraction did not read. Fill in the extracted column for
-- revisions stored before it did; the ChordPro source is not touched.
UPDATE song_revisions
SET song_number = nullif(trim(substring(chordpro FROM '(?in)^\s*\{\s*meta\s*:\s*song_num\s*=([^}]*)\}')), '')
WHERE song_number IS NULL;
