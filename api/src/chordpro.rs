use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SongMetadata {
    pub title: String,
    pub song_number: Option<String>,
    pub authors: String,
    pub language: Option<String>,
    /// The `{key}` directive as written, e.g. `G`, `F#m` or `D / E`; without
    /// one, the key the chords fit best, as the song view shows it.
    pub song_key: Option<String>,
}

pub fn metadata(source: &str) -> SongMetadata {
    let mut title = None;
    let mut song_number = None;
    // The desktop's number, `{meta: song_num=227}`; an explicit
    // `{number}` or `{song_number}` wins over it.
    let mut meta_song_number = None;
    let mut language = None;
    let mut song_key = None;
    // `{meta: key=G}`; an explicit `{key}` wins over it.
    let mut meta_song_key = None;
    let mut authors = Vec::new();

    for line in source.lines().take(100) {
        let Some((name, value)) = directive(line) else {
            continue;
        };

        match name.as_str() {
            "title" | "t" if title.is_none() => title = Some(value),
            "number" | "song_number" if song_number.is_none() => song_number = Some(value),
            "meta" => {
                if let Some((key, meta_value)) = value.split_once('=') {
                    let key = key.trim();
                    if key.eq_ignore_ascii_case("song_num") && meta_song_number.is_none() {
                        meta_song_number = Some(meta_value.trim().to_string());
                    } else if key.eq_ignore_ascii_case("key") && meta_song_key.is_none() {
                        meta_song_key = Some(meta_value.trim().to_string());
                    }
                }
            }
            "key" if song_key.is_none() => song_key = Some(value),
            "language" | "lang" if language.is_none() => language = Some(value),
            "artist" | "composer" | "lyricist" | "author"
                if !value.is_empty() && !authors.iter().any(|existing| existing == &value) =>
            {
                authors.push(value);
            }
            _ => {}
        }
    }

    SongMetadata {
        title: title
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Untitled song".into()),
        song_number: song_number
            .filter(|value| !value.is_empty())
            .or(meta_song_number.filter(|value| !value.is_empty())),
        authors: authors.join(", "),
        language: language.filter(|value| !value.is_empty()),
        song_key: song_key
            .filter(|value| !value.is_empty())
            .or(meta_song_key.filter(|value| !value.is_empty()))
            .or_else(|| guess_key(&chords(source))),
    }
}

/// The chords of the lyric lines, in order: not directives, comments, tabs
/// or grids.
fn chords(source: &str) -> Vec<&str> {
    let mut in_tab = false;
    let mut found = Vec::new();
    for line in source.lines() {
        if let Some(name) = directive_name(line) {
            match name.as_str() {
                "start_of_tab" | "start_of_grid" | "sot" | "sog" => in_tab = true,
                "end_of_tab" | "end_of_grid" | "eot" | "eog" => in_tab = false,
                _ => {}
            }
            continue;
        }
        if in_tab || line.trim_start().starts_with('#') {
            continue;
        }
        let mut rest = line;
        while let Some(start) = rest.find('[') {
            let Some(end) = rest[start + 1..].find(']') else {
                break;
            };
            let name = rest[start + 1..start + 1 + end].trim();
            if !name.is_empty() {
                found.push(name);
            }
            rest = &rest[start + 2 + end..];
        }
    }
    found
}

/// The chords of a major key, as steps above its tonic and whether minor.
const MAJOR: [(u8, bool); 6] = [
    (0, false),
    (2, true),
    (4, true),
    (5, false),
    (7, false),
    (9, true),
];
const NOTES: [&str; 12] = [
    "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B",
];

/// A chord's root as a pitch class and whether it is minor (`Am`, not `Amaj7`).
fn chord_root(chord: &str) -> Option<(u8, bool)> {
    let mut chars = chord.chars().peekable();
    let base: u8 = match chars.next()? {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' | 'H' => 11,
        _ => return None,
    };
    let root = match chars.peek() {
        Some('#') => {
            chars.next();
            (base + 1) % 12
        }
        Some('b') => {
            chars.next();
            (base + 11) % 12
        }
        _ => base,
    };
    let rest: String = chars.collect();
    let minor = rest.starts_with('m') && !rest.starts_with("maj");
    Some((root, minor))
}

