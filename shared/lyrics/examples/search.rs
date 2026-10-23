//! Try a search from the command line:
//! `cargo run --example search -- "way maker"`

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let query = std::env::args().skip(1).collect::<Vec<_>>().join(" ");
    let client = psa150_lyrics::client().expect("client");
    let started = std::time::Instant::now();
    match psa150_lyrics::search(&client, &query).await {
        Ok(found) => {
            eprintln!("{} results in {:.1?}", found.len(), started.elapsed());
            for candidate in found {
                println!(
                    "===== {} | {:?} | {}",
                    candidate.title, candidate.artist, candidate.source_url
                );
                println!("{}", candidate.chordpro_content);
            }
        }
        Err(error) => eprintln!("failed after {:.1?}: {error}", started.elapsed()),
    }
}
