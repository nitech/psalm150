//! Print the text blocks a page yields: `cargo run --example raw -- <url>`

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let url = std::env::args().nth(1).expect("url");
    let client = psa150_lyrics::client().expect("client");
    let html = client
        .get(&url)
        .send()
        .await
        .expect("fetch")
        .text()
        .await
        .expect("body");
    let page = psa150_lyrics::page::read(&url, &html).expect("page");
    println!("title {:?} artist {:?}", page.title, page.artist);
    for block in page.blocks.iter().take(1) {
        println!("--- pre={}\n{}", block.preformatted, block.text);
    }
}
