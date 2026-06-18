use std::path::PathBuf;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::library::chordpro::ParsedSong;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongRow {
    pub id: i64,
    pub filename: String,
    pub title: String,
    pub title_sort: String,
    pub song_num: Option<i64>,
    pub key: Option<String>,
    pub category: Option<String>,
    pub tags: Option<String>,
    pub ccli: Option<String>,
    pub modified_at: Option<String>,
    pub favorite: bool,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS songs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    title_sort TEXT NOT NULL,
                    song_num INTEGER,
                    key TEXT,
                    category TEXT,
                    tags TEXT,
                    ccli TEXT,
                    body_plain TEXT NOT NULL,
                    modified_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_songs_num ON songs(song_num);
                CREATE INDEX IF NOT EXISTS idx_songs_key ON songs(key);
                CREATE INDEX IF NOT EXISTS idx_songs_category ON songs(category);
                CREATE VIRTUAL TABLE IF NOT EXISTS song_search USING fts5(
                    filename UNINDEXED,
                    title,
                    body_plain,
                    tags,
                    content='songs',
                    content_rowid='id'
                );
                CREATE TABLE IF NOT EXISTS history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL,
                    title TEXT NOT NULL,
                    accessed_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS favorites (
                    filename TEXT PRIMARY KEY
                );
                ",
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn rebuild_from_songs(&self, songs: &[ParsedSong]) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM songs", []).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM song_search", []).map_err(|e| e.to_string())?;

        for song in songs {
            let body_plain = plain_body(song);
            let title_sort = song.meta.title.to_uppercase();
            tx.execute(
                "INSERT INTO songs (filename, title, title_sort, song_num, key, category, tags, ccli, body_plain, modified_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    song.meta.filename,
                    song.meta.title,
                    title_sort,
                    song.meta.song_num,
                    song.meta.key,
                    song.meta.category,
                    song.meta.tags,
                    song.meta.ccli,
                    body_plain,
                    song.meta.modified_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        tx.execute(
            "INSERT INTO song_search(rowid, filename, title, body_plain, tags)
             SELECT id, filename, title, body_plain, COALESCE(tags, '') FROM songs",
            [],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn upsert_song(&self, song: &ParsedSong) -> Result<(), String> {
        let body_plain = plain_body(song);
        let title_sort = song.meta.title.to_uppercase();
        self.conn
            .execute(
                "INSERT INTO songs (filename, title, title_sort, song_num, key, category, tags, ccli, body_plain, modified_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(filename) DO UPDATE SET
                   title=excluded.title,
                   title_sort=excluded.title_sort,
                   song_num=excluded.song_num,
                   key=excluded.key,
                   category=excluded.category,
                   tags=excluded.tags,
                   ccli=excluded.ccli,
                   body_plain=excluded.body_plain,
                   modified_at=excluded.modified_at",
                params![
                    song.meta.filename,
                    song.meta.title,
                    title_sort,
                    song.meta.song_num,
                    song.meta.key,
                    song.meta.category,
                    song.meta.tags,
                    song.meta.ccli,
                    body_plain,
                    song.meta.modified_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        self.rebuild_fts_for_filename(&song.meta.filename)?;
        Ok(())
    }

    fn rebuild_fts_for_filename(&self, filename: &str) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM song_search WHERE filename = ?1",
                params![filename],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "INSERT INTO song_search(rowid, filename, title, body_plain, tags)
                 SELECT id, filename, title, body_plain, COALESCE(tags, '') FROM songs WHERE filename = ?1",
                params![filename],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_song(&self, filename: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM songs WHERE filename = ?1", params![filename])
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "DELETE FROM song_search WHERE filename = ?1",
                params![filename],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn search(&self, query: &str, favorites_only: bool) -> Result<Vec<SongRow>, String> {
        if query.trim().is_empty() {
            return self.list_all(favorites_only);
        }
        let like = format!("%{query}%");
        let sql = if favorites_only {
            "SELECT s.id, s.filename, s.title, s.title_sort, s.song_num, s.key, s.category, s.tags, s.ccli, s.modified_at,
                    1 as favorite
             FROM songs s
             INNER JOIN favorites f ON f.filename = s.filename
             WHERE s.title LIKE ?1 OR s.body_plain LIKE ?1 OR s.tags LIKE ?1
             ORDER BY s.title_sort"
        } else {
            "SELECT s.id, s.filename, s.title, s.title_sort, s.song_num, s.key, s.category, s.tags, s.ccli, s.modified_at,
                    CASE WHEN f.filename IS NOT NULL THEN 1 ELSE 0 END as favorite
             FROM songs s
             LEFT JOIN favorites f ON f.filename = s.filename
             WHERE s.title LIKE ?1 OR s.body_plain LIKE ?1 OR s.tags LIKE ?1
             ORDER BY s.title_sort"
        };
        let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![like], map_song_row)
            .map_err(|e| e.to_string())?;
        collect_rows(rows)
    }

    pub fn list_all(&self, favorites_only: bool) -> Result<Vec<SongRow>, String> {
        let sql = if favorites_only {
            "SELECT s.id, s.filename, s.title, s.title_sort, s.song_num, s.key, s.category, s.tags, s.ccli, s.modified_at,
                    1 as favorite
             FROM songs s INNER JOIN favorites f ON f.filename = s.filename
             ORDER BY s.title_sort"
        } else {
            "SELECT s.id, s.filename, s.title, s.title_sort, s.song_num, s.key, s.category, s.tags, s.ccli, s.modified_at,
                    CASE WHEN f.filename IS NOT NULL THEN 1 ELSE 0 END as favorite
             FROM songs s
             LEFT JOIN favorites f ON f.filename = s.filename
             ORDER BY s.title_sort"
        };
        let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], map_song_row).map_err(|e| e.to_string())?;
        collect_rows(rows)
    }

    pub fn list_by_key(&self, key: &str) -> Result<Vec<SongRow>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT s.id, s.filename, s.title, s.title_sort, s.song_num, s.key, s.category, s.tags, s.ccli, s.modified_at,
                        CASE WHEN f.filename IS NOT NULL THEN 1 ELSE 0 END as favorite
                 FROM songs s
                 LEFT JOIN favorites f ON f.filename = s.filename
                 WHERE s.key = ?1
                 ORDER BY s.title_sort",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![key], map_song_row)
            .map_err(|e| e.to_string())?;
        collect_rows(rows)
    }

    pub fn list_categories(&self) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT DISTINCT category FROM songs WHERE category IS NOT NULL AND category != '' ORDER BY category",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn list_by_category(&self, category: &str) -> Result<Vec<SongRow>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT s.id, s.filename, s.title, s.title_sort, s.song_num, s.key, s.category, s.tags, s.ccli, s.modified_at,
                        CASE WHEN f.filename IS NOT NULL THEN 1 ELSE 0 END as favorite
                 FROM songs s
                 LEFT JOIN favorites f ON f.filename = s.filename
                 WHERE s.category = ?1
                 ORDER BY s.song_num, s.title_sort",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![category], map_song_row)
            .map_err(|e| e.to_string())?;
        collect_rows(rows)
    }

    pub fn add_history(&self, filename: &str, title: &str) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn
            .execute(
                "INSERT INTO history (filename, title, accessed_at) VALUES (?1, ?2, ?3)",
                params![filename, title, now],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_history(&self, limit: i64) -> Result<Vec<(String, String, String)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT filename, title, accessed_at FROM history ORDER BY accessed_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn toggle_favorite(&self, filename: &str) -> Result<bool, String> {
        let exists: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM favorites WHERE filename = ?1",
                params![filename],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists > 0 {
            self.conn
                .execute("DELETE FROM favorites WHERE filename = ?1", params![filename])
                .map_err(|e| e.to_string())?;
            Ok(false)
        } else {
            self.conn
                .execute(
                    "INSERT INTO favorites (filename) VALUES (?1)",
                    params![filename],
                )
                .map_err(|e| e.to_string())?;
            Ok(true)
        }
    }

    pub fn list_favorites(&self) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT filename FROM favorites ORDER BY filename")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn vacuum(&self) -> Result<(), String> {
        self.conn
            .execute_batch("VACUUM;")
            .map_err(|e| e.to_string())
    }

    pub fn all_filenames(&self) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT filename FROM songs ORDER BY filename")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
}

fn map_song_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SongRow> {
    Ok(SongRow {
        id: row.get(0)?,
        filename: row.get(1)?,
        title: row.get(2)?,
        title_sort: row.get(3)?,
        song_num: row.get(4)?,
        key: row.get(5)?,
        category: row.get(6)?,
        tags: row.get(7)?,
        ccli: row.get(8)?,
        modified_at: row.get(9)?,
        favorite: row.get::<_, i64>(10)? != 0,
    })
}

fn collect_rows(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<SongRow>>,
) -> Result<Vec<SongRow>, String> {
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn plain_body(song: &ParsedSong) -> String {
    song.sections
        .iter()
        .flat_map(|s| s.lines.iter().map(|l| l.text.clone()))
        .collect::<Vec<_>>()
        .join("\n")
}
