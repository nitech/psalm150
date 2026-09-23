//! Writes to a Visual Song Book database through the Microsoft Access ODBC
//! driver. `jetdb` only reads, so writing needs the Access Database Engine
//! (bundled with Office, or the free redistributable). Without it the sync is
//! one-way: VSB to Psalm150.

use std::path::Path;

use super::fields::VsbFields;

pub const DRIVER_MISSING: &str = "Writing to the VSB database needs the Microsoft Access Database Engine (64-bit). Install the Access Database Engine redistributable from Microsoft to sync changes back to Visual Song Book.";

pub trait VsbWriter {
    fn update(&mut self, song_id: i64, fields: &VsbFields) -> Result<(), String>;
    fn insert(&mut self, fields: &VsbFields) -> Result<i64, String>;
    fn delete(&mut self, song_id: i64) -> Result<(), String>;
}

#[cfg(windows)]
mod odbc {
    use std::path::Path;
    use std::sync::OnceLock;

    use std::num::NonZeroUsize;

    use odbc_api::parameter::{VarWCharBox, WithDataType};
    use odbc_api::{ConnectionOptions, Cursor, DataType, Environment, Nullable};

    use super::{VsbFields, VsbWriter, DRIVER_MISSING};

    fn environment() -> Result<&'static Environment, String> {
        static ENV: OnceLock<Result<Environment, String>> = OnceLock::new();
        ENV.get_or_init(|| Environment::new().map_err(|e| e.to_string()))
            .as_ref()
            .map_err(Clone::clone)
    }

    pub struct OdbcWriter {
        connection: odbc_api::Connection<'static>,
    }

    impl OdbcWriter {
        pub fn open(path: &Path) -> Result<Self, String> {
            let env = environment()?;
            let connection_string = format!(
                "Driver={{Microsoft Access Driver (*.mdb, *.accdb)}};Dbq={};",
                path.display()
            );
            let connection = env
                .connect_with_connection_string(&connection_string, ConnectionOptions::default())
                .map_err(|error| {
                    let message = error.to_string();
                    if message.contains("IM002") || message.contains("Data source name not found") {
                        DRIVER_MISSING.to_string()
                    } else {
                        format!("Could not open the VSB database for writing: {message}")
                    }
                })?;
            Ok(Self { connection })
        }
    }

    /// The Access driver refuses wide VARCHAR parameters over 255 characters
    /// ("Invalid precision value"), so longer text is bound as LONGVARCHAR.
    fn text(value: &str) -> WithDataType<VarWCharBox> {
        let length = NonZeroUsize::new(value.encode_utf16().count().max(1));
        let data_type = if length.is_some_and(|l| l.get() <= 255) {
            DataType::WVarchar { length }
        } else {
            DataType::WLongVarchar { length }
        };
        WithDataType::new(VarWCharBox::from_str_slice(value), data_type)
    }

    /// Optional columns are written as empty text: VSB marks some of them
    /// required (Copyright) while allowing zero-length values.
    fn optional_text(value: Option<&str>) -> WithDataType<VarWCharBox> {
        text(value.unwrap_or(""))
    }

    impl VsbWriter for OdbcWriter {
        fn update(&mut self, song_id: i64, fields: &VsbFields) -> Result<(), String> {
            // A song without a number keeps the one VSB already has.
            let song_num = fields.song_num.map(|n| n as i32).unwrap_or(-1);
            self.connection
                .execute(
                    "UPDATE Songs SET Title = ?, [Key] = ?, Author = ?, Copyright = ?, \
                     CategoryId = ?, Body = ?, Search = ?, Modified = Now() WHERE SongID = ?",
                    (
                        &text(&fields.title),
                        &optional_text(fields.key.as_deref()),
                        &optional_text(fields.author.as_deref()),
                        &optional_text(fields.copyright.as_deref()),
                        &(fields.category_id as i32),
                        &text(&fields.body),
                        &text(&fields.search_text()),
                        &(song_id as i32),
                    ),
                    None,
                )
                .map_err(|e| format!("Could not update VSB song {song_id}: {e}"))?;
            if song_num > 0 {
                self.connection
                    .execute(
                        "UPDATE Songs SET SongNum = ? WHERE SongID = ?",
                        (&song_num, &(song_id as i32)),
                        None,
                    )
                    .map_err(|e| format!("Could not update VSB song {song_id}: {e}"))?;
            }
            Ok(())
        }

        fn insert(&mut self, fields: &VsbFields) -> Result<i64, String> {
            let song_num = match fields.song_num {
                Some(n) => n as i32,
                None => self.next_song_num()?,
            };
            self.connection
                .execute(
                    "INSERT INTO Songs (SongNum, Title, [Key], Author, Copyright, CategoryId, Body, Search, Modified) \
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, Now())",
                    (
                        &song_num,
                        &text(&fields.title),
                        &optional_text(fields.key.as_deref()),
                        &optional_text(fields.author.as_deref()),
                        &optional_text(fields.copyright.as_deref()),
                        &(fields.category_id as i32),
                        &text(&fields.body),
                        &text(&fields.search_text()),
                    ),
                    None,
                )
                .map_err(|e| format!("Could not add \"{}\" to VSB: {e}", fields.title))?;
            self.scalar("SELECT @@IDENTITY")
                .map(i64::from)
                .map_err(|e| format!("Could not read the new VSB song id: {e}"))
        }

        fn delete(&mut self, song_id: i64) -> Result<(), String> {
            self.connection
                .execute(
                    "DELETE FROM Songs WHERE SongID = ?",
                    &(song_id as i32),
                    None,
                )
                .map_err(|e| format!("Could not delete VSB song {song_id}: {e}"))?;
            Ok(())
        }
    }

    impl OdbcWriter {
        fn next_song_num(&self) -> Result<i32, String> {
            self.scalar("SELECT IIF(MAX(SongNum) IS NULL, 0, MAX(SongNum)) + 1 FROM Songs")
        }

        fn scalar(&self, sql: &str) -> Result<i32, String> {
            let mut cursor = self
                .connection
                .execute(sql, (), None)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "The query returned no result".to_string())?;
            let mut row = cursor
                .next_row()
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "The query returned no rows".to_string())?;
            let mut value = Nullable::<i32>::null();
            row.get_data(1, &mut value).map_err(|e| e.to_string())?;
            value
                .into_opt()
                .ok_or_else(|| "The query returned NULL".to_string())
        }
    }
}

/// Open a writer for `path`, or explain why the database is read-only here.
pub fn open_writer(path: &Path) -> Result<Box<dyn VsbWriter>, String> {
    #[cfg(windows)]
    {
        Ok(Box::new(odbc::OdbcWriter::open(path)?))
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("Writing to a VSB database is only supported on Windows".into())
    }
}
