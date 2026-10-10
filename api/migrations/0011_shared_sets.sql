-- A leader may share a set on a link: anyone who has it reads the set and its
-- songs without an account. share_key is the secret part of the link; it is
-- kept as it is (not hashed) so leaders can copy the link again, and it is
-- unique across the server because the link names no church. Stopping the
-- share clears it, so sharing again makes a new link and the old one stops
-- working. With share_editable, people with the link may also add songs to
-- the set and remove them.
ALTER TABLE song_sets ADD COLUMN share_key TEXT;
ALTER TABLE song_sets ADD COLUMN share_editable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE song_sets ADD COLUMN shared_at TIMESTAMPTZ;
CREATE UNIQUE INDEX song_sets_share_key_unique ON song_sets (share_key)
    WHERE share_key IS NOT NULL;
