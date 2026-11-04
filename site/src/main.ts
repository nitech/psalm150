import "./site.css";

/**
 * Download links from the latest GitHub release: each button gets its file
 * and size, and the hero's button the visitor's system. Without an answer
 * from GitHub every link still leads to the releases page.
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
  const version = release.tag_name.replace(/^v/, "");
  fill(document.getElementById("release-line"), { version });
  const windows = files.windows;
  const windowsSize = document.getElementById("windows-size");
  if (windows && windowsSize) windowsSize.textContent = megabytes(windows.size, true);
  // On Windows the hero's button is the installer itself.
  const hero = document.getElementById("hero-download") as HTMLAnchorElement | null;
  if (hero && os === "windows" && windows) hero.href = windows.browser_download_url;
  if (os === "windows" && windows) fill(document.getElementById("hero-fine"), { version, size: megabytes(windows.size) });
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
 * The film: pressing the splash opens it in a dialog and plays it with sound
 * (the press is what lets it). Closing, by its ×, Escape or outside the film,
 * pauses it; opening again goes on where it stopped, or from the start once
 * it has ended.
 */
function film() {
  const play = document.getElementById("play-film");
  const dialog = document.getElementById("film") as HTMLDialogElement | null;
  const video = dialog?.querySelector("video");
  if (!play || !dialog || !video) return;
  play.addEventListener("click", () => {
    dialog.showModal();
    if (video.ended) video.currentTime = 0;
    video.play().catch(() => {
      // Refused or not loaded yet: its own controls still play it.
    });
  });
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
  const os = visitorOs();
  const hero = document.getElementById("hero-download");
  if (hero && os !== "other") fill(hero, { system: SYSTEM_NAMES[os] });
  document.querySelector(`.platform[data-os="${os}"]`)?.classList.add("visitor");
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
