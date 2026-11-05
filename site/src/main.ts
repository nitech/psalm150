import "./site.css";

/**
 * The page's behaviour: download links from the latest GitHub release, the
 * tabs (the views from every seat, and a download for each system), the
 * contents marking the part being read, the copy button, the film, and the
 * language link.
 *
 * Each download button gets its file and size, and the hero's button the
 * visitor's system. Without an answer from GitHub every link still leads to
 * the releases page.
 *
 * The page comes in English and Norwegian (src/text.ts). The words this
 * script fills in come from the page itself, as `data-template` with
 * {version}, {size} or {system} in them, so the script has no words of its own.
 */

interface Asset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface Release {
  tag_name: string;
  assets: Asset[];
}

type Os = "windows" | "mac" | "linux" | "other";

/** Which file each button offers, by the release's file names. */
const FILES: Record<string, RegExp> = {
  windows: /_x64-setup\.exe$/,
  "mac-arm": /_aarch64\.dmg$/,
  "mac-intel": /_x64\.dmg$/,
  deb: /_amd64\.deb$/,
  rpm: /\.x86_64\.rpm$/,
  appimage: /\.AppImage$/,
};

const SYSTEM_NAMES: Record<Exclude<Os, "other">, string> = {
  windows: "Windows",
  mac: "macOS",
  linux: "Linux",
};

const LANG = document.documentElement.lang || "en";

/** Those who ask for less motion get still windows: no playing, no typing. */
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** One step of a live window: a frame of `public/live/<name>/`, and how long it shows (ms). */
type Step = [frame: number, ms: number];
const run = (from: number, to: number, ms: number): Step[] =>
  Array.from({ length: to - from + 1 }, (_, index): Step => [from + index, ms]);

/**
 * The live windows: the real apps, captured frame by frame, played at the pace
 * they were used. A loop holds its last frame, then starts over; a window
 * marked `data-once` stays on its last frame and offers Restart.
 */
const LIVE: Record<string, Step[]> = {
  // Idle, the search field, "how sweet" a key at a time, then verses 1 to 3 on the screen.
  console: [[0, 1200], [1, 500], ...run(2, 9, 110), [10, 900], [11, 2200], [12, 2200], [13, 2800]],
  screen: [[0, 2600], [1, 2600], [2, 2600]],
  band: [[0, 3000], [1, 3000]],
  // Verse 1; then the phone moves on to verse 2, and to verse 3, as they are sung.
  room: [[0, 2200], [1, 400], ...run(2, 6, 70), [7, 2200], [8, 400], ...run(9, 13, 70), [14, 2600]],
  // G7: its shape on the guitar, the next shape, then closed.
  chord: [[0, 1200], [1, 700], [2, 2200], [3, 700], [4, 2200], [5, 700], [6, 1600]],
  // "be still my soul", looked up online, found, and saved with its chords.
  web: [[0, 1000], [1, 500], ...run(2, 13, 90), [14, 700], [15, 800], [16, 1400], [17, 1600], [18, 700], [19, 1200], [20, 2600]],
  // A hymn added to Sunday's set, the set opened, and its first song on the screen.
  sets: [[0, 1200], [1, 700], [2, 900], [3, 900], [4, 700], [5, 1400], [6, 700], [7, 0]],
  // A Visual Song Book imported, 37 hymns, and the report.
  import: [[0, 1000], [1, 700], ...run(2, 10, 260), [11, 900], [12, 0]],
  remote: [[0, 2400], [1, 2400], [2, 2400]],
};

function visitorOs(): Os {
  const agent = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod/i.test(agent)) return "other";
  if (/Windows/i.test(agent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(agent)) return "mac";
  if (/Linux|X11/i.test(agent)) return "linux";
  return "other";
}

/** "7.4 MB", or "7,4 MB" in Norwegian; `whole` leaves out ".0". */
const megabytes = (bytes: number, whole = false) =>
  `${(bytes / 1048576).toLocaleString(LANG, { minimumFractionDigits: whole ? 0 : 1, maximumFractionDigits: 1 })} MB`;

