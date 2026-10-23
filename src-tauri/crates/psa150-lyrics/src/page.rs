//! Reading a fetched page: the text blocks that may hold the song, and what
//! the page says its title and artist are.
//!
//! The page does not decide which block is the song; [`crate::chart`] scores
//! every block and keeps the best, so one site's odd markup costs one result
//! rather than needing its own scraper.

use std::sync::OnceLock;

use regex::Regex;
use scraper::{ElementRef, Html, Node, Selector};

use crate::discover;

/// Blocks read from one page; the rest are nested copies of the same text.
const MAX_BLOCKS: usize = 40;

#[derive(Debug, Clone)]
pub struct Page {
    pub url: String,
    pub host: String,
    /// Added to a result's score: sites known for clean charts rank first.
    pub trust: f64,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub blocks: Vec<Block>,
}

/// A piece of the page that may be the song.
#[derive(Debug, Clone, PartialEq)]
pub struct Block {
    pub text: String,
    /// From `<pre>` (or a chart site's own text): spaces line chords up
    /// over the words.
    pub preformatted: bool,
}

pub fn read(url: &str, html: &str) -> Option<Page> {
    let document = Html::parse_document(html);
    let host = discover::host(url).unwrap_or_else(|| "web".into());
    let trust = discover::trust_rank(url).map_or(0.0, |rank| 3.0 - rank as f64 * 0.2);

    if let Some(page) = ultimate_guitar(&document, url, &host, trust) {
        return Some(page);
    }

    let (title, artist) = page_title(&document);
    let song_data = json_ld_song(&document);
    let title = song_data.as_ref().and_then(|s| s.title.clone()).or(title);
    let artist = song_data.as_ref().and_then(|s| s.artist.clone()).or(artist);
    let mut blocks = Vec::new();
    let mut push = |block: Block| {
        if block.text.trim().len() >= 60 && !blocks.contains(&block) && blocks.len() < MAX_BLOCKS {
            blocks.push(block);
        }
    };

    if let Some(lyrics) = song_data.and_then(|s| s.lyrics) {
        push(Block {
            text: tidy(&lyrics),
            preformatted: false,
        });
    }
    // Genius splits the lyrics over several containers; join them.
    let genius = select(&document, "[data-lyrics-container='true']")
        .map(|e| block_text(e, false))
        .collect::<Vec<_>>();
    if !genius.is_empty() {
        push(Block {
            text: genius.join("\n"),
            preformatted: false,
        });
    }
    for element in select(&document, "pre") {
        push(Block {
            text: block_text(element, true),
            preformatted: true,
        });
    }
    let containers = "[class*='lyric'], [id*='lyric'], [class*='chord'], [id*='chord'], \
        [class*='song'], [itemprop='text'], .entry-content, .post-content, article, main";
    for element in select(&document, containers) {
        push(Block {
            text: block_text(element, false),
            preformatted: false,
        });
    }
    if blocks.is_empty() {
        return None;
    }
    Some(Page {
        url: url.into(),
        host,
        trust,
        title,
        artist,
        blocks,
    })
}

fn select<'a>(document: &'a Html, selector: &str) -> impl Iterator<Item = ElementRef<'a>> + 'a {
    let selector = Selector::parse(selector).expect("valid selector");
    document.select(&selector).collect::<Vec<_>>().into_iter()
}

