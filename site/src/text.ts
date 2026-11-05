/**
 * The page's words, in English and Norwegian. Each key is a {{key}} in
 * src/page.html; vite.config.ts writes the page once per language (/ and
 * /no/). Norwegian must have every key English has, which the type checks.
 * The values are HTML: a few hold a link, <strong> or <code>, and none may
 * hold a double quote outside a tag, since some go into attributes.
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
  nav_questions: "Questions",
  other_href: "/no/",
  other_lang: "nb",
  other_name: "Norsk",
  other_label: "Denne siden på norsk",
  download: "Download",

  hero_title: "Song books for",
  hero_title_2: "small churches.",
  hero_lead:
    "Psalm150 puts the words on the screen for everyone, the chords in front of the musicians, and the song book in every pocket. <strong>Free, small, and it works without the internet.</strong>",
  download_for: "Download for {system}",
  hero_film: "Watch the film",
  stat_size_label: "download",
  stat_accounts_label: "accounts",
  stat_languages_label: "languages",
  wall_label: "Watch the film, 31 seconds, with sound",
  wall_hint: "Press any window for the film",
  free_line: "Free and open source under the MIT licence, for Windows, macOS and Linux",

  film_label: "Psalm150 in 31 seconds",
  film_close: "Close the film",
  film_src: "/films/psalm150-promo-en.mp4",
  film_poster: "/films/psalm150-promo-en.jpg",
  film_captions: "/films/psalm150-promo-en.vtt",
  film_captions_label: "English",

  views_title: "Type a line.",
  views_title_2: "The whole church sings.",
  views_try: "See it from every seat:",
  views_label: "Psalm150 from every seat",
  view_console: "Console",
  view_screen: "Screen",
  view_band: "Band",
  view_phones: "Phones",
  view_chords: "Chords",
  view_web: "Web",
  view_console_text: "Type a few words you remember. The song comes up, and Project puts it on the screen.",
  view_screen_text: "White on black, as large as the screen allows and one size for the whole song. A line is never broken in the middle.",
  view_band_text: "A second screen shows the band the chords and what comes next, in the key you play it in.",
  view_phones_text: "With a song server, anyone can follow the words on their own phone, as large as they need. No app and no account.",
  view_chords_text: "Press a chord to see how it is played, shape by shape, and to hear it.",
  view_web_text: "When a song is missing, look it up online and lay the chords from the web over your own words.",
  search_alt: "The Psalm150 console: how sweet typed in the search, Amazing Grace found, with its chords and verses.",
  projector_alt: "The second verse of Amazing Grace on the projector: large white words on black, the song number and key in one corner, 2 of 4 in the other.",
  stage_alt: "The musicians' screen: the verse on the screen with its chords, and the next one under it.",
  room_alt: "A phone following Amazing Grace in a room: verse 2 marked as it is sung.",
  phone_alt: "Amazing Grace with chords on a phone.",
  chord_alt: "The G7 chord on the guitar, one of its six shapes, opened from Amazing Grace.",
  web_alt: "Be Still, My Soul found online and saved to the song book, with its chords.",

  desktop_title: "Made for the computer",
  desktop_title_2: "by the projector.",
  desktop_lead:
    "Everything works on its own, with no server and no internet. A folder of song files is the song book, and a whole service runs offline.",
  sets_alt: "A set for Sunday with three hymns, the first one on the screen and its verses in order.",
  step_find_title: "It finds the song",
  step_find_text: "Search, type a few words you remember, and press Enter. The words are on the screen.",
  step_walk_title: "It steps through it",
  step_walk_text: "The arrows go to the next and previous verse, and a number goes straight to that verse.",
  step_blank_title: "It gets out of the way",
  step_blank_text: "B blanks the screen between songs, for prayer, a reading or the sermon.",
  key_verse: "verse",

  contents: "Contents",
  offline_title: "Your songs, offline",
  offline_text:
    "The song book is a folder of <strong>ChordPro</strong> files, plain text with the chords in brackets. Keep it in Dropbox if you like; a whole service runs without the internet.",
  offline_folder: "Song book/",
  offline_tree_note: "one song per file",
  web_title: "Songs from the web",
  web_text:
    "When a song is missing, look it up. Psalm150 finds the words and the chords online and lays the chords over <strong>your own words</strong>, so you keep the version your church sings.",
  remote_title: "A phone as the remote",
  remote_text:
    "Change the slides from anywhere in the room. The phone shows what is on the screen, the verses to jump to, and a key to blank it.",
  remote_alt: "A phone as the remote: Amazing Grace verse 2 on the screen now, with Previous, Blank and Next, and the verses to jump to.",
  vsb_title: "Bring your old song book",
  vsb_text:
    "Psalm150 reads a <strong>Visual Song Book</strong> database, and can keep the two in step while you move over.",
  import_alt: "The import report: 37 hymns imported, none skipped and none failed.",
  server_title: "The song server, if you want one",
  server_text:
    "Put the church's songs on a small server and everyone shares them: every song with its history, sets for each service shared on a link, and an app for phones with chords you can tap to hear. Desktops keep their own copy, so a service never waits for the network.",
  server_steps:
    "A <strong>Raspberry Pi</strong> is enough; anything that runs Docker will do. Choose a long password in <code>.env</code> first, then open it on port 8080 and set up your church.",
  restart: "Restart",
  copy: "Copy",
  copied: "Copied",
  copy_label: "Copy the commands",
  list_alt: "The church's song list on a phone.",
  server_more: "How the song server works",
  updates_title: "Updates, never mid-service",
  updates_text:
    "New versions download in the background and install when you close the program. A service is never interrupted by an update.",
  yours_title: "Your songs are yours",
  yours_text:
    "Every song is a plain text file. Keep them, copy them, or take them to another program: nothing is locked in. Freely ye have received, freely give (Matthew 10:8): Psalm150 is free and open source under the <a href=\"https://github.com/nitech/psalm150/blob/main/LICENSE\">MIT licence</a>.",
  source_more: "nitech/psalm150",

  questions_title: "Questions",
  q_what: "What is Psalm150?",
  a_what:
    "Free worship software for small churches: a desktop app that puts the words on the screen and the chords in front of the musicians, and a song server, if you want one, that puts the song book on every phone.",
  q_internet: "Does it need the internet?",
  a_internet:
    "No. The desktop app runs a whole service offline. Only looking songs up online and downloading updates need a connection.",
  q_systems: "Which systems does it run on?",
  a_systems:
    "Windows 10 and 11 (64-bit), macOS on Apple silicon and Intel, and Linux (.deb, .rpm and AppImage). The song server runs anywhere Docker does, a Raspberry Pi included.",
  q_free: "Is it free?",
  a_free: "Yes, and it stays free. It is open source under the MIT licence, with no accounts and no subscriptions.",
  q_songs: "Where do the songs come from?",
  a_songs:
    "From you. Psalm150 comes without songs: add your own, bring a Visual Song Book database, or look songs up online. The songs belong to the people who wrote them, so keep your church's song licence (such as CCLI) in order.",
  q_server: "Do we need the song server?",
  a_server:
    "No. The desktop app works on its own. The server is for a church that wants one shared song book, sets on a link and the words on everyone's phone.",
  q_warning: "Why does Windows or macOS ask me to confirm?",
  a_warning: "Psalm150 is not code-signed yet, so the system asks you to confirm the first time you open it.",

  verse: "Let every thing that hath breath",
  verse_2: "praise the LORD.",
  verse_cite: "Psalm 150:6",
  verse_note:
    "Psalm150 exists to help song leaders and church members prepare, sing and share their songs, to the glory of the one Lord, Jesus Christ.",
  systems_label: "Systems",
  windows_file: "Installer",
  windows_note: "Windows 10 and 11, 64-bit",
  mac_arm_note: "Macs with Apple silicon",
  mac_intel_note: "Macs with Intel",
  deb_note: "Ubuntu, Debian and others",
  rpm_note: "Fedora and others",
  appimage_note: "Any other Linux",
  release_line: "Installed copies keep themselves up to date.",
  release_line_version: "Version {version}. Installed copies keep themselves up to date.",
  releases_more: "Every version and its notes",

  foot_tagline: "Song books for small churches.",
  foot_line: "Freely given. MIT licence.",
  foot_label: "More",
  foot_product: "Product",
  foot_learn: "Learn",
  foot_community: "Community",
  foot_film: "The film",
  foot_releases: "Releases",
  foot_server_docs: "How the server works",
  foot_issues: "Questions and bugs",
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
  nav_questions: "Spørsmål",
  other_href: "/",
  other_lang: "en",
  other_name: "English",
  other_label: "This page in English",
  download: "Last ned",

  hero_title: "Sangbøker for",
  hero_title_2: "små menigheter.",
  hero_lead:
    "Psalm150 gir alle ordene på lerretet, musikerne akkordene foran seg og hver enkelt sangboka i lomma. <strong>Gratis, lite, og det virker uten internett.</strong>",
  download_for: "Last ned for {system}",
  hero_film: "Se filmen",
  stat_size_label: "nedlasting",
  stat_accounts_label: "kontoer",
  stat_languages_label: "språk",
  wall_label: "Se filmen, 31 sekunder, med lyd",
  wall_hint: "Trykk på et vindu for å se filmen",
  free_line: "Gratis og åpen kildekode under MIT-lisensen, for Windows, macOS og Linux",

  film_label: "Psalm150 på 31 sekunder",
  film_close: "Lukk filmen",
  film_src: "/films/psalm150-promo-no.mp4",
  film_poster: "/films/psalm150-promo-no.jpg",
  film_captions: "/films/psalm150-promo-no.vtt",
  film_captions_label: "Norsk",

  views_title: "Skriv en linje.",
  views_title_2: "Hele menigheten synger.",
  views_try: "Se det fra alle plasser:",
  views_label: "Psalm150 fra alle plasser",
  view_console: "Konsollen",
  view_screen: "Lerretet",
  view_band: "Bandet",
  view_phones: "Mobilene",
  view_chords: "Akkordene",
  view_web: "Nettet",
  view_console_text: "Skriv noen ord du husker. Sangen kommer opp, og Vis setter den på lerretet.",
  view_screen_text: "Hvitt på svart, så stort som lerretet tillater, og samme størrelse gjennom hele sangen. En linje deles aldri på midten.",
  view_band_text: "En skjerm nummer to viser bandet akkordene og hva som kommer etterpå, i tonearten dere spiller i.",
  view_phones_text: "Med en sangserver kan alle følge ordene på sin egen mobil, så store de trenger. Uten app og uten konto.",
  view_chords_text: "Trykk på en akkord for å se hvordan den tas, grep for grep, og høre den.",
  view_web_text: "Mangler en sang, slår du den opp på nettet og legger akkordene over dine egne ord.",
  search_alt: "Psalm150 på datamaskinen: how sweet skrevet i søket, Amazing Grace funnet, med akkorder og vers.",
  projector_alt: "Andre vers av Amazing Grace på lerretet: store hvite ord på svart, sangnummer og toneart i ett hjørne, 2 av 4 i det andre.",
  stage_alt: "Musikernes skjerm: verset på lerretet med akkordene, og det neste under.",
  room_alt: "En mobil som følger Amazing Grace i et rom: vers 2 markert mens det synges.",
  phone_alt: "Amazing Grace med akkorder på en mobil.",
  chord_alt: "G7-akkorden på gitar, ett av seks grep, åpnet fra Amazing Grace.",
  web_alt: "Be Still, My Soul funnet på nettet og lagret i sangboka, med akkorder.",

  desktop_title: "Laget for datamaskinen",
  desktop_title_2: "ved prosjektoren.",
  desktop_lead:
    "Alt virker av seg selv, uten server og uten internett. Sangboka er en mappe med sangfiler, og en hel gudstjeneste går uten nett.",
  sets_alt: "Et sett til søndag med tre salmer, den første på lerretet og versene i rekkefølge.",
  step_find_title: "Den finner sangen",
  step_find_text: "Søk, skriv noen ord du husker, og trykk Enter. Ordene står på lerretet.",
  step_walk_title: "Den går gjennom den",
  step_walk_text: "Pilene går til neste og forrige vers, og et tall går rett til det verset.",
  step_blank_title: "Den går av veien",
  step_blank_text: "B gjør lerretet blankt mellom sangene, til bønn, lesning eller preken.",
  key_verse: "vers",

  contents: "Innhold",
  offline_title: "Sangene, uten nett",
  offline_text:
    "Sangboka er en mappe med <strong>ChordPro</strong>-filer, vanlig tekst med akkordene i klammer. Legg den gjerne i Dropbox; en hel gudstjeneste går uten internett.",
  offline_folder: "Sangbok/",
  offline_tree_note: "én sang per fil",
  web_title: "Sanger fra nettet",
  web_text:
    "Mangler en sang, slår du den opp. Psalm150 finner ord og akkorder på nettet og legger akkordene over <strong>deres egne ord</strong>, så dere beholder versjonen menigheten synger.",
  remote_title: "Mobilen som fjernkontroll",
  remote_text:
    "Bytt lysbilde fra hvor som helst i rommet. Mobilen viser hva som står på lerretet, versene du kan hoppe til, og en knapp som gjør lerretet blankt.",
  remote_alt: "Mobilen som fjernkontroll: Amazing Grace vers 2 på lerretet nå, med Forrige, Blankt og Neste, og versene du kan hoppe til.",
  vsb_title: "Ta med den gamle sangboka",
  vsb_text: "Psalm150 leser en <strong>Visual Song Book</strong>-database og kan holde de to i takt mens dere flytter over.",
  import_alt: "Importrapporten: 37 salmer importert, ingen hoppet over og ingen feilet.",
  server_title: "Sangserveren, om dere vil ha den",
  server_text:
    "Legg menighetens sanger på en liten server, så deler alle dem: hver sang med sin historikk, sett til hver gudstjeneste delt med en lenke, og en app for mobil med akkorder du kan trykke på for å høre. Datamaskinene har sin egen kopi, så en gudstjeneste venter aldri på nettet.",
  server_steps:
    "En <strong>Raspberry Pi</strong> holder; alt som kjører Docker, går an. Velg et langt passord i <code>.env</code> først, åpne den på port 8080, og sett opp menigheten.",
  restart: "Spill igjen",
  copy: "Kopier",
  copied: "Kopiert",
  copy_label: "Kopier kommandoene",
  list_alt: "Menighetens sangliste på en mobil.",
  server_more: "Slik virker sangserveren (på engelsk)",
  updates_title: "Oppdateringer, aldri midt i gudstjenesten",
  updates_text:
    "Nye versjoner lastes ned i bakgrunnen og installeres når du lukker programmet. En gudstjeneste blir aldri avbrutt av en oppdatering.",
  yours_title: "Sangene er deres",
  yours_text:
    "Hver sang er en vanlig tekstfil. Ta vare på dem, kopier dem eller ta dem med til et annet program: ingenting er låst inne. For ingenting har dere fått det, for ingenting skal dere gi det (Matt 10,8): Psalm150 er gratis og har åpen kildekode under <a href=\"https://github.com/nitech/psalm150/blob/main/LICENSE\">MIT-lisensen</a>.",
  source_more: "nitech/psalm150",

  questions_title: "Spørsmål",
  q_what: "Hva er Psalm150?",
  a_what:
    "Et gratis sangprogram for små menigheter: et program på datamaskinen som setter ordene på lerretet og akkordene foran musikerne, og en sangserver, om dere vil ha den, som gir alle sangboka på mobilen.",
  q_internet: "Trenger det internett?",
  a_internet: "Nei. Programmet kjører en hel gudstjeneste uten nett. Bare søk etter sanger på nettet og nedlasting av oppdateringer trenger tilkobling.",
  q_systems: "Hvilke systemer virker det på?",
  a_systems:
    "Windows 10 og 11 (64-bit), macOS på Apple silicon og Intel, og Linux (.deb, .rpm og AppImage). Sangserveren går overalt der Docker går, også på en Raspberry Pi.",
  q_free: "Er det gratis?",
  a_free: "Ja, og det forblir gratis. Det har åpen kildekode under MIT-lisensen, uten kontoer og uten abonnement.",
  q_songs: "Hvor kommer sangene fra?",
  a_songs:
    "Fra dere. Psalm150 kommer uten sanger: legg inn deres egne, ta med en Visual Song Book-database, eller slå opp sanger på nettet. Sangene tilhører dem som har skrevet dem, så sørg for at menighetens sanglisens (for eksempel CCLI) er i orden.",
  q_server: "Trenger vi sangserveren?",
  a_server:
    "Nei. Programmet virker av seg selv. Serveren er for en menighet som vil ha én felles sangbok, sett delt med en lenke og ordene på alles mobil.",
  q_warning: "Hvorfor ber Windows eller macOS meg bekrefte?",
  a_warning: "Psalm150 er ikke kodesignert ennå, så systemet ber deg bekrefte første gang du åpner det.",

  verse: "Alt som har ånde,",
  verse_2: "skal prise Herren!",
  verse_cite: "Salme 150,6",
  verse_note:
    "Psalm150 finnes for å hjelpe sangledere og alle i menigheten med å forberede, synge og dele sangene sine, til ære for den ene Herren, Jesus Kristus.",
  systems_label: "Systemer",
  windows_file: "Installasjonsfil",
  windows_note: "Windows 10 og 11, 64-bit",
  mac_arm_note: "Mac med Apple silicon",
  mac_intel_note: "Mac med Intel",
  deb_note: "Ubuntu, Debian og andre",
  rpm_note: "Fedora og andre",
  appimage_note: "Alle andre Linux",
  release_line: "Programmet holder seg oppdatert selv.",
  release_line_version: "Versjon {version}. Programmet holder seg oppdatert selv.",
  releases_more: "Alle versjoner og hva som er nytt",

  foot_tagline: "Sangbøker for små menigheter.",
  foot_line: "Gitt for ingenting. MIT-lisens.",
  foot_label: "Mer",
  foot_product: "Produkt",
  foot_learn: "Lær mer",
  foot_community: "Fellesskap",
  foot_film: "Filmen",
  foot_releases: "Versjoner",
  foot_server_docs: "Slik virker serveren",
  foot_issues: "Spørsmål og feil",
};
