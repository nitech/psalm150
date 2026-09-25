//! Library search: every word of the query must appear in the song's title,
//! lyrics or tags. Words match as a prefix or substring, and longer words also
//! match with a spelling mistake or two, so "amzing grase" finds "Amazing
//! Grace". A song number (`227`, `#227`) matches like before.
//!
//! Each hit gets a [`MatchRank`]; the console lists better ranks first.

/// How well a song matched, best first. Serialised as a number (0–3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MatchRank {
    /// Every word is in the title (or the query is the song number).
    Title = 0,
    /// Every word is in the title, some with a spelling mistake.
    TitleFuzzy = 1,
    /// Every word is in the title, lyrics or tags.
    Text = 2,
    /// Every word is in the title, lyrics or tags, some with a spelling mistake.
    TextFuzzy = 3,
}

/// The searchable text of one song, normalised once so it can be cached.
pub struct SearchDoc {
    title: Field,
    text: Field,
    song_num: Option<i64>,
}

impl SearchDoc {
    pub fn new(title: &str, body: &str, tags: &str, song_num: Option<i64>) -> Self {
        Self {
            title: Field::new(title),
            text: Field::new(&format!("{body}\n{tags}")),
            song_num,
        }
    }
}

pub struct Query {
    words: Vec<String>,
    /// Digits of a number-only query (`227` or `#227`).
    number: Option<String>,
}

impl Query {
    pub fn parse(raw: &str) -> Self {
        let trimmed = raw.trim();
        let digits = trimmed.strip_prefix('#').unwrap_or(trimmed);
        let number = (!digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()))
            .then(|| digits.to_string());
        Self {
            words: words(&normalize(trimmed)),
            number,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.words.is_empty() && self.number.is_none()
    }

    pub fn rank(&self, doc: &SearchDoc) -> Option<MatchRank> {
        if let (Some(number), Some(song_num)) = (&self.number, doc.song_num) {
            if song_num.to_string().contains(number.as_str()) {
                return Some(MatchRank::Title);
            }
        }
        if self.words.is_empty() {
            return None;
        }
        let (title, text) = (&doc.title, &doc.text);

        let mut in_title = true;
        let mut title_fuzzy = false;
        let mut text_fuzzy = false;
        for word in &self.words {
            let title_hit = title.find(word);
            match title_hit {
                Hit::Exact => {}
                Hit::Fuzzy => title_fuzzy = true,
                Hit::None => in_title = false,
            }
            let best = match (title_hit, text.find(word)) {
                (Hit::Exact, _) | (_, Hit::Exact) => Hit::Exact,
                (Hit::Fuzzy, _) | (_, Hit::Fuzzy) => Hit::Fuzzy,
                _ => return None,
            };
            if best == Hit::Fuzzy {
                text_fuzzy = true;
            }
        }
        Some(match (in_title, title_fuzzy, text_fuzzy) {
            (true, false, _) => MatchRank::Title,
            (true, true, _) => MatchRank::TitleFuzzy,
            (false, _, false) => MatchRank::Text,
            (false, _, true) => MatchRank::TextFuzzy,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Hit {
    Exact,
    Fuzzy,
    None,
}

struct Field {
    text: String,
    /// Distinct words, as characters for the edit distance.
    words: Vec<Vec<char>>,
}

impl Field {
    fn new(raw: &str) -> Self {
        let text = normalize(raw);
        let mut words = words(&text);
        words.sort_unstable();
        words.dedup();
        let words = words.iter().map(|word| word.chars().collect()).collect();
        Self { text, words }
    }

    fn find(&self, word: &str) -> Hit {
        if self.text.contains(word) {
            return Hit::Exact;
        }
        let allowed = allowed_typos(word);
        if allowed == 0 {
            return Hit::None;
        }
        let query: Vec<char> = word.chars().collect();
        let fuzzy = self.words.iter().any(|candidate| {
            if candidate.len().abs_diff(query.len()) <= allowed
                && edit_distance(&query, candidate) <= allowed
            {
                return true;
            }
            // A word still being typed: compare with the start of longer words.
            candidate.len() > query.len()
                && edit_distance(&query, &candidate[..query.len()]) <= allowed
        });
        if fuzzy {
            Hit::Fuzzy
        } else {
            Hit::None
        }
    }
}

/// Short words must be exact; longer words may have one or two mistakes.
fn allowed_typos(word: &str) -> usize {
    match word.chars().count() {
        0..=3 => 0,
        4..=6 => 1,
        _ => 2,
    }
}

/// Lower case, accents folded (é → e), apostrophes dropped (it's → its).
/// Letters such as æ, ø and å are kept: they are letters of their own.
fn normalize(text: &str) -> String {
    text.chars()
        .filter(|c| !matches!(c, '\'' | '’' | '`' | '´'))
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ã' => 'a',
            'ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ñ' => 'n',
            'ò' | 'ó' | 'ô' | 'õ' => 'o',
            'ù' | 'ú' | 'û' => 'u',
            'ý' | 'ÿ' => 'y',
            other => other,
        })
        .collect()
}

fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_string)
        .collect()
}