/** An element's `data-template` with its {names} filled in, as its text. */
function fill(element: HTMLElement | null, values: Record<string, string>) {
  const template = element?.dataset.template;
  if (!element || !template) return;
  element.textContent = template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

function showRelease(release: Release, os: Os) {
  const files: Record<string, Asset> = {};
  for (const [key, pattern] of Object.entries(FILES)) {
    const asset = release.assets.find((candidate) => pattern.test(candidate.name));
    if (asset) files[key] = asset;
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-asset]")) {
    const asset = files[link.dataset.asset ?? ""];
    if (asset) link.href = asset.browser_download_url;
  }
  for (const note of document.querySelectorAll<HTMLElement>("[data-size]")) {
    const asset = files[note.dataset.size ?? ""];
    if (asset) note.textContent = `${asset.name.replace(/^Psalm150_?/, "")} · ${megabytes(asset.size)}`;
  }
  fill(document.getElementById("release-line"), { version: release.tag_name.replace(/^v/, "") });
  const windows = files.windows;
  const windowsSize = document.getElementById("windows-size");
  if (windows && windowsSize) windowsSize.textContent = megabytes(windows.size, true);
  // On Windows the hero's button is the installer itself.
  const hero = document.getElementById("hero-download") as HTMLAnchorElement | null;
  if (hero && os === "windows" && windows) hero.href = windows.browser_download_url;
}

/**
 * A tab list: pressing a tab shows its panel and hides the others; the arrow
 * keys, Home and End move between tabs (one tab in the Tab order, as ARIA
 * describes). Returns a way to choose a tab from the script.
 */
function tabs(list: HTMLElement): (tab: HTMLElement) => void {
  const all = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  const choose = (tab: HTMLElement, focus = false) => {
    for (const other of all) {
      const chosen = other === tab;
      other.setAttribute("aria-selected", String(chosen));
      other.tabIndex = chosen ? 0 : -1;
      const panel = document.getElementById(other.getAttribute("aria-controls") ?? "");
      if (!panel) continue;
      // A panel coming into view fades up.
      if (chosen && panel.hidden && !REDUCED) {
        panel.classList.remove("entering");
        void panel.offsetWidth;
        panel.classList.add("entering");
      }
      panel.hidden = !chosen;
    }
    if (focus) tab.focus();
  };
  for (const tab of all) tab.addEventListener("click", () => choose(tab));
  list.addEventListener("keydown", (event) => {
    const index = all.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    const next =
      event.key === "ArrowRight" ? all[(index + 1) % all.length]
      : event.key === "ArrowLeft" ? all[(index - 1 + all.length) % all.length]
      : event.key === "Home" ? all[0]
      : event.key === "End" ? all[all.length - 1]
      : null;
    if (!next) return;
    event.preventDefault();
    choose(next, true);
  });
  return (tab) => choose(tab);
}

/** The contents mark the part being read (the last one whose heading has passed the top third). */
function contents() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>(".toc a")];
  const parts = links
    .map((link) => document.querySelector<HTMLElement>(link.hash))
    .filter((part): part is HTMLElement => part !== null);
  if (!parts.length) return;
  const mark = () => {
    const line = window.innerHeight / 3;
    let current = -1;
    parts.forEach((part, index) => {
      if (part.getBoundingClientRect().top <= line) current = index;
    });
    links.forEach((link, index) => {
      if (index === current) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  };
  let queued = false;
  window.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        mark();
      });
    },
    { passive: true },
  );
  mark();
}

/**
 * Plays every `img[data-live]` while at least a third of it is in view (a
 * hidden tab's never is), and stops it when it goes. Its frames are fetched
 * the first time it is seen, and it starts once they are all ready, so no
 * frame is ever half loaded.
 */
