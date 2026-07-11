use std::collections::HashMap;
use std::path::Path;

use jetdb::{read_catalog, read_table_def, read_table_rows, PageReader, Value};

use crate::projection::SlideTheme;

#[derive(Debug, Clone)]
pub struct VsbSongRow {
    pub song_id: i64,
    pub song_num: i64,
    pub title: String,
    pub body: String,
    pub key: Option<String>,
    pub author: Option<String>,
    pub copyright: Option<String>,
    pub category_id: i64,
}

pub fn read_vsb_mdb(path: &Path) -> Result<Vec<VsbSongRow>, String> {
    read_table(path, "Songs", |cols| {
        let song_id = cols.get("SongID").and_then(value_as_i64).unwrap_or(0);
        let song_num = cols.get("SongNum").and_then(value_as_i64).unwrap_or(0);
        let title = cols
            .get("Title")
            .and_then(value_as_string)
            .unwrap_or_else(|| "Untitled".into());
        let body = cols
            .get("Body")
            .and_then(value_as_string)
            .unwrap_or_default();
        let key = cols.get("Key").and_then(value_as_string);
        let author = cols
            .get("Author")
            .and_then(value_as_string)
            .filter(|s| !s.is_empty());
        let copyright = cols
            .get("Copyright")
            .and_then(value_as_string)
            .filter(|s| !s.is_empty());
        let category_id = cols.get("CategoryId").and_then(value_as_i64).unwrap_or(0);

        if title.trim().is_empty() {
            return None;
        }

        Some(VsbSongRow {
            song_id,
            song_num,
            title,
            body,
            key,
            author,
            copyright,
            category_id,
        })
    })
}

pub fn read_vsb_categories(path: &Path) -> Result<Vec<(i64, String)>, String> {
    read_table(path, "Categories", |cols| {
        let id = cols.get("ID").and_then(value_as_i64).unwrap_or(0);
        let name = cols
            .get("Name")
            .and_then(value_as_string)
            .unwrap_or_default();
        if name.is_empty() {
            None
        } else {
            Some((id, name))
        }
    })
}

pub fn read_page_setup(path: &Path) -> Result<SlideTheme, String> {
    let rows: Vec<HashMap<String, Value>> = read_raw_table(path, "PageSetup")?;
    if let Some(row) = rows.first() {
        let font_name = row
            .get("FontName")
            .and_then(value_as_string)
            .unwrap_or_else(|| "Arial".into());
        let font_size = row.get("FontSize").and_then(value_as_f64).unwrap_or(24.0) as f32;
        let font_bold = row.get("FontBold").and_then(value_as_bool).unwrap_or(true);
        let fore = row
            .get("ForeColor")
            .and_then(value_as_i64)
            .unwrap_or(0xFFFFFF) as u32;
        let back = row.get("BackColor").and_then(value_as_i64).unwrap_or(0) as u32;
        let margin_top = row.get("MarginTop").and_then(value_as_i64).unwrap_or(0) as u32;
        let margin_left = row.get("MarginLeft").and_then(value_as_i64).unwrap_or(48) as u32;
        let margin_right = row.get("MarginRight").and_then(value_as_i64).unwrap_or(48) as u32;
        let margin_bottom = row.get("MarginBottom").and_then(value_as_i64).unwrap_or(48) as u32;

        return Ok(SlideTheme {
            font_name,
            font_size,
            font_bold,
            font_italic: false,
            foreground: color_to_hex(fore),
            background: color_to_hex(back),
            margin_top,
            margin_left,
            margin_right,
            margin_bottom,
            projection_width: 1920,
            projection_height: 1080,
            show_title_overlay: true,
            show_key_overlay: true,
            show_copyright_overlay: true,
            show_ccli_overlay: true,
        });
    }

    Ok(SlideTheme::default())
}

fn read_table<T, F>(path: &Path, table_name: &str, map_row: F) -> Result<Vec<T>, String>
where
    F: Fn(&HashMap<String, Value>) -> Option<T>,
{
    let rows = read_raw_table(path, table_name)?;
    Ok(rows.iter().filter_map(|row| map_row(row)).collect())
}

fn read_raw_table(path: &Path, table_name: &str) -> Result<Vec<HashMap<String, Value>>, String> {
    let mut reader = PageReader::open(path).map_err(|e| e.to_string())?;
    let catalog = read_catalog(&mut reader).map_err(|e| e.to_string())?;
    let entry = catalog
        .iter()
        .find(|e| e.name.eq_ignore_ascii_case(table_name))
        .ok_or_else(|| format!("{table_name} table not found"))?;
    let table_def =
        read_table_def(&mut reader, &entry.name, entry.table_page).map_err(|e| e.to_string())?;
    let result = read_table_rows(&mut reader, &table_def).map_err(|e| e.to_string())?;

    let mut mapped = Vec::new();
    for row in result.rows {
        let mut cols = HashMap::new();
        for (idx, col) in table_def.columns.iter().enumerate() {
            if let Some(value) = row.get(idx) {
                cols.insert(col.name.clone(), value.clone());
            }
        }
        mapped.push(cols);
    }
    Ok(mapped)
}

fn value_as_string(value: &Value) -> Option<String> {
    match value {
        Value::Text(s) => Some(s.clone()),
        Value::DateTimeExtended(s) => Some(s.clone()),
        _ => None,
    }
}

fn value_as_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Long(v) => Some(*v as i64),
        Value::Int(v) => Some(*v as i64),
        Value::BigInt(v) => Some(*v),
        Value::Double(v) => Some(*v as i64),
        Value::Byte(v) => Some(*v as i64),
        _ => None,
    }
}

fn value_as_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Double(v) => Some(*v),
        Value::Float(v) => Some(*v as f64),
        Value::Long(v) => Some(*v as f64),
        _ => None,
    }
}

fn value_as_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(v) => Some(*v),
        Value::Long(v) => Some(*v != 0),
        Value::Byte(v) => Some(*v != 0),
        _ => None,
    }
}

fn color_to_hex(vbs: u32) -> String {
    let r = vbs & 0xFF;
    let g = (vbs >> 8) & 0xFF;
    let b = (vbs >> 16) & 0xFF;
    format!("#{:02x}{:02x}{:02x}", r, g, b)
}
