use crate::db::SongRow;

/// Song fields come from files and the song server; escape them so a title
/// cannot inject markup into the print window.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

fn song_num(song: &SongRow) -> String {
    song.song_num.map(|num| num.to_string()).unwrap_or_default()
}

pub fn render_songbook_html(songs: &[SongRow], title: &str) -> String {
    let title = escape(title);
    let mut html = format!(
        "<!doctype html><html><head><meta charset='utf-8'><title>{title}</title>
        <style>body{{font-family:Georgia,serif;margin:2rem}} .song{{page-break-after:always;margin-bottom:2rem}}
        h2{{margin-bottom:.2rem}} .meta{{color:#555;font-size:.9rem}}</style></head><body><h1>{title}</h1>"
    );
    for song in songs {
        html.push_str(&format!(
            "<section class='song'><h2>{}</h2><div class='meta'>#{} · Key: {} · {}</div></section>",
            escape(&song.title),
            song_num(song),
            escape(song.key.as_deref().unwrap_or("-")),
            escape(song.category.as_deref().unwrap_or("-"))
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
        html.push_str(&format!(
            "<li>{} — {}</li>",
            escape(&song.title),
            escape(&song.filename)
        ));
    }
    html.push_str("</ul><h2>Numeric Index</h2><ul>");
    for song in numeric {
        html.push_str(&format!(
            "<li>{} — {}</li>",
            song_num(&song),
            escape(&song.title)
        ));
    }
    html.push_str("</ul>");
    html
}

#[cfg(test)]
mod tests {
    use super::escape;

    #[test]
    fn escapes_markup() {
        assert_eq!(
            escape(r#"<img src=x onerror="a('b')">&"#),
            "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;"
        );
    }
}
