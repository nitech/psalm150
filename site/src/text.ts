/**
 * The page's words, in English and Norwegian. Each key is a {{key}} in
 * src/page.html; vite.config.ts writes the page once per language (/ and
 * /no/). Norwegian must have every key English has, which the type checks.
 * The values are HTML: a few hold a link or <br />, and none may hold a
 * double quote outside a tag, since some go into attributes.
 */

export const en = {
  html_lang: "en",
  og_locale: "en_US",
  canonical: "https://psalm150.app/",
  title: "Psalm150 · Song books for small churches",
  description:
    "Free worship software for small churches: the words on the screen, the chords for the musicians, the song book on every phone. A small download, no internet needed, and a song server that runs on a Raspberry Pi.",
  og_description:
    "The words on the screen, the chords for the musicians, the song book on every phone. Free, small, and it works without the internet.",
  // A Norwegian browser on its first visit gets the Norwegian page; a choice made with the language link stays.
  auto_language: `<script>
      try {
        if (!localStorage.getItem("psalm150-lang") && /^(nb|nn|no)\\b/i.test(navigator.language)) location.replace("/no/" + location.hash);
      } catch {}
    </script>`,
  skip: "Skip to the content",
  home: "/",
  home_label: "Psalm150, home",
  nav_label: "Main",
  nav_desktop: "Desktop",
  nav_server: "Song server",
  nav_source: "Source code",
  other_href: "/no/",
  other_lang: "nb",
  other_name: "Norsk",
  other_label: "Denne siden på norsk",
  download: "Download",

  hero_title: "Song books for<br />small churches.",
  hero_lead:
    "The words on the screen for everyone, the chords in front of the musicians, and the song book in every pocket. Free, small, and it works without the internet.",
  hero_more: "More platforms",
  hero_fine: "Free and open source · Windows, macOS and Linux",
  download_for: "Download for {system}",
  hero_fine_version: "Version {version} · {size} · Free and open source",
  console_alt:
    "The Psalm150 console: the song book on the left, Amazing Grace with chords, verse 2 on the screen and the order of the verses on the right.",
  phone_alt: "Amazing Grace with chords on a phone.",

  film_play: "Watch the film",
  film_length: "0:31",
  film_play_label: "Watch the film, 31 seconds, with sound",
  film_label: "Psalm150 in 31 seconds",
  film_close: "Close the film",
  film_src: "/films/psalm150-promo-en.mp4",
  film_poster: "/films/psalm150-promo-en.jpg",
  film_captions: "/films/psalm150-promo-en.vtt",
  film_captions_label: "English",

  verse: "Let every thing that hath breath praise the LORD. Praise ye the LORD.",
  verse_cite: "Psalm 150:6",
  verse_note:
    "Psalm150 exists to help song leaders and church members prepare, sing and share their songs, to the glory of the one Lord, Jesus Christ.",

  sunday_kicker: "On Sunday",
  sunday_title: "Everyone sings from the same page.",
  projector_alt:
    "The first verse of Amazing Grace on the projector: large white words on black, the song number and key in one corner, 1 of 4 in the other.",
  words_title: "Words for everyone",
  words_text: "White on black, as large as the screen allows and one size for the whole song. A line is never broken in the middle.",
  chords_title: "Chords for the musicians",
  chords_text: "A second screen shows the band the chords and what comes next, in the key you play it in.",
  phones_title: "On every phone",
  phones_text: "With a song server, anyone can follow the words on their own phone, as large as they need. No app and no account.",

  desktop_kicker: "The desktop app",
  desktop_title: "Made for the computer by the projector.",
  desktop_lead:
    "Search the song book, press Project, and the words are on the screen. Everything works on its own, with no server and no internet.",
  offline_title: "Your songs, offline",
  offline_text: "A folder of ChordPro files is the song book. Keep it in Dropbox if you like; a whole service runs without the internet.",
  sets_title: "Sets for the service",
  sets_text: "Put the songs in order during the week and step through them on Sunday.",
  remote_title: "A phone as the remote",
  remote_text: "Change the slides from anywhere in the room.",
  web_title: "Songs from the web",
  web_text: "When a song is missing, look it up, and lay the chords from the web over your own words.",
  vsb_title: "Bring your old song book",
  vsb_text: "Psalm150 reads a Visual Song Book database, and can keep the two in step.",
  updates_title: "Updates, never mid-service",
  updates_text: "New versions download in the background and install when you close the program.",

  small_kicker: "Small, on purpose",
  small_title: "Nothing a small church has to pay for or look after.",
  number_download: "to download for Windows",
  number_accounts: "accounts, subscriptions or cloud services",
  number_pi: "Raspberry Pi is enough for the song server",
  number_languages: "languages in the app for phones",

  server_kicker: "The song server, if you want one",
  server_title: "One song book for the whole church.",
  server_text:
    "Put the church's songs on a small server and everyone shares them: every song with its history, sets for each service shared on a link, and an app for phones with chords you can tap to hear. Desktops keep their own copy, so a service never waits for the network.",
  step_computer: "<strong>Find a computer.</strong> A Raspberry Pi is enough; anything that runs Docker will do.",
  step_start: "<strong>Start the server.</strong>",
  step_password: "Choose a long password in <code>.env</code> first.",
  step_open: "<strong>Open it</strong> on port 8080 and set up your church.",
  server_more: "How the song server works",
  list_alt: "The church's song list on a phone.",

  yours_title: "Your songs are yours.",
  yours_text: "Every song is a plain ChordPro text file. Keep them, copy them, or take them to another program: nothing is locked in.",
  yours_free:
    'Freely ye have received, freely give (Matthew 10:8). Psalm150 is free and open source under the <a href="https://github.com/nitech/psalm150/blob/main/LICENSE">MIT licence</a>.',

  download_title: "Download Psalm150",
  release_line: "Free for Windows, macOS and Linux. Installed copies keep themselves up to date.",
  release_line_version: "Version {version}, free for Windows, macOS and Linux. Installed copies keep themselves up to date.",
  your_system: "Your system",
  windows_versions: "Windows 10 and 11, 64-bit",
  windows_button: "Download the installer",
  mac_versions: "Macs with Apple silicon or Intel",
  linux_versions: "Ubuntu, Debian, Fedora and others",
  unsigned:
    'Psalm150 is not code-signed yet, so Windows and macOS may ask you to confirm the first time you open it. Every version and its notes are on <a href="https://github.com/nitech/psalm150/releases">GitHub</a>.',
  licence_note:
    "Psalm150 comes without songs. The songs you add belong to the people who wrote them, so keep your church's song licence (such as CCLI) in order.",

  foot_line: "Freely given. MIT licence.",
  foot_label: "More",
  foot_releases: "Releases",
  foot_server: "Song server",
};