/// The key the chords fit best; the same rules as `guessKey` in
/// `shared/chord-match.ts`, which the song view uses. Every chord in a key's
/// scale counts, and ending on (or, less, starting on) its tonic decides
/// between keys that share chords; a major key wins a tie with its minor.
fn guess_key(chords: &[&str]) -> Option<String> {
    let parsed: Vec<(u8, bool)> = chords
        .iter()
        .filter_map(|chord| chord_root(chord))
        .collect();
    let (first, last) = (*parsed.first()?, *parsed.last()?);
    let mut best: Option<(u8, bool, f64)> = None;
    for tonic in 0..12u8 {
        for minor in [false, true] {
            // A minor key uses the chords of the major key a minor third up.
            let major = if minor { (tonic + 3) % 12 } else { tonic };
            let fits = |&(root, is_minor): &(u8, bool)| {
                MAJOR
                    .iter()
                    .any(|&(step, m)| (major + step) % 12 == root && m == is_minor)
            };
            let home = |&(root, is_minor): &(u8, bool)| root == tonic && is_minor == minor;
            let mut score = parsed.iter().filter(|c| fits(c)).count() as f64;
            if home(&last) {
                score += 3.0;
            }
            if home(&first) {
                score += 1.0;
            }
            score += parsed.iter().filter(|c| home(c)).count() as f64 * 0.5;
            let better = match best {
                None => true,
                Some((_, best_minor, best_score)) => {
                    score > best_score || (score == best_score && !minor && best_minor)
                }
            };
            if better {
                best = Some((tonic, minor, score));
            }
        }
    }
    best.map(|(tonic, minor, _)| {
        format!("{}{}", NOTES[tonic as usize], if minor { "m" } else { "" })
    })
}

/// The song with `{meta: song_num=N}` added under its `{title}` line (or at
/// the top when it has none), the way the desktop writes a number.
pub fn with_song_number(source: &str, number: i64) -> String {
    let line = format!("{{meta: song_num={number}}}");
    let newline = if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut lines: Vec<&str> = source.split_inclusive('\n').collect();
    let at = lines
        .iter()
        .take(100)
        .position(|l| matches!(directive(l), Some((name, _)) if name == "title" || name == "t"))
        .map_or(0, |i| i + 1);
    let inserted = format!("{line}{newline}");
    if at > 0 && !lines[at - 1].ends_with('\n') {
        // The title is the last line and has no line break of its own.
        return format!("{source}{newline}{line}");
    }
    lines.insert(at, &inserted);
    lines.concat()
}

pub fn content_hash(source: &str) -> String {
    hex::encode(Sha256::digest(source.as_bytes()))
}

pub fn export_filename(title: &str, id: uuid::Uuid) -> String {
    let slug = title
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join("-");
    let slug = if slug.is_empty() { "song" } else { &slug };
    format!("{slug}-{}.pro", &id.simple().to_string()[..8])
}