function live() {
  if (REDUCED) return;
  const controls = new Map<Element, (showing: boolean) => void>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) controls.get(entry.target)?.(entry.isIntersecting);
    },
    { threshold: 0.35 },
  );
  for (const img of document.querySelectorAll<HTMLImageElement>("img[data-live]")) {
    const name = img.dataset.live ?? "";
    const steps = LIVE[name];
    if (!steps) continue;
    const once = img.hasAttribute("data-once");
    const restart = img.parentElement?.querySelector<HTMLButtonElement>(".restart") ?? null;
    const src = (frame: number) => `/live/${name}/${String(frame).padStart(2, "0")}.webp`;
    let ready: Promise<unknown> | null = null;
    let at = 0;
    let timer = 0;
    let showing = false;
    let done = false;
    const load = () =>
      (ready ??= Promise.all(
        [...new Set(steps.map(([frame]) => frame))].map((frame) => {
          const image = new Image();
          image.src = src(frame);
          return image.decode().catch(() => undefined);
        }),
      ));
    const show = () => {
      const [frame, ms] = steps[at];
      img.src = src(frame);
      if (at < steps.length - 1) {
        timer = window.setTimeout(() => {
          at += 1;
          show();
        }, ms);
      } else if (once) {
        timer = 0;
        done = true;
        if (restart) restart.hidden = false;
      } else {
        timer = window.setTimeout(() => {
          at = 0;
          show();
        }, ms);
      }
    };
    const play = () => {
      if (!showing || done || timer) return;
      void load().then(() => {
        if (showing && !done && !timer) show();
      });
    };
    controls.set(img, (now) => {
      showing = now;
      if (now) play();
      else {
        window.clearTimeout(timer);
        timer = 0;
      }
    });
    restart?.addEventListener("click", () => {
      window.clearTimeout(timer);
      timer = 0;
      at = 0;
      done = false;
      restart.hidden = true;
      play();
    });
    observer.observe(img);
  }
}

/** Lines marked `data-lines` come in one at a time, as if typed, the first time they are seen. */
function typedLines() {
  if (REDUCED) return;
  for (const block of document.querySelectorAll<HTMLElement>("[data-lines]")) {
    const lines = [...block.querySelectorAll<HTMLElement>(".line")];
    block.classList.add("waiting");
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        lines.forEach((line, index) => window.setTimeout(() => line.classList.add("in"), 300 + index * 450));
        window.setTimeout(() => block.classList.remove("waiting"), 300 + lines.length * 450 + 400);
      },
      { threshold: 0.6 },
    );
    observer.observe(block);
  }
}

/** The copy button beside the server's commands. */
function copyButtons() {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    const label = button.textContent ?? "";
    button.addEventListener("click", () => {
      navigator.clipboard
        .writeText(button.dataset.copy ?? "")
        .then(() => {
          button.textContent = button.dataset.copied ?? label;
          window.setTimeout(() => (button.textContent = label), 1600);
        })
        .catch(() => {
          // No clipboard (an insecure page, a refusal): the commands can still be selected.
        });
    });
  }
}

/** A language picked with the language link stays picked (the English page reads it before it shows). */
function rememberLanguage() {
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-language]")) {
    link.addEventListener("click", () => {
      try {
        localStorage.setItem("psalm150-lang", link.dataset.language ?? "");
      } catch {
        // Private browsing: the link still goes to the other page.
      }
    });
  }
}

/**
 * The film: the wall of windows, the hero's link and the footer's open it in
 * a dialog and play it with sound (the press is what lets it). Closing, by its
 * ×, Escape or outside the film, pauses it; opening again goes on where it
 * stopped, or from the start once it has ended.
 */
function film() {
  const dialog = document.getElementById("film") as HTMLDialogElement | null;
  const video = dialog?.querySelector("video");
  if (!dialog || !video) return;
  for (const opener of document.querySelectorAll<HTMLElement>("[data-film]")) {
    opener.addEventListener("click", () => {
      dialog.showModal();
      if (video.ended) video.currentTime = 0;
      video.play().catch(() => {
        // Refused or not loaded yet: its own controls still play it.
      });
    });
  }
  dialog.addEventListener("close", () => video.pause());
  // A press on the backdrop lands on the dialog itself, not on the film.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.querySelector(".film-close")?.addEventListener("click", () => dialog.close());
}

function main() {
  rememberLanguage();
  film();
  copyButtons();
  contents();
  live();
  typedLines();
  const views = document.querySelector<HTMLElement>(".tabs");
  if (views) tabs(views);
  const os = visitorOs();
  const systems = document.querySelector<HTMLElement>(".os-tabs");
  if (systems) {
    const choose = tabs(systems);
    const mine = systems.querySelector<HTMLElement>(`[data-os="${os}"]`);
    if (mine) choose(mine);
  }
  const hero = document.getElementById("hero-download");
  if (hero && os !== "other") fill(hero, { system: SYSTEM_NAMES[os] });
  fetch("https://api.github.com/repos/nitech/psalm150/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((response) => (response.ok ? (response.json() as Promise<Release>) : Promise.reject(response.status)))
    .then((release) => showRelease(release, os))
    .catch(() => {
      // The links already lead to the releases page.
    });
}

main();
