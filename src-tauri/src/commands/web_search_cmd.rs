use std::sync::OnceLock;

use tauri::State;

use crate::{with_state, AppState};

/// Look online for a song the library does not have. The console calls this
/// only when the operator asks. Async, so the search runs off the main
/// thread and projection keeps responding.
#[tauri::command]
pub async fn search_web_songs(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<psa150_lyrics::Candidate>, String> {
    let enabled = with_state(&state, |runtime| Ok(runtime.config.web_search_enabled))?;
    if !enabled {
        return Ok(vec![]);
    }
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let client = match CLIENT.get() {
        Some(client) => client,
        None => {
            let client = psa150_lyrics::client()?;
            CLIENT.get_or_init(|| client)
        }
    };
    psa150_lyrics::search(client, &query).await
}

#[cfg(test)]
mod tests {
    use crate::library::chordpro::{parse_chordpro, SectionKind};
    use crate::projection::modes::audience_slide;
    use crate::projection::{build_slides, SlideTheme};
    use psa150_lyrics::chart::parse_block;
    use psa150_lyrics::page::Block;

    const MAKE_ROOM_EXCERPT: &str = "First Verse\nF#                        C#\n Here is where I lay it down\n                    G#m\nEvery burden, every crown\n                    B\nThis is my surrender\n\n\nChorus\n                F#\nAnd I will make room for You\nC#                   G#m\n To do whatever You want to\n";

    /// What the lookup writes is what the desktop reads: sections, chords for
    /// the stage, words only for the audience.
    #[test]
    fn found_songs_parse_and_project() {
        let block = Block { text: MAKE_ROOM_EXCERPT.into(), preformatted: true };
        let song = parse_block(&block, "Make Room", None, &["Make Room"]).expect("a song");
        let parsed = parse_chordpro(&song.to_chordpro(), "make-room.pro");
        assert_eq!(parsed.meta.title, "Make Room");
        let kinds: Vec<_> = parsed.sections.iter().map(|s| (s.kind.clone(), s.label.clone())).collect();
        assert_eq!(kinds, vec![(SectionKind::Verse, "Verse 1".into()), (SectionKind::Chorus, "Chorus".into())]);
        assert_eq!(parsed.sections[0].lines[0].text, "Here is where I lay it down");

        let slides = build_slides(&parsed, &SlideTheme::default(), 0);
        assert!(slides[0].lines.iter().any(|l| !l.chords.is_empty()), "the stage keeps chords");
        let audience = audience_slide(&slides[0]);
        assert!(audience.lines.iter().all(|l| l.chords.is_empty() && !l.text.contains('#')));
    }
}