/// The song with sections that name themselves in their first line made the
/// sections they say they are: a verse starting "Kor:", "Chorus" or
/// "Chours:" becomes a chorus, one starting "Bridge:" or "Bro:" a bridge,
/// and "Vers 2:" or "Verse:" is a verse. The naming lines go (several in a
/// row count as one; a chorus that already is one just loses them), or only
/// the name where the words follow on the same line ("Kor: Jesus har
/// makt,"). A section that holds nothing but a name ("Kor:" with the chorus
/// in the next section) goes, and its name applies to the next section, so
/// no empty chorus is left. A number or a repeat ("Kor 2.", "BRIDGE X3")
/// becomes the label of a chorus or bridge. Applying it twice changes nothing.
pub fn label_sections(source: &str) -> String {
    let mut lines: Vec<String> = source.split_inclusive('\n').map(str::to_string).collect();
    let mut dropped = vec![false; lines.len()];
    // The name of a section that held only that, for the next section.
    let mut carried: Option<SectionName> = None;
    let mut index = 0;
    while index < lines.len() {
        let Some(kind) = section_directive(&lines[index])
            .and_then(|name| name.strip_prefix("start_of_").map(str::to_string))
        else {
            index += 1;
            continue;
        };
        let start = index;
        // The section runs to its end directive, or to the next start.
        let stop = (start + 1..lines.len())
            .find(|&i| section_directive(&lines[i]).is_some())
            .unwrap_or(lines.len());
        let end = (stop < lines.len()
            && section_directive(&lines[stop]).is_some_and(|name| name.starts_with("end_of_")))
        .then_some(stop);
        index = end.map_or(stop, |end| end + 1);
        if !matches!(kind.as_str(), "verse" | "chorus" | "chorus2" | "bridge") {
            carried = None;
            continue;
        }
        let mut named = carried.take();
        let mut words = false;
        for i in start + 1..stop {
            let line = &lines[i];
            if line.trim().is_empty() || directive_name(line).is_some() {
                continue;
            }
            let Some(name) = section_name(line) else {
                words = true;
                break;
            };
            let ending = line_ending(line).to_string();
            let rest = name.words.clone();
            named.get_or_insert(name);
            if rest.is_empty() {
                dropped[i] = true;
            } else {
                lines[i] = format!("{rest}{ending}");
                words = true;
                break;
            }
        }
        // An empty bridge is a bridge whose name line went (an empty chorus
        // stays: it says "sing the chorus here").
        if named.is_none() && !words && kind == "bridge" {
            named = Some(SectionName {
                kind: "bridge",
                label: None,
                words: String::new(),
            });
        }
        let Some(named) = named else {
            continue;
        };
        if !words {
            // Only a name: the section goes (with a blank line after it)
            // and the name is the next section's.
            let last = end.unwrap_or(stop.saturating_sub(1)).min(lines.len() - 1);
            dropped[start..=last].iter_mut().for_each(|d| *d = true);
            if lines.get(last + 1).is_some_and(|l| l.trim().is_empty()) {
                dropped[last + 1] = true;
            }
            carried = Some(named);
            continue;
        }
        let same = kind == named.kind || (named.kind == "chorus" && kind == "chorus2");
        if !same || named.label.is_some() {
            let ending = line_ending(&lines[start]).to_string();
            lines[start] = match &named.label {
                Some(label) => format!("{{start_of_{}: {label}}}{ending}", named.kind),
                None => format!("{{start_of_{}}}{ending}", named.kind),
            };
            if let Some(end) = end {
                let ending = line_ending(&lines[end]).to_string();
                lines[end] = format!("{{end_of_{}}}{ending}", named.kind);
            }
        }
    }
    lines
        .into_iter()
        .zip(dropped)
        .filter_map(|(line, dropped)| (!dropped).then_some(line))
        .collect()
}

/// A section's start or end directive, short forms written out
/// (`{soc}` is `start_of_chorus`).
fn section_directive(line: &str) -> Option<String> {
    let name = directive_name(line)?;
    let name = match name.as_str() {
        "sov" => "start_of_verse".to_string(),
        "soc" => "start_of_chorus".to_string(),
        "sob" => "start_of_bridge".to_string(),
        "eov" => "end_of_verse".to_string(),
        "eoc" => "end_of_chorus".to_string(),
        "eob" => "end_of_bridge".to_string(),
        _ => name,
    };
    (name.starts_with("start_of_") || name.starts_with("end_of_")).then_some(name)
}

fn line_ending(line: &str) -> &str {
    &line[line.trim_end_matches(['\r', '\n']).len()..]
}

struct SectionName {
    kind: &'static str,
    label: Option<String>,
    /// Words after the name on the same line, if any.
    words: String,
}

/// "Kor:", "Chorus", "Ref 1:", "Bridge...", "BRIDGE X3", "Vers 2:", "Kor: Jesus har makt"
/// as the section they name; not a line of words that starts with one
/// ("kor me i verda går").
fn section_name(line: &str) -> Option<SectionName> {
    let text = line.trim();
    let word: String = text.chars().take_while(|c| c.is_alphabetic()).collect();
    // "Ref" and "Bro" are words of their own too: only with a colon.
    let (kind, needs_colon) = match word.to_lowercase().as_str() {
        "chorus" | "chours" | "chour" | "kor" | "refreng" | "refrain" => ("chorus", false),
        "ref" => ("chorus", true),
        "bridge" | "brige" => ("bridge", false),
        "bro" => ("bridge", true),
        "vers" | "verse" => ("verse", false),
        _ => return None,
    };
    let mut rest = text[word.len()..].trim_start();
    let number: String = rest.chars().take_while(char::is_ascii_digit).collect();
    rest = rest[number.len()..].trim_start();
    let mut repeat = String::new();
    if let Some(after) = rest.strip_prefix(['x', 'X']) {
        let times: String = after.chars().take_while(char::is_ascii_digit).collect();
        if !times.is_empty() {
            rest = after[times.len()..].trim_start();
            repeat = times;
        }
    }
    let marks: String = rest
        .chars()
        .take_while(|c| matches!(c, ':' | '.'))
        .collect();
    let colon = marks.contains(':');
    let words = rest[marks.len()..].trim();
    if !colon && (needs_colon || !words.is_empty()) {
        return None;
    }
    let name = if kind == "chorus" { "Chorus" } else { "Bridge" };
    // Verses are numbered in order where they are shown.
    let label = match (number.is_empty() || kind == "verse", repeat.is_empty()) {
        (true, true) => None,
        (false, true) => Some(format!("{name} {number}")),
        (true, false) => Some(format!("{name} (x{repeat})")),
        (false, false) => Some(format!("{name} {number} (x{repeat})")),
    };
    Some(SectionName {
        kind,
        label,
        words: words.to_string(),
    })
}