/// Optimal string alignment distance: insertions, deletions, substitutions
/// and swaps of two neighbouring letters each count as one mistake.
fn edit_distance(a: &[char], b: &[char]) -> usize {
    let width = b.len() + 1;
    // Rows i-2, i-1 and i of the distance table.
    let mut before: Vec<usize> = vec![0; width];
    let mut previous: Vec<usize> = (0..width).collect();
    let mut current: Vec<usize> = vec![0; width];
    for i in 1..=a.len() {
        current[0] = i;
        for j in 1..width {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut best = (previous[j] + 1)
                .min(current[j - 1] + 1)
                .min(previous[j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                best = best.min(before[j - 2] + 1);
            }
            current[j] = best;
        }
        std::mem::swap(&mut before, &mut previous);
        std::mem::swap(&mut previous, &mut current);
    }
    previous[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(title: &str, body: &str) -> SearchDoc {
        SearchDoc::new(title, body, "", None)
    }

    fn rank(query: &str, doc: &SearchDoc) -> Option<MatchRank> {
        Query::parse(query).rank(doc)
    }

    #[test]
    fn edit_distance_counts_swaps_as_one() {
        let d = |a: &str, b: &str| {
            edit_distance(
                &a.chars().collect::<Vec<_>>(),
                &b.chars().collect::<Vec<_>>(),
            )
        };
        assert_eq!(d("grace", "grace"), 0);
        assert_eq!(d("grase", "grace"), 1);
        assert_eq!(d("gace", "grace"), 1);
        assert_eq!(d("garce", "grace"), 1);
        assert_eq!(d("amzing", "amazing"), 1);
        assert_eq!(d("", "abc"), 3);
    }

    #[test]
    fn title_words_rank_above_lyrics() {
        let grace = doc("Amazing Grace", "how sweet the sound");
        let other = doc("Holy Holy", "his grace is enough");
        assert_eq!(rank("grace", &grace), Some(MatchRank::Title));
        assert_eq!(rank("grace", &other), Some(MatchRank::Text));
        assert_eq!(rank("sweet sound", &grace), Some(MatchRank::Text));
    }

    #[test]
    fn spelling_mistakes_still_match() {
        let grace = doc("Amazing Grace", "that saved a wretch like me");
        assert_eq!(rank("amzing grase", &grace), Some(MatchRank::TitleFuzzy));
        assert_eq!(rank("wretch", &grace), Some(MatchRank::Text));
        assert_eq!(rank("wrech", &grace), Some(MatchRank::TextFuzzy));
        assert_eq!(rank("amazing wrech", &grace), Some(MatchRank::TextFuzzy));
    }

    #[test]
    fn every_word_must_match() {
        let grace = doc("Amazing Grace", "how sweet the sound");
        assert_eq!(rank("amazing love", &grace), None);
        assert_eq!(rank("xyz", &grace), None);
    }

    #[test]
    fn short_words_are_not_fuzzy() {
        let song = doc("Your Love", "");
        assert_eq!(rank("lov", &song), Some(MatchRank::Title));
        assert_eq!(rank("lob", &song), None);
    }

    #[test]
    fn a_word_being_typed_matches_with_a_mistake() {
        let song = doc("Hallelujah", "");
        assert_eq!(rank("haleluj", &song), Some(MatchRank::TitleFuzzy));
    }

    #[test]
    fn apostrophes_and_accents_are_ignored() {
        let song = doc("It's Your Blood", "Café Noël");
        assert_eq!(rank("its your", &song), Some(MatchRank::Title));
        assert_eq!(rank("cafe noel", &song), Some(MatchRank::Text));
    }

    #[test]
    fn norwegian_letters_are_kept() {
        let song = doc("Å, for en dag", "Guds nåde");
        assert_eq!(rank("å for", &song), Some(MatchRank::Title));
        assert_eq!(rank("nåde", &song), Some(MatchRank::Text));
        assert_eq!(rank("nade", &song), Some(MatchRank::TextFuzzy));
    }

    #[test]
    fn song_numbers_match_with_or_without_hash() {
        let song = SearchDoc::new("Amazing Grace", "", "", Some(227));
        assert_eq!(rank("227", &song), Some(MatchRank::Title));
        assert_eq!(rank("#22", &song), Some(MatchRank::Title));
        assert_eq!(rank("#300", &song), None);
    }

    #[test]
    fn tags_are_searched() {
        let song = SearchDoc::new("Song", "", "christmas advent", None);
        assert_eq!(rank("advent", &song), Some(MatchRank::Text));
    }
}