/// Ultimate Guitar keeps the chart as JSON in `div.js-store`'s
/// `data-content`, with `[ch]G[/ch]` around chords and `[tab]` around
/// chord-and-lyric pairs.
fn ultimate_guitar(document: &Html, url: &str, host: &str, trust: f64) -> Option<Page> {
    let store = select(document, "div.js-store").next()?;
    let json: serde_json::Value = serde_json::from_str(store.value().attr("data-content")?).ok()?;
    let data = &json["store"]["page"]["data"];
    let content = data["tab_view"]["wiki_tab"]["content"].as_str()?;
    static TAGS: OnceLock<Regex> = OnceLock::new();
    let tags = TAGS.get_or_init(|| Regex::new(r"\[/?(?:ch|tab)\]").unwrap());
    let text = tags
        .replace_all(&content.replace("\r\n", "\n"), "")
        .into_owned();
    let field = |name: &str| {
        data["tab"][name]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    Some(Page {
        url: url.into(),
        host: host.into(),
        trust,
        title: field("song_name"),
        artist: field("artist_name"),
        blocks: vec![Block {
            text,
            preformatted: true,
        }],
    })
}

/// What a page tells search engines about its song (schema.org JSON-LD:
/// `MusicComposition`, `MusicRecording`, `CreativeWork` and the like).
#[derive(Debug, Default, PartialEq)]
pub struct SongData {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub lyrics: Option<String>,
}

fn json_ld_song(document: &Html) -> Option<SongData> {
    select(document, "script[type='application/ld+json']")
        .filter_map(|script| {
            serde_json::from_str::<serde_json::Value>(&script.text().collect::<String>()).ok()
        })
        .find_map(|value| find_song(&value))
}

fn find_song(value: &serde_json::Value) -> Option<SongData> {
    use serde_json::Value;
    match value {
        Value::Array(items) => items.iter().find_map(find_song),
        Value::Object(map) => {
            if let Some(graph) = map.get("@graph") {
                if let Some(song) = find_song(graph) {
                    return Some(song);
                }
            }
            let kind = map
                .get("@type")
                .map(|t| t.to_string().to_lowercase())
                .unwrap_or_default();
            if !kind.contains("music") && !kind.contains("lyric") && map.get("lyrics").is_none() {
                return None;
            }
            let text = |v: Option<&Value>| -> Option<String> {
                match v? {
                    Value::String(s) => Some(s.trim().to_string()).filter(|s| !s.is_empty()),
                    Value::Object(o) => o
                        .get("name")
                        .or_else(|| o.get("text"))
                        .and_then(|n| n.as_str())
                        .map(|s| s.trim().to_string()),
                    Value::Array(a) => a.first().and_then(|first| match first {
                        Value::String(s) => Some(s.trim().to_string()),
                        Value::Object(o) => o
                            .get("name")
                            .and_then(|n| n.as_str())
                            .map(|s| s.trim().to_string()),
                        _ => None,
                    }),
                    _ => None,
                }
            };
            let lyrics = match map.get("lyrics") {
                Some(Value::Object(o)) => o.get("text").and_then(|t| t.as_str()).map(String::from),
                Some(Value::String(s)) => Some(s.clone()),
                _ => None,
            }
            // Lyrics in JSON-LD are often HTML with <br>.
            .map(|l| {
                l.replace("<br>", "\n")
                    .replace("<br/>", "\n")
                    .replace("<br />", "\n")
            })
            .map(|l| {
                Html::parse_fragment(&l)
                    .root_element()
                    .text()
                    .collect::<String>()
            });
            let song = SongData {
                title: text(map.get("name")).map(|t| clean_title(&t).0.unwrap_or(t)),
                artist: text(map.get("byArtist"))
                    .or_else(|| text(map.get("composer")))
                    .or_else(|| text(map.get("author"))),
                lyrics,
            };
            (song.title.is_some() || song.lyrics.is_some()).then_some(song)
        }
        _ => None,
    }
}

/// Elements whose text is never part of a song.
fn skipped(name: &str) -> bool {
    matches!(
        name,
        "script"
            | "style"
            | "noscript"
            | "template"
            | "button"
            | "nav"
            | "header"
            | "footer"
            | "aside"
            | "form"
            | "iframe"
            | "svg"
            | "select"
            | "input"
            | "textarea"
            | "figure"
            | "img"
            | "video"
    )
}

/// Elements that start a new line.
fn block_level(name: &str) -> bool {
    matches!(
        name,
        "div"
            | "p"
            | "li"
            | "ul"
            | "ol"
            | "dl"
            | "dt"
            | "dd"
            | "tr"
            | "table"
            | "section"
            | "article"
            | "blockquote"
            | "pre"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "main"
    )
}

/// An element's text as lines. `<br>` and block elements break lines and a
/// `<p>` ends a stanza. Outside `<pre>`, runs of ordinary whitespace
/// collapse but non-breaking spaces stay (sites use them to line chords up),
/// and an inline element marked as a chord becomes an inline `[G]`.
pub fn block_text(element: ElementRef<'_>, preformatted: bool) -> String {
    let mut out = String::new();
    walk(element, preformatted, &mut out);
    tidy(&out)
}

fn walk(element: ElementRef<'_>, pre: bool, out: &mut String) {
    for child in element.children() {
        match child.value() {
            Node::Text(text) => {
                if pre {
                    out.push_str(text);
                } else {
                    push_collapsed(out, text);
                }
            }
            Node::Element(e) => {
                let name = e.name();
                if skipped(name)
                    || e.attr("data-exclude-from-selection") == Some("true")
                    || e.attr("aria-hidden") == Some("true")
                    || e.classes().any(|c| {
                        let c = c.to_ascii_lowercase();
                        c.contains("advert") || c.contains("share") || c.contains("comment")
                    })
                {
                    continue;
                }
                let Some(child) = ElementRef::wrap(child) else {
                    continue;
                };
                if name == "br" {
                    out.push('\n');
                    continue;
                }
                if !pre && !block_level(name) && marked_chord(&child) {
                    let chord: String = child.text().collect::<String>().trim().to_string();
                    out.push_str(&format!("[{chord}]"));
                    continue;
                }
                let block = block_level(name);
                if block {
                    soft_break(out);
                }
                walk(child, pre || name == "pre", out);
                if block {
                    soft_break(out);
                }
                if name == "p" {
                    out.push('\n');
                }
            }
            _ => {}
        }
    }
}

/// `<span class="chord">G</span>` and the like: one chord, marked by class.
fn marked_chord(element: &ElementRef<'_>) -> bool {
    let marked = element.value().classes().any(|c| {
        let c = c.to_ascii_lowercase();
        (c.contains("chord") || c.contains("note")) && !c.contains("line") && !c.contains("lyric")
    });
    if !marked {
        return false;
    }
    let text: String = element.text().collect();
    crate::chart::is_chord(text.trim())
}

/// A line break unless the text already ends one, so nested blocks do not
/// stack blank lines.
fn soft_break(out: &mut String) {
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
}

fn push_collapsed(out: &mut String, text: &str) {
    for c in text.chars() {
        if c == '\u{a0}' {
            out.push(' ');
        } else if c.is_whitespace() {
            if !out.ends_with(' ') && !out.ends_with('\n') && !out.is_empty() {
                out.push(' ');
            }
        } else {
            out.push(c);
        }
    }
}

/// Trailing spaces off, tabs to spaces, and never more than one blank line
/// in a row — except that two or more become a double gap, which
/// [`crate::chart`] uses when a site puts every line in its own paragraph.
fn tidy(text: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut blanks = 0;
    for line in text.replace('\r', "").split('\n') {
        let line = line.replace('\t', "    ").trim_end().to_string();
        if line.trim().is_empty() {
            blanks += 1;
            continue;
        }
        if !lines.is_empty() {
            match blanks {
                0 => {}
                1 => lines.push(String::new()),
                _ => {
                    lines.push(String::new());
                    lines.push(String::new());
                }
            }
        }
        blanks = 0;
        lines.push(line);
    }
    lines.join("\n")
}

/// The page's own idea of the song: `og:title`, then `<h1>`, then `<title>`,
/// with the site name and the words "chords", "lyrics" and the like taken
/// off, and "Song by Artist" or "Artist – Song" split.
fn page_title(document: &Html) -> (Option<String>, Option<String>) {
    let og = select(document, "meta[property='og:title']")
        .next()
        .and_then(|e| e.value().attr("content").map(String::from));
    let h1 = select(document, "h1")
        .next()
        .map(|e| e.text().collect::<String>());
    let title = select(document, "title")
        .next()
        .map(|e| e.text().collect::<String>());
    for raw in [og, h1, title].into_iter().flatten() {
        let (title, artist) = clean_title(&raw);
        if let Some(title) = title {
            return (Some(title), artist);
        }
    }
    (None, None)
}

pub fn clean_title(raw: &str) -> (Option<String>, Option<String>) {
    static BY: OnceLock<Regex> = OnceLock::new();
    static NOISE: OnceLock<Regex> = OnceLock::new();
    let by = BY.get_or_init(|| {
        Regex::new(
            r"(?i)^(.+?)\s+(?:(?:chords?|lyrics|tabs?|ver(?:sion)?\.?\s*\d+)\s*)*\bby\s+(.+)$",
        )
        .unwrap()
    });
    let noise = NOISE.get_or_init(|| {
        Regex::new(r"(?i)\s*[\(\[]?\b(?:official\s+)?(?:guitar\s+|ukulele\s+|piano\s+)?(?:chords?(?:\s+chart)?|lyrics?|tabs?|tablature|transpose|ver(?:sion)?\.?\s*\d+|sheet\s+music|live|lyric\s+video)\b[\)\]]?\s*(?:(?:&|and|\+|/)\s*)?").unwrap()
    });
    let text = raw
        .split(" | ")
        .next()
        .unwrap_or(raw)
        .replace('\u{a0}', " ");
    let text = text.split(" @ ").next().unwrap_or(&text).trim();
    let clean = |s: &str| {
        let s = noise.replace_all(s, " ");
        // Words, without the stray "&" and "," the noise leaves behind.
        let s = s
            .split_whitespace()
            .filter(|w| w.chars().any(char::is_alphanumeric))
            .collect::<Vec<_>>()
            .join(" ");
        let s = s.trim_matches(|c: char| {
            c == '-' || c == '–' || c == '—' || c == ':' || c == ',' || c.is_whitespace()
        });
        (!s.is_empty()).then(|| s.to_string())
    };
    if let Some(caps) = by.captures(text) {
        let artist = caps[2].split([',', '-', '–', '—']).next().and_then(clean);
        return (clean(&caps[1]), artist);
    }
    let parts: Vec<String> = text
        .replace(['–', '—'], "-")
        .split(" - ")
        .filter_map(clean)
        .filter(|part| !looks_like_site(part))
        .collect();
    match parts.as_slice() {
        [] => (None, None),
        [title] => (Some(title.clone()), None),
        // "Artist – Song" (Genius) and "Song - Artist" (most chord sites)
        // both occur; a page title rarely says which. Most chord sites
        // write the song first.
        [first, second, ..] => (Some(first.clone()), Some(second.clone())),
    }
}

fn looks_like_site(part: &str) -> bool {
    let lower = part.to_lowercase();
    lower.contains(".com")
        || lower.contains(".org")
        || lower.contains(".net")
        || [
            "worship chords",
            "worshipchords",
            "ultimate guitar",
            "genius",
            "worship together",
            "hymnary",
            "e-chords",
        ]
        .iter()
        .any(|site| lower == *site)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_lose_site_names_and_chart_words() {
        assert_eq!(
            clean_title("WAY MAKER CHORDS by Sinach @ Ultimate-Guitar.Com"),
            (Some("WAY MAKER".into()), Some("Sinach".into()))
        );
        assert_eq!(
            clean_title("Goodness Of God Chords - Bethel Music | WorshipChords"),
            (Some("Goodness Of God".into()), Some("Bethel Music".into()))
        );
        assert_eq!(
            clean_title("Build My Life Lyrics"),
            (Some("Build My Life".into()), None)
        );
        assert_eq!(clean_title("Chords"), (None, None));
    }

    #[test]
    fn breaks_lines_at_br_and_paragraphs_and_keeps_pre_spacing() {
        let html = Html::parse_fragment(
            "<div><p>Amazing <b>grace</b> how sweet<br>the sound</p><p>That saved</p><script>x()</script></div>",
        );
        let div = html
            .select(&Selector::parse("div").unwrap())
            .next()
            .unwrap();
        assert_eq!(
            block_text(div, false),
            "Amazing grace how sweet\nthe sound\n\nThat saved"
        );

        let html = Html::parse_fragment("<pre>G        C\n   Amazing grace</pre>");
        let pre = html
            .select(&Selector::parse("pre").unwrap())
            .next()
            .unwrap();
        assert_eq!(block_text(pre, true), "G        C\n   Amazing grace");
    }

    #[test]
    fn chord_spans_become_inline_chords() {
        let html = Html::parse_fragment(
            r#"<div class="sheet"><span class="chord">G</span>Amazing <span class="chord">C</span>grace</div>"#,
        );
        let div = html
            .select(&Selector::parse("div").unwrap())
            .next()
            .unwrap();
        assert_eq!(block_text(div, false), "[G]Amazing [C]grace");
    }

    #[test]
    fn reads_song_data_for_search_engines() {
        let html = r#"<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},{"@type":"MusicComposition","name":"Way Maker Lyrics","composer":{"@type":"Person","name":"Sinach"},"lyrics":{"@type":"CreativeWork","text":"You are here, moving in our midst<br>I worship You, I worship You<br><br>Way maker, miracle worker<br>Promise keeper"}}]}</script></head><body></body></html>"#;
        let page = read("https://example.com/way-maker", html).unwrap();
        assert_eq!(page.title.as_deref(), Some("Way Maker"));
        assert_eq!(page.artist.as_deref(), Some("Sinach"));
        assert_eq!(
            page.blocks[0].text,
            "You are here, moving in our midst
I worship You, I worship You

Way maker, miracle worker
Promise keeper"
        );
    }

    #[test]
    fn reads_ultimate_guitar_store() {
        let content = r#"{"store":{"page":{"data":{"tab":{"song_name":"Way Maker","artist_name":"Sinach"},"tab_view":{"wiki_tab":{"content":"[Verse 1]\r\n[tab][ch]E[/ch]        [ch]B[/ch]\r\nYou are here[/tab]"}}}}}}"#;
        let html = format!(
            r#"<div class="js-store" data-content="{}"></div>"#,
            content.replace('"', "&quot;")
        );
        let page = read(
            "https://tabs.ultimate-guitar.com/tab/sinach/way-maker-chords-1",
            &html,
        )
        .unwrap();
        assert_eq!(page.title.as_deref(), Some("Way Maker"));
        assert_eq!(page.artist.as_deref(), Some("Sinach"));
        assert_eq!(page.blocks[0].text, "[Verse 1]\nE        B\nYou are here");
        assert!(page.blocks[0].preformatted);
        assert!(page.trust > 2.0);
    }
}
