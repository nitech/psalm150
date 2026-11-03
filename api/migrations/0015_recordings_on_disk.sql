-- Recordings are now files under the media directory (`PSA150_MEDIA_DIR`);
-- the database keeps only their details. `audio` holds only recordings
-- saved before this, which the server moves out to files at startup and
-- then clears.
ALTER TABLE song_recordings ALTER COLUMN audio DROP NOT NULL;
