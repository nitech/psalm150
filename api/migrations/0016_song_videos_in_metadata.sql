-- A song's YouTube video is now song metadata, `{meta: youtube <link>}` in
-- its ChordPro, so it travels with the song (export, desktops). The table
-- for video links kept beside the song goes.
DROP TABLE song_videos;
