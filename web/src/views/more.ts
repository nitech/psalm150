import { pageHead, type AppContext } from "../context.ts";
import { icon } from "../icons.ts";
import { installOption, promptInstall } from "../install.ts";
import type { DeviceToken } from "../types.ts";
import { errorMessage, escapeHtml, readPreference, relativeDate, setFormBusy, showToast, writePreference } from "../ui.ts";
import { closeSheet, openSheet } from "./songs.ts";

export async function moreView(ctx: AppContext): Promise<void> {
  const theme = readPreference("theme") ?? "system";
  const devices = ctx.canEdit ? await ctx.api.listDeviceTokens() : [];
  const session = ctx.session;
  const church = session.role === "owner" ? await ctx.api.getChurch() : null;
  const install = installOption();

  ctx.main.innerHTML = `${pageHead({ title: "More", church: session.church_name })}
  <section class="card account-card">
    <span class="avatar">${escapeHtml(initials(session.display_name))}</span>
    <div><strong>${escapeHtml(session.display_name)}</strong><small>${roleName(session.role)} · ${escapeHtml(session.church_name)}</small></div>
    <button class="icon-button" id="sign-out" aria-label="Sign out" title="Sign out">${icon("logout")}</button>
  </section>

  <h2 class="list-heading">Appearance</h2>
  <div class="segmented" role="radiogroup" aria-label="Theme">
    ${["system", "light", "dark"].map((value) => `<button role="radio" aria-checked="${theme === value}" class="${theme === value ? "on" : ""}" data-theme-choice="${value}">${value === "system" ? "Automatic" : value === "light" ? "Light" : "Dark"}</button>`).join("")}
  </div>

  ${install === "none" ? "" : `<h2 class="list-heading">App</h2>
  <div class="list">
    ${install === "prompt"
      ? `<button class="list-row" id="install">${icon("install")}<span class="row-main"><strong>Install PSA150</strong><small>Opens like an app, stays signed in and keeps the current set for offline use</small></span></button>`
      : `<div class="list-row static">${icon("install")}<span class="row-main"><strong>Add to your Home Screen</strong><small>In Safari, tap Share, then Add to Home Screen. It opens like an app and keeps the current set for offline use.</small></span></div>`}
  </div>`}

  <h2 class="list-heading">Library</h2>
  <div class="list">
    ${ctx.canEdit ? `<button class="list-row" id="import">${icon("upload")}<span class="row-main"><strong>Import ChordPro files</strong><small>.pro, .cho or .chordpro; exact copies are skipped</small></span></button>` : ""}
    <button class="list-row" id="export">${icon("download")}<span class="row-main"><strong>Export the library</strong><small>A ZIP of ChordPro files you can keep anywhere</small></span></button>
  </div>
  <input id="file-import" type="file" accept=".pro,.cho,.chordpro,text/plain" multiple hidden />

  ${church ? `<h2 class="list-heading">Who can read the songs</h2>
  <div class="segmented" role="radiogroup" aria-label="Who can read the songs">
    ${[false, true].map((open) => `<button role="radio" aria-checked="${church.public_library === open}" class="${church.public_library === open ? "on" : ""}" data-public="${open}">${open ? "Everyone" : "Signed-in members"}</button>`).join("")}
  </div>
  <p class="muted">With <strong>Everyone</strong>, anyone who opens this server can search and read every song without signing in. Sets, editing and desktops still need a sign-in.</p>` : ""}

  ${ctx.canEdit ? `<h2 class="list-heading">Desktops</h2>
  <p class="muted">Projection computers connect with <strong>Sign in with browser</strong> in Psalm150's Settings, under Church server. They keep an offline copy of the songs and sets, and can save song and set changes back.</p>
  <div class="list" id="device-list">
    ${devices.map((device) => `<div class="list-row static">${icon("remote")}<span class="row-main"><strong>${escapeHtml(device.name)}</strong><small>${device.last_used_at ? `Last used ${relativeDate(device.last_used_at).toLowerCase()}` : "Not used yet"}</small></span>
      <button class="button secondary small revoke" data-device="${device.id}" data-name="${escapeHtml(device.name)}">Revoke</button></div>`).join("") || `<p class="muted pad">No desktops connected.</p>`}
    <button class="list-row" id="new-token">${icon("link")}<span class="row-main"><strong>Create a token by hand</strong><small>For desktops that cannot open a browser</small></span></button>
  </div>` : ""}
  <p class="fine-print">PSA150 Song Server · ${ctx.isPublic ? "songs open to everyone, sets private to your church" : "private to your church"}</p>`;

  ctx.main.querySelectorAll<HTMLButtonElement>("[data-public]").forEach((button) => {
    button.addEventListener("click", () => {
      const open = button.dataset.public === "true";
      if (open === church?.public_library) return;
      if (open && !confirm("Let anyone read every song in this library without signing in?")) return;
      void ctx.run(async () => {
        const updated = await ctx.api.updateChurch({ public_library: open });
        ctx.setPublic(updated.public_library);
        showToast(updated.public_library ? "The songs are open to everyone." : "The songs are private again.");
        ctx.navigate("#/more", true);
      });
    });
  });

  ctx.main.querySelector("#sign-out")?.addEventListener("click", () => ctx.signOut());
  ctx.main.querySelector("#install")?.addEventListener("click", () => void ctx.run(async () => {
    if (await promptInstall()) showToast("PSA150 is installed.");
    ctx.navigate("#/more", true);
  }));
  ctx.main.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.themeChoice!;
      writePreference("theme", value === "system" ? null : value);
      ctx.applyTheme();
      ctx.main.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((other) => {
        const on = other === button;
        other.classList.toggle("on", on);
        other.setAttribute("aria-checked", String(on));
      });
    });
  });

  const fileInput = ctx.main.querySelector<HTMLInputElement>("#file-import")!;
  ctx.main.querySelector("#import")?.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files ?? []);
    if (!files.length) return;
    void ctx.run(async () => {
      const payload = await Promise.all(files.map(async (file) => ({ filename: file.name, chordpro: await file.text() })));
      const result = await ctx.api.importSongs(payload);
      const skipped = result.skipped_existing
        ? ` ${result.skipped_existing} already ${result.skipped_existing === 1 ? "exists" : "exist"}.`
        : "";
      showToast(`Imported ${result.songs.length} ${result.songs.length === 1 ? "song" : "songs"}.${skipped}`);
      fileInput.value = "";
    });
  });

  ctx.main.querySelector("#export")?.addEventListener("click", () => void ctx.run(async () => {
    const blob = await ctx.api.exportSongs();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "psa150-library.zip";
    anchor.click();
    // Some browsers start the download after click() returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    showToast("Library export prepared.");
  }));

  ctx.main.querySelectorAll<HTMLButtonElement>(".revoke").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm(`Revoke access for ${button.dataset.name}? It will stop synchronizing.`)) return;
      void ctx.run(async () => {
        await ctx.api.revokeDeviceToken(String(button.dataset.device));
        button.closest(".list-row")?.remove();
        showToast("Desktop access revoked.");
      });
    });
  });

  ctx.main.querySelector("#new-token")?.addEventListener("click", () => openTokenSheet(ctx));
}

