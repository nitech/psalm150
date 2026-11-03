-- Desktops record how a song is played too (the Psalm150 app, through its
-- device token). Such a recording names the desktop instead of a person.
ALTER TABLE song_recordings
    ADD COLUMN created_by_device UUID REFERENCES device_tokens(id) ON DELETE SET NULL;
