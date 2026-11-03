-- Desktop (device) tokens may edit and delete songs. Record which device
-- wrote a revision or deleted a song, alongside the existing person columns.
ALTER TABLE song_revisions
    ADD COLUMN created_by_device UUID REFERENCES device_tokens(id) ON DELETE SET NULL;

ALTER TABLE songs
    ADD COLUMN deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN deleted_by_device UUID REFERENCES device_tokens(id) ON DELETE SET NULL;
