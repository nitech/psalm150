use std::path::PathBuf;

use rusqlite::{params, Connection};

pub struct CcliLog {
    conn: Connection,
}

impl CcliLog {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                title TEXT NOT NULL,
                ccli TEXT,
                used_at TEXT NOT NULL
            );",
        )
        .map_err(|e| e.to_string())?;
        Ok(Self { conn })
    }

    pub fn log(&self, filename: &str, title: &str, ccli: Option<&str>) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn
            .execute(
                "INSERT INTO usage (filename, title, ccli, used_at) VALUES (?1, ?2, ?3, ?4)",
                params![filename, title, ccli, now],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn export_csv(&self, from: &str, to: &str) -> Result<String, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT filename, title, ccli, used_at FROM usage
                 WHERE used_at >= ?1 AND used_at <= ?2 ORDER BY used_at",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![from, to], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut csv = String::from("filename,title,ccli,used_at\n");
        for row in rows {
            let (filename, title, ccli, used_at) = row.map_err(|e| e.to_string())?;
            csv.push_str(&format!(
                "\"{}\",\"{}\",\"{}\",\"{}\"\n",
                filename,
                title.replace('"', "\"\""),
                ccli.unwrap_or_default().replace('"', "\"\""),
                used_at
            ));
        }
        Ok(csv)
    }
}
