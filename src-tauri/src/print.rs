use crate::db::SongRow;

pub fn render_songbook_html(songs: &[SongRow], title: &str) -> String {
    let mut html = format!(
        "<!doctype html><html><head><meta charset='utf-8'><title>{title}</title>
        <style>body{{font-family:Georgia,serif;margin:2rem}} .song{{page-break-after:always;margin-bottom:2rem}}
        h2{{margin-bottom:.2rem}} .meta{{color:#555;font-size:.9rem}}</style></head><body><h1>{title}</h1>"
    );
    for song in songs {
        html.push_str(&format!(
            "<section class='song'><h2>{}</h2><div class='meta'>#{:?} · Key: {} · {}</div></section>",
            song.title,
            song.song_num,
            song.key.clone().unwrap_or_else(|| "-".into()),
            song.category.clone().unwrap_or_else(|| "-".into())
        ));
    }
    html.push_str("</body></html>");
    html
}

pub fn render_indexes_html(songs: &[SongRow]) -> String {
    let mut alpha = songs.to_vec();
    alpha.sort_by(|a, b| a.title_sort.cmp(&b.title_sort));
    let mut numeric = songs.to_vec();
    numeric.sort_by(|a, b| a.song_num.cmp(&b.song_num));
    let mut html = String::from("<h2>General Index</h2><ul>");
    for song in alpha {
        html.push_str(&format!("<li>{} — {}</li>", song.title, song.filename));
    }
    html.push_str("</ul><h2>Numeric Index</h2><ul>");
    for song in numeric {
        html.push_str(&format!("<li>{:?} — {}</li>", song.song_num, song.title));
    }
    html.push_str("</ul>");
    html
}
