use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetlistItem {
    #[serde(rename = "type")]
    pub item_type: SetlistItemType,
    pub file: Option<String>,
    pub transpose: Option<i32>,
    pub arrangement: Option<String>,
    pub id: Option<String>,
    /// Free text for the team (from a song server set).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SetlistItemType {
    Song,
    Blank,
    Hold,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setlist {
    pub id: String,
    pub name: String,
    pub date: String,
    pub items: Vec<SetlistItem>,
    /// Present in a server library: how this setlist relates to the song
    /// server's set with the same id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server: Option<ServerSetState>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerSetState {
    /// The server version this copy is based on; `None` until first uploaded.
    pub version: Option<i32>,
    /// Changed on this PC and not yet accepted by the server.
    pub dirty: bool,
}

/// Setlist ids name files in the setlists folder and can come from the song
/// server or the phone remote, so only plain ids (UUIDs and the like) pass.
pub fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub struct SetlistStore {
    root: PathBuf,
    active: Option<Setlist>,
    item_index: usize,
    slide_index: usize,
}

impl SetlistStore {
    pub fn new(root: PathBuf) -> Self {
        let _ = fs::create_dir_all(&root);
        Self {
            root,
            active: None,
            item_index: 0,
            slide_index: 0,
        }
    }

    fn path(&self, id: &str) -> Result<PathBuf, String> {
        if !valid_id(id) {
            return Err(format!("Invalid setlist id: {id:?}"));
        }
        Ok(self.root.join(format!("{id}.json")))
    }

    pub fn list(&self) -> Result<Vec<Setlist>, String> {
        let mut lists: Vec<Setlist> = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.path().extension().and_then(|e| e.to_str()) == Some("json") {
                let text = fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
                lists.push(serde_json::from_str(&text).map_err(|e| e.to_string())?);
            }
        }
        lists.sort_by(|a, b| b.date.cmp(&a.date));
        Ok(lists)
    }

    pub fn save(&self, setlist: &Setlist) -> Result<(), String> {
        let path = self.path(&setlist.id)?;
        let text = serde_json::to_string_pretty(setlist).map_err(|e| e.to_string())?;
        fs::write(path, text).map_err(|e| e.to_string())
    }

    pub fn load(&mut self, id: &str) -> Result<Setlist, String> {
        let path = self.path(id)?;
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let setlist: Setlist = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        self.active = Some(setlist.clone());
        self.item_index = 0;
        self.slide_index = 0;
        Ok(setlist)
    }

    pub fn create(&mut self, name: &str, date: &str) -> Result<Setlist, String> {
        let setlist = Setlist {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            date: date.into(),
            items: vec![],
            server: None,
        };
        self.save(&setlist)?;
        self.active = Some(setlist.clone());
        self.item_index = 0;
        self.slide_index = 0;
        Ok(setlist)
    }

    /// Load, change and save one setlist; the active copy follows the change.
    pub fn update(
        &mut self,
        id: &str,
        change: impl FnOnce(&mut Setlist),
    ) -> Result<Setlist, String> {
        let path = self.path(id)?;
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let mut setlist: Setlist = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        change(&mut setlist);
        self.save(&setlist)?;
        if self
            .active
            .as_ref()
            .is_some_and(|active| active.id == setlist.id)
        {
            self.active = Some(setlist.clone());
        }
        Ok(setlist)
    }

    /// Read one setlist without making it active.
    pub fn get(&self, id: &str) -> Result<Setlist, String> {
        let path = self.path(id)?;
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| e.to_string())
    }

    /// Remove a setlist file; the active copy is cleared when it matches.
    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        let path = self.path(id)?;
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        if self.active.as_ref().is_some_and(|active| active.id == id) {
            self.active = None;
        }
        Ok(())
    }

    pub fn active(&self) -> Option<&Setlist> {
        self.active.as_ref()
    }

    pub fn active_mut(&mut self) -> Option<&mut Setlist> {
        self.active.as_mut()
    }

    pub fn item_index(&self) -> usize {
        self.item_index
    }

    pub fn slide_index(&self) -> usize {
        self.slide_index
    }

    pub fn set_slide_index(&mut self, index: usize) {
        self.slide_index = index;
    }

    pub fn references_file(&self, filename: &str) -> bool {
        self.list()
            .map(|setlists| {
                setlists.iter().any(|setlist| {
                    setlist
                        .items
                        .iter()
                        .any(|item| item.file.as_deref() == Some(filename))
                })
            })
            // A malformed setlist must not make deletion less safe.
            .unwrap_or(true)
    }

    pub fn advance_item(&mut self) -> bool {
        if let Some(setlist) = self.active.as_ref() {
            if self.item_index + 1 < setlist.items.len() {
                self.item_index += 1;
                self.slide_index = 0;
                return true;
            }
        }
        false
    }

    pub fn previous_item(&mut self) -> bool {
        if self.item_index > 0 {
            self.item_index -= 1;
            self.slide_index = 0;
            true
        } else {
            false
        }
    }
}

pub fn list_hold_slides(root: &Path) -> Result<Vec<String>, String> {
    let dir = root.join("hold_slides");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if let Some(name) = entry.file_name().to_str() {
            ids.push(name.to_string());
        }
    }
    ids.sort();
    Ok(ids)
}
