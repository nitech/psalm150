use std::fs;
use std::path::{Component, Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::config;

pub const TEMP_PREFIX: &str = ".psa150-tmp-";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryItem {
    pub id: String,
    pub original_filename: String,
    pub created_at: String,
}

pub fn content_hash(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

pub fn validate_song_filename(filename: &str) -> Result<(), String> {
    let path = Path::new(filename);
    let mut components = path.components();
    let one_name =
        matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();
    if !one_name || filename.starts_with(TEMP_PREFIX) {
        return Err("Invalid song filename".into());
    }
    if !crate::library::chordpro::is_chordpro_filename(filename) {
        return Err("Song filename must end in .pro or .cho".into());
    }
    Ok(())
}

pub fn song_path(folder: &Path, filename: &str) -> Result<PathBuf, String> {
    validate_song_filename(filename)?;
    Ok(folder.join(filename))
}

fn recovery_root(app: &tauri::AppHandle, folder_hash: &str) -> Result<PathBuf, String> {
    Ok(config::library_root(app, folder_hash)?.join("recovery"))
}

fn backup_existing(
    app: &tauri::AppHandle,
    folder_hash: &str,
    source: &Path,
    filename: &str,
) -> Result<RecoveryItem, String> {
    let id = Uuid::new_v4().to_string();
    let dir = recovery_root(app, folder_hash)?.join(&id);
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create recovery copy: {e}"))?;
    let destination = dir.join(filename);
    fs::copy(source, &destination).map_err(|e| format!("Could not create recovery copy: {e}"))?;
    let original = fs::read(source).map_err(|e| e.to_string())?;
    let copied = fs::read(&destination).map_err(|e| e.to_string())?;
    if original != copied {
        return Err("Recovery copy verification failed".into());
    }
    let item = RecoveryItem {
        id,
        original_filename: filename.to_string(),
        created_at: Utc::now().to_rfc3339(),
    };
    fs::write(
        dir.join("recovery.json"),
        serde_json::to_vec_pretty(&item).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(item)
}

pub fn replace_song(
    app: &tauri::AppHandle,
    folder_hash: &str,
    folder: &Path,
    filename: &str,
    content: &str,
    expected_hash: &str,
) -> Result<RecoveryItem, String> {
    let path = song_path(folder, filename)?;
    let current = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if content_hash(&current) != expected_hash {
        return Err("SONG_CHANGED_ON_DISK: Reload the song before saving".into());
    }
    let recovery = backup_existing(app, folder_hash, &path, filename)?;
    let temp = folder.join(format!("{TEMP_PREFIX}{}.pro", Uuid::new_v4()));
    let mut temp_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    use std::io::Write;
    if let Err(err) = temp_file
        .write_all(content.as_bytes())
        .and_then(|_| temp_file.sync_all())
    {
        drop(temp_file);
        let _ = fs::remove_file(&temp);
        return Err(err.to_string());
    }
    drop(temp_file);
    if fs::read_to_string(&temp).map_err(|e| e.to_string())? != content {
        let _ = fs::remove_file(&temp);
        return Err("Temporary song verification failed".into());
    }
    // Windows cannot rename over an existing file. The verified recovery copy
    // makes the short remove/rename interval recoverable.
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    if let Err(err) = fs::rename(&temp, &path) {
        let backup = recovery_root(app, folder_hash)?
            .join(&recovery.id)
            .join(filename);
        let _ = fs::copy(backup, &path);
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "Could not replace song; recovery copy restored: {err}"
        ));
    }
    Ok(recovery)
}

pub fn create_song_unique(folder: &Path, preferred: &str, content: &str) -> Result<String, String> {
    validate_song_filename(preferred)?;
    let preferred_path = Path::new(preferred);
    let stem = preferred_path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("song");
    let extension = preferred_path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("pro");
    for suffix in 0..10_000usize {
        let filename = if suffix == 0 {
            preferred.to_string()
        } else {
            format!("{stem}-{suffix}.{extension}")
        };
        let path = song_path(folder, &filename)?;
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                use std::io::Write;
                if let Err(err) = file
                    .write_all(content.as_bytes())
                    .and_then(|_| file.sync_all())
                {
                    drop(file);
                    let _ = fs::remove_file(&path);
                    return Err(err.to_string());
                }
                return Ok(filename);
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err.to_string()),
        }
    }
    Err("Could not find an available song filename".into())
}

pub fn delete_song_recoverable(
    app: &tauri::AppHandle,
    folder_hash: &str,
    folder: &Path,
    filename: &str,
) -> Result<RecoveryItem, String> {
    let path = song_path(folder, filename)?;
    let recovery = backup_existing(app, folder_hash, &path, filename)?;
    fs::remove_file(path).map_err(|e| e.to_string())?;
    Ok(recovery)
}

pub fn list_recovery(
    app: &tauri::AppHandle,
    folder_hash: &str,
) -> Result<Vec<RecoveryItem>, String> {
    let root = recovery_root(app, folder_hash)?;
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut items = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let path = entry
            .map_err(|e| e.to_string())?
            .path()
            .join("recovery.json");
        if let Ok(bytes) = fs::read(path) {
            if let Ok(item) = serde_json::from_slice::<RecoveryItem>(&bytes) {
                items.push(item);
            }
        }
    }
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(items)
}

pub fn restore_recovery(
    app: &tauri::AppHandle,
    folder_hash: &str,
    folder: &Path,
    id: &str,
) -> Result<String, String> {
    if Uuid::parse_str(id).is_err() {
        return Err("Invalid recovery id".into());
    }
    let dir = recovery_root(app, folder_hash)?.join(id);
    let item: RecoveryItem =
        serde_json::from_slice(&fs::read(dir.join("recovery.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    validate_song_filename(&item.original_filename)?;
    let content =
        fs::read_to_string(dir.join(&item.original_filename)).map_err(|e| e.to_string())?;
    create_song_unique(folder, &item.original_filename, &content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn song_filenames_cannot_escape_the_library() {
        assert!(validate_song_filename("song.pro").is_ok());
        assert!(validate_song_filename("song.cho").is_ok());
        assert!(validate_song_filename("../song.pro").is_err());
        assert!(validate_song_filename("folder/song.pro").is_err());
        assert!(validate_song_filename("song.txt").is_err());
        assert!(validate_song_filename(".psa150-tmp-one.pro").is_err());
    }

    #[test]
    fn unique_creation_never_overwrites_a_collision() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("12-song.pro"), "original").expect("fixture");
        let filename = create_song_unique(dir.path(), "12-song.pro", "new").expect("create");
        assert_eq!(filename, "12-song-1.pro");
        assert_eq!(
            fs::read_to_string(dir.path().join("12-song.pro")).unwrap(),
            "original"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join(filename)).unwrap(),
            "new"
        );
    }
}
