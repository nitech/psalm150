import "./site.css";

/**
 * Download links from the latest GitHub release: each button gets its file
 * and size, and the hero's button the visitor's system. Without an answer
 * from GitHub every link still leads to the releases page.
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

function visitorOs(): Os {
  const agent = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod/i.test(agent)) return "other";
  if (/Windows/i.test(agent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(agent)) return "mac";
  if (/Linux|X11/i.test(agent)) return "linux";
  return "other";
}

const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

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
  const line = document.getElementById("release-line");
  if (line) line.textContent = `Version ${version}, free for Windows, macOS and Linux. Installed copies keep themselves up to date.`;
  const windows = files.windows;
  const windowsSize = document.getElementById("windows-size");
  if (windows && windowsSize) windowsSize.textContent = megabytes(windows.size).replace(".0 MB", " MB");
  // On Windows the hero's button is the installer itself.
  const hero = document.getElementById("hero-download") as HTMLAnchorElement | null;
  if (hero && os === "windows" && windows) hero.href = windows.browser_download_url;
  const fine = document.getElementById("hero-fine");
  if (fine && os === "windows" && windows) fine.textContent = `Version ${version} · ${megabytes(windows.size)} · Free and open source`;
}

function main() {
  const os = visitorOs();
  const hero = document.getElementById("hero-download");
  if (hero && os !== "other") hero.textContent = `Download for ${SYSTEM_NAMES[os]}`;
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