function openTokenSheet(ctx: AppContext): void {
  const sheet = openSheet(`<h2>Create a desktop token</h2>
    <p class="muted">Name the projection computer. The token is shown once. Paste it under <strong>Use a desktop token instead</strong> in Psalm150's Settings.</p>
    <form id="token-form" class="stack">
      <label>Computer name<input name="name" placeholder="Sanctuary PC" required maxlength="120" /></label>
      <p class="form-message" role="status"></p>
      <button class="button primary wide" type="submit">Create token</button>
    </form>`);
  const form = sheet.querySelector<HTMLFormElement>("#token-form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormBusy(form, true);
    try {
      const token = await ctx.api.createDeviceToken(String(new FormData(form).get("name")));
      showToken(sheet, token);
    } catch (error) {
      setFormBusy(form, false);
      form.querySelector<HTMLElement>(".form-message")!.textContent = errorMessage(error);
    }
  });
  sheet.addEventListener("close", () => void ctx.navigate("#/more", true));
}

function showToken(sheet: HTMLDialogElement, device: DeviceToken): void {
  const body = sheet.querySelector<HTMLElement>(".sheet-body")!;
  body.innerHTML = `<h2>Token for ${escapeHtml(device.name)}</h2>
    <p class="muted">Copy it now. The server will not show it again.</p>
    <code class="token">${escapeHtml(device.token)}</code>
    <button class="button primary wide" id="copy-token">Copy token</button>
    <button class="button secondary wide" id="token-done">Done</button>`;
  body.querySelector("#copy-token")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(device.token);
    showToast("Token copied.");
  });
  body.querySelector("#token-done")?.addEventListener("click", () => closeSheet(sheet));
}

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
}

function roleName(role: string): string {
  return role === "owner" ? "Owner" : role === "leader" ? "Leader" : "Viewer";
}
