-- Recordings of how a song is played, made by a leader or owner, and
-- links to YouTube videos of it. The audio is kept in the database itself,
-- so the server still needs nothing but PostgreSQL and a backup of it holds
-- everything. Both go with their song when it is purged.
CREATE TABLE song_recordings (
    id UUID PRIMARY KEY,
    church_id UUID NOT NULL,
    song_id UUID NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    -- As the browser recorded it: "audio/webm;codecs=opus", "audio/mp4".
    content_type TEXT NOT NULL,
    duration_ms INTEGER CHECK (duration_ms >= 0),
    byte_size INTEGER NOT NULL CHECK (byte_size > 0),
    audio BYTEA NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (song_id, church_id) REFERENCES songs(id, church_id) ON DELETE CASCADE
);

CREATE INDEX song_recordings_song_idx ON song_recordings (song_id, created_at);

CREATE TABLE song_videos (
    id UUID PRIMARY KEY,
    church_id UUID NOT NULL,
    song_id UUID NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    -- The 11-character YouTube id, and where in the video to start.
    video_id TEXT NOT NULL CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
    start_seconds INTEGER CHECK (start_seconds >= 0),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (song_id, church_id) REFERENCES songs(id, church_id) ON DELETE CASCADE
);

CREATE INDEX song_videos_song_idx ON song_videos (song_id, created_at);