export type Words = Record<keyof typeof en, string>;

export const no: Words = {
  html_lang: "nb",
  og_locale: "nb_NO",
  canonical: "https://psalm150.app/no/",
  title: "Psalm150 · Sangbøker for små menigheter",
  description:
    "Gratis sangprogram for små menigheter: ordene på lerretet, akkordene til musikerne og sangboka på alle mobiler. En liten nedlasting, uten internett, og en sangserver som går på en Raspberry Pi.",
  og_description:
    "Ordene på lerretet, akkordene til musikerne og sangboka på alle mobiler. Gratis, lite, og det virker uten internett.",
  auto_language: "",
  skip: "Hopp til innholdet",
  home: "/no/",
  home_label: "Psalm150, til forsiden",
  nav_label: "Hovedmeny",
  nav_desktop: "Programmet",
  nav_server: "Sangserver",
  nav_source: "Kildekode",
  other_href: "/",
  other_lang: "en",
  other_name: "English",
  other_label: "This page in English",
  download: "Last ned",

  hero_title: "Sangbøker for<br />små menigheter.",
  hero_lead:
    "Ordene på lerretet for alle, akkordene foran musikerne og sangboka i lomma til hver enkelt. Gratis, lite, og det virker uten internett.",
  hero_more: "Flere plattformer",
  hero_fine: "Gratis og åpen kildekode · Windows, macOS og Linux",
  download_for: "Last ned for {system}",
  hero_fine_version: "Versjon {version} · {size} · Gratis og åpen kildekode",
  console_alt:
    "Psalm150 på datamaskinen: sangboka til venstre, Amazing Grace med akkorder, vers 2 på lerretet og versrekkefølgen til høyre.",
  phone_alt: "Amazing Grace med akkorder på en mobil.",

  film_play: "Se filmen",
  film_length: "0:31",
  film_play_label: "Se filmen, 31 sekunder, med lyd",
  film_label: "Psalm150 på 31 sekunder",
  film_close: "Lukk filmen",
  film_src: "/films/psalm150-promo-no.mp4",
  film_poster: "/films/psalm150-promo-no.jpg",
  film_captions: "/films/psalm150-promo-no.vtt",
  film_captions_label: "Norsk",

  verse: "Alt som har ånde, skal prise Herren! Halleluja!",
  verse_cite: "Salme 150,6",
  verse_note:
    "Psalm150 finnes for å hjelpe sangledere og alle i menigheten med å forberede, synge og dele sangene sine, til ære for den ene Herren, Jesus Kristus.",

  sunday_kicker: "På søndag",
  sunday_title: "Alle synger fra samme ark.",
  projector_alt:
    "Første vers av Amazing Grace på lerretet: store hvite ord på svart, sangnummer og toneart i ett hjørne, 1 av 4 i det andre.",
  words_title: "Ord for alle",
  words_text: "Hvitt på svart, så stort som lerretet tillater, og samme størrelse gjennom hele sangen. En linje deles aldri på midten.",
  chords_title: "Akkorder til musikerne",
  chords_text: "En skjerm nummer to viser bandet akkordene og hva som kommer etterpå, i tonearten dere spiller i.",
  phones_title: "På alle mobiler",
  phones_text: "Med en sangserver kan alle følge ordene på sin egen mobil, så store de trenger. Uten app og uten konto.",

  desktop_kicker: "Programmet",
  desktop_title: "Laget for datamaskinen ved prosjektoren.",
  desktop_lead:
    "Søk i sangboka, trykk Vis, og ordene står på lerretet. Alt virker av seg selv, uten server og uten internett.",
  offline_title: "Sangene, uten nett",
  offline_text: "Sangboka er en mappe med ChordPro-filer. Legg den gjerne i Dropbox; en hel gudstjeneste går uten internett.",
  sets_title: "Sett til gudstjenesten",
  sets_text: "Sett sangene i rekkefølge i løpet av uka, og gå gjennom dem på søndag.",
  remote_title: "Mobilen som fjernkontroll",
  remote_text: "Bytt lysbilde fra hvor som helst i rommet.",
  web_title: "Sanger fra nettet",
  web_text: "Mangler en sang, slår du den opp og legger akkordene fra nettet over dine egne ord.",
  vsb_title: "Ta med den gamle sangboka",
  vsb_text: "Psalm150 leser en Visual Song Book-database og kan holde de to i takt.",
  updates_title: "Oppdateringer, aldri midt i gudstjenesten",
  updates_text: "Nye versjoner lastes ned i bakgrunnen og installeres når du lukker programmet.",

  small_kicker: "Lite, med vilje",
  small_title: "Ingenting en liten menighet må betale for eller passe på.",
  number_download: "å laste ned for Windows",
  number_accounts: "kontoer, abonnementer eller skytjenester",
  number_pi: "Raspberry Pi er nok til sangserveren",
  number_languages: "språk i appen for mobil",

  server_kicker: "Sangserveren, om dere vil ha den",
  server_title: "Én sangbok for hele menigheten.",
  server_text:
    "Legg menighetens sanger på en liten server, så deler alle dem: hver sang med sin historikk, sett til hver gudstjeneste delt med en lenke, og en app for mobil med akkorder du kan trykke på for å høre. Datamaskinene har sin egen kopi, så en gudstjeneste venter aldri på nettet.",
  step_computer: "<strong>Finn en datamaskin.</strong> En Raspberry Pi holder; alt som kjører Docker, går an.",
  step_start: "<strong>Start serveren.</strong>",
  step_password: "Velg et langt passord i <code>.env</code> først.",
  step_open: "<strong>Åpne den</strong> på port 8080, og sett opp menigheten.",
  server_more: "Slik virker sangserveren (på engelsk)",
  list_alt: "Menighetens sangliste på en mobil.",

  yours_title: "Sangene er deres.",
  yours_text: "Hver sang er en vanlig ChordPro-tekstfil. Ta vare på dem, kopier dem eller ta dem med til et annet program: ingenting er låst inne.",
  yours_free:
    'For ingenting har dere fått det, for ingenting skal dere gi det (Matt 10,8). Psalm150 er gratis og har åpen kildekode under <a href="https://github.com/nitech/psalm150/blob/main/LICENSE">MIT-lisensen</a>.',

  download_title: "Last ned Psalm150",
  release_line: "Gratis for Windows, macOS og Linux. Programmet holder seg oppdatert selv.",
  release_line_version: "Versjon {version}, gratis for Windows, macOS og Linux. Programmet holder seg oppdatert selv.",
  your_system: "Ditt system",
  windows_versions: "Windows 10 og 11, 64-bit",
  windows_button: "Last ned installasjonsfilen",
  mac_versions: "Mac med Apple silicon eller Intel",
  linux_versions: "Ubuntu, Debian, Fedora og andre",
  unsigned:
    'Psalm150 er ikke kodesignert ennå, så Windows og macOS kan be deg bekrefte første gang du åpner det. Alle versjoner og hva som er nytt i dem, står på <a href="https://github.com/nitech/psalm150/releases">GitHub</a>.',
  licence_note:
    "Psalm150 kommer uten sanger. Sangene dere legger inn, tilhører dem som har skrevet dem, så sørg for at menighetens sanglisens (for eksempel CCLI) er i orden.",

  foot_line: "Gitt for ingenting. MIT-lisens.",
  foot_label: "Mer",
  foot_releases: "Versjoner",
  foot_server: "Sangserver",
};