/// The name of a directive line, with or without a value (`{soc}`).
fn directive_name(line: &str) -> Option<String> {
    let inner = line.trim().strip_prefix('{')?.strip_suffix('}')?;
    let name = inner.split(':').next().unwrap_or(inner);
    Some(name.trim().to_ascii_lowercase())
}

fn directive(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    let inner = line.strip_prefix('{')?.strip_suffix('}')?;
    let (name, value) = inner.split_once(':')?;
    Some((name.trim().to_ascii_lowercase(), value.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_common_metadata() {
        let source = "{title: Great Is Thy Faithfulness}\n{composer: Thomas Chisholm}\n{lyricist: Thomas Chisholm}\n{language: en}\n\nGreat is thy faithfulness";
        let parsed = metadata(source);

        assert_eq!(parsed.title, "Great Is Thy Faithfulness");
        assert_eq!(parsed.authors, "Thomas Chisholm");
        assert_eq!(parsed.language.as_deref(), Some("en"));
    }

    #[test]
    fn adds_a_song_number_under_the_title() {
        assert_eq!(
            with_song_number("{title: Way Maker}\n{key: E}\n\nWords\n", 12),
            "{title: Way Maker}\n{meta: song_num=12}\n{key: E}\n\nWords\n"
        );
        assert_eq!(
            with_song_number("Words\r\n", 3),
            "{meta: song_num=3}\r\nWords\r\n"
        );
        assert_eq!(
            with_song_number("{title: Last}", 4),
            "{title: Last}\n{meta: song_num=4}"
        );
        assert_eq!(
            metadata(&with_song_number("{title: X}\nY", 7))
                .song_number
                .as_deref(),
            Some("7")
        );
    }

    #[test]
    fn reads_the_desktop_song_number() {
        let parsed =
            metadata("{title: Ten Thousand}\n{meta: ccli=6016351}\n{meta: song_num = 1016 }\n");
        assert_eq!(parsed.song_number.as_deref(), Some("1016"));
        let parsed = metadata("{meta: song_num=1016}\n{number: 12a}\n");
        assert_eq!(parsed.song_number.as_deref(), Some("12a"));
        assert_eq!(metadata("{meta: song_num=}").song_number, None);
    }

    #[test]
    fn reads_the_key() {
        assert_eq!(metadata("{key: F#m}").song_key.as_deref(), Some("F#m"));
        let parsed = metadata(
            "{meta: key=D}
{key: D / E}
",
        );
        assert_eq!(parsed.song_key.as_deref(), Some("D / E"));
        assert_eq!(
            metadata("{meta: key = Bb }").song_key.as_deref(),
            Some("Bb")
        );
        assert_eq!(metadata("{key: }").song_key, None);
    }

    #[test]
    fn guesses_the_key_from_the_chords_without_a_key_directive() {
        let source = "{title: Everyday Hallelujah}
[G]I can see You in the [G/B]morning
[C]Of those starry [G]nights, all those [Em]moments
[Dadd4]I feel Your goodness
[G]thank You";
        assert_eq!(metadata(source).song_key.as_deref(), Some("G"));
        assert_eq!(
            metadata(
                "{key: D}
[G]Words [C]here [G]"
            )
            .song_key
            .as_deref(),
            Some("D")
        );
        assert_eq!(
            metadata("[Am]Words [Dm]and [E]more [Am]")
                .song_key
                .as_deref(),
            Some("Am")
        );
        assert_eq!(
            metadata(
                "{sot}
[Bb]
{eot}
No chords"
            )
            .song_key,
            None
        );
    }

    #[test]
    fn makes_self_named_sections_what_they_say() {
        let source = "{title: Send meg}\n{start_of_verse}\nchours:\nSå [E]send meg\n{end_of_verse}\n\n{start_of_verse}\nBridge:\nLa mitt [B]hjerte si\n{end_of_verse}\n";
        assert_eq!(
            label_sections(source),
            "{title: Send meg}\n{start_of_chorus}\nSå [E]send meg\n{end_of_chorus}\n\n{start_of_bridge}\nLa mitt [B]hjerte si\n{end_of_bridge}\n"
        );
    }

    #[test]
    fn drops_the_name_of_a_chorus_that_already_is_one() {
        let source = "{start_of_chorus}\r\nKor:\r\nHalleluja\r\n{end_of_chorus}\r\n{soc}\r\nKor: Jesus har makt,\r\n{eoc}\r\n";
        assert_eq!(
            label_sections(source),
            "{start_of_chorus}\r\nHalleluja\r\n{end_of_chorus}\r\n{soc}\r\nJesus har makt,\r\n{eoc}\r\n"
        );
    }

    #[test]
    fn keeps_numbers_and_repeats_as_labels() {
        let source = "{start_of_verse}\nKor 2.\nA\n{end_of_verse}\n{start_of_verse}\nBRIDGE X3\nB\n{end_of_verse}\n";
        assert_eq!(
            label_sections(source),
            "{start_of_chorus: Chorus 2}\nA\n{end_of_chorus}\n{start_of_bridge: Bridge (x3)}\nB\n{end_of_bridge}\n"
        );
    }

    #[test]
    fn leaves_words_that_only_start_like_a_name() {
        for source in [
            "{start_of_verse}\nkor me i verda går,\n{end_of_verse}\n",
            "{start_of_verse}\nBro over vann\n{end_of_verse}\n",
            "{start_of_verse}\nVersene vi synger\n{end_of_verse}\n",
            "Kor:\nno sections here\n",
        ] {
            assert_eq!(label_sections(source), source);
        }
        for source in [
            "{start_of_verse}\nRef 1:\nA\n{end_of_verse}\n",
            "{start_of_verse}\nKor 2.\nA\n{end_of_verse}\n",
        ] {
            let once = label_sections(source);
            assert_ne!(once, source);
            assert_eq!(label_sections(&once), once);
        }
    }

    #[test]
    fn a_section_of_only_a_name_names_the_next() {
        let source = "{start_of_verse}\nA\n{end_of_verse}\n\n{start_of_verse}\nKor:\n{end_of_verse}\n\n{start_of_verse}\nChorus:\nB\n{end_of_verse}\n\n{start_of_verse}\nbridge...\n{end_of_verse}\n{start_of_verse}\nC\n{end_of_verse}\n";
        assert_eq!(
            label_sections(source),
            "{start_of_verse}\nA\n{end_of_verse}\n\n{start_of_chorus}\nB\n{end_of_chorus}\n\n{start_of_bridge}\nC\n{end_of_bridge}\n"
        );
    }

    #[test]
    fn an_empty_bridge_names_the_next_but_an_empty_chorus_stays() {
        let source = "{start_of_bridge}\n{end_of_bridge}\n\n{start_of_verse}\nA\n{end_of_verse}\n{start_of_chorus}\n\n{end_of_chorus}\n";
        assert_eq!(
            label_sections(source),
            "{start_of_bridge}\nA\n{end_of_bridge}\n{start_of_chorus}\n\n{end_of_chorus}\n"
        );
    }

    #[test]
    fn drops_verse_names_and_stacked_names() {
        let source = "{start_of_verse}\nVers 1:\nA\n{end_of_verse}\n{start_of_chorus}\nVerse:\nB\n{end_of_chorus}\n{start_of_verse}\nKor:\nChorus:\nC\n{end_of_verse}\n";
        assert_eq!(
            label_sections(source),
            "{start_of_verse}\nA\n{end_of_verse}\n{start_of_verse}\nB\n{end_of_verse}\n{start_of_chorus}\nC\n{end_of_chorus}\n"
        );
    }

    #[test]
    fn creates_stable_hashes() {
        assert_eq!(content_hash("song"), content_hash("song"));
        assert_ne!(content_hash("song"), content_hash("Song"));
    }
}
