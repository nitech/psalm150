import { bindRadioGroup } from "../a11y.ts";
import { ApiError } from "../api.ts";
import { pageHead, type AppContext } from "../context.ts";
import { icon } from "../icons.ts";
import { installOption, promptInstall } from "../install.ts";
import type { Role } from "../types.ts";
import { errorMessage, escapeHtml, initials, readPreference, relativeDate, roleName, setFormBusy, showToast, writePreference } from "../ui.ts";
import { closeSheet, openSheet } from "./songs.ts";

export async function moreView(ctx: AppContext): Promise<void> {
  const theme = readPreference("theme") ?? "system";
  const devices = ctx.canEdit ? await ctx.api.listDeviceTokens() : [];
  const session = ctx.session;
  const church = session.role === "owner" ? await ctx.api.getChurch() : null;
  // Offline, the rest of this screen still works.
  const apiTokens = await ctx.api.listApiTokens().catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) throw error;
    return null;
  });
  const install = installOption();
  // Offline, About still shows; the version is left out.
  const info = await ctx.api.info().catch(() => null);

  ctx.main.innerHTML = `${pageHead({ title: "More", church: session.church_name, compact: true, menu: true })}
  <section class="card account-card">
    <span class="avatar" aria-hidden="true">${escapeHtml(initials(session.display_name))}</span>
    <div><strong>${escapeHtml(session.display_name)}</strong><small>${roleName(session.role)} · ${escapeHtml(session.church_name)}</small></div>
    <button class="icon-button" id="change-password" aria-label="Change your password" title="Change your password">${icon("lock")}</button>
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

  ${church ? `<h2 class="list-heading">Church</h2>
  <div class="list">
    <a class="list-row" href="#/people">${icon("people")}<span class="row-main"><strong>People</strong><small>Add people and choose what they can do</small></span>${icon("next")}</a>
  </div>

  <h2 class="list-heading">Who can read the songs</h2>
  <div class="segmented" role="radiogroup" aria-label="Who can read the songs">
    ${[false, true].map((open) => `<button role="radio" aria-checked="${church.public_library === open}" class="${church.public_library === open ? "on" : ""}" data-public="${open}">${open ? "Everyone" : "Signed-in members"}</button>`).join("")}
  </div>
  <p class="muted">With <strong>Everyone</strong>, anyone who opens this server can search and read every song without signing in. Sets, editing and desktops still need a sign-in.</p>

  <h2 class="list-heading">Rooms</h2>
  <div class="segmented" role="radiogroup" aria-label="Rooms">
    ${[true, false].map((open) => `<button role="radio" aria-checked="${church.public_rooms === open}" class="${church.public_rooms === open ? "on" : ""}" data-rooms="${open}">${open ? "Shared" : "Off"}</button>`).join("")}
  </div>
  <p class="muted">Each desktop has a room, named after a flower unless you rename it. While it projects, anyone who types the room name at <strong>${escapeHtml(location.host)}/join</strong> can read the words on their own phone, as large as they need. A desktop's operator can also stop sharing it.</p>` : ""}

  ${ctx.canEdit ? `<h2 class="list-heading">Desktops</h2>
  <p class="muted">Projection computers connect with <strong>Sign in with browser</strong> in Psalm150's Settings, under Church server. They keep an offline copy of the songs and sets, and can save song and set changes back.</p>
  <div class="list" id="device-list">
    ${devices.map((device) => `<div class="list-row static">${icon("remote")}<span class="row-main"><strong>${escapeHtml(device.room_name ?? device.name)}</strong><small>${device.room_name ? `${escapeHtml(device.name)} · ` : ""}${device.last_used_at ? `last used ${relativeDate(device.last_used_at).toLowerCase()}` : "not used yet"}</small></span>
      <button class="button secondary small revoke" data-device="${device.id}" data-name="${escapeHtml(device.name)}" aria-label="Revoke ${escapeHtml(device.room_name ?? device.name)}">Revoke</button></div>`).join("") || `<p class="muted pad">No desktops connected.</p>`}
    <button class="list-row" id="new-token">${icon("link")}<span class="row-main"><strong>Create a token by hand</strong><small>For desktops that cannot open a browser</small></span></button>
  </div>` : ""}

  <h2 class="list-heading">API tokens</h2>
  <p class="muted">For scripts and other programs that use this server's API. A token can do what you can, or less if you choose, until it is revoked. The <a href="#/api">API reference</a> shows what they can call.</p>
  <div class="list" id="api-token-list">
    ${apiTokens === null
      ? `<p class="muted pad">Your API tokens show when you are online.</p>`
      : `${apiTokens.map((token) => `<div class="list-row static">${icon("link")}<span class="row-main"><strong>${escapeHtml(token.name)}</strong><small>${token.user_id === session.user_id ? "" : `${escapeHtml(token.user_display_name)} · `}${accessName(token.role)} · ${token.last_used_at ? `last used ${relativeDate(token.last_used_at).toLowerCase()}` : "not used yet"}</small></span>
      <button class="button secondary small revoke-api-token" data-token="${token.id}" data-name="${escapeHtml(token.name)}" aria-label="Revoke ${escapeHtml(token.name)}">Revoke</button></div>`).join("") || `<p class="muted pad">No API tokens.</p>`}
    <button class="list-row" id="new-api-token">${icon("plus")}<span class="row-main"><strong>Create an API token</strong><small>For a script or another program</small></span></button>`}
  </div>
  <h2 class="list-heading">About</h2>
  <ul class="list" aria-label="About">
    <li><a class="list-row" href="#/api">${icon("text")}<span class="row-main"><strong>API reference</strong><small>Everything this server does, for scripts and other programs</small></span>${icon("next")}</a></li>
    <li><a class="list-row" href="/api/openapi.json" download="psa150-openapi.json">${icon("download")}<span class="row-main"><strong>OpenAPI document</strong><small>The API as JSON, for tools such as Postman or Swagger</small></span></a></li>
  </ul>
  <p class="fine-print">PSA150 Song Server${info ? ` ${escapeHtml(info.version)}` : ""} · ${ctx.isPublic ? "songs open to everyone, sets private to your church" : "private to your church"}</p>`;

  // Arrow keys move between the options of each choice (ARIA radio group).
  ctx.main.querySelectorAll<HTMLElement>('[role="radiogroup"]').forEach(bindRadioGroup);

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

  ctx.main.querySelectorAll<HTMLButtonElement>("[data-rooms]").forEach((button) => {
    button.addEventListener("click", () => {
      const open = button.dataset.rooms === "true";
      if (open === church?.public_rooms) return;
      void ctx.run(async () => {
        const updated = await ctx.api.updateChurch({ public_rooms: open });
        showToast(updated.public_rooms ? "Desktops share their words in their rooms." : "Rooms are off.");
        ctx.navigate("#/more", true);
      });
    });
  });

  ctx.main.querySelector("#sign-out")?.addEventListener("click", () => ctx.signOut());
  ctx.main.querySelector("#change-password")?.addEventListener("click", () => openPasswordSheet(ctx));
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
        removeRow(button);
        showToast("Desktop access revoked.");
      });
    });
  });

  ctx.main.querySelector("#new-token")?.addEventListener("click", () => openTokenSheet(ctx));

  ctx.main.querySelectorAll<HTMLButtonElement>(".revoke-api-token").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm(`Revoke the API token “${button.dataset.name}”? Programs using it stop working.`)) return;
      void ctx.run(async () => {
        await ctx.api.revokeApiToken(String(button.dataset.token));
        removeRow(button);
        showToast("API token revoked.");
      });
    });
  });
  ctx.main.querySelector("#new-api-token")?.addEventListener("click", () => openApiTokenSheet(ctx));
}

/** Removes a revoked row; focus moves on to the next row's button. */
function removeRow(button: HTMLElement): void {
  const row = button.closest(".list-row");
  const next = row?.nextElementSibling;
  const target = next instanceof HTMLButtonElement ? next : next?.querySelector<HTMLElement>("button");
  row?.remove();
  target?.focus();
}

function openPasswordSheet(ctx: AppContext): void {
  const sheet = openSheet(`<h2>Change your password</h2>
    <p class="muted">You stay signed in here; your other sessions end. Your API tokens keep working.</p>
    <form id="password-form" class="stack">
      <label>Current password<input name="current" type="password" required autocomplete="current-password" /></label>
      <label>New password<input name="new" type="password" required minlength="10" autocomplete="new-password" aria-describedby="new-password-hint" /></label>
      <p class="hint field-hint" id="new-password-hint">At least 10 characters.</p>
      <p class="form-message" role="status"></p>
      <button class="button primary wide" type="submit">Change password</button>
    </form>`);
  const form = sheet.querySelector<HTMLFormElement>("#password-form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    setFormBusy(form, true);
    try {
      await ctx.api.changePassword(String(data.get("current")), String(data.get("new")));
      closeSheet(sheet);
      showToast("Your password is changed.");
    } catch (error) {
      setFormBusy(form, false);
      form.querySelector<HTMLElement>(".form-message")!.textContent = errorMessage(error);
    }
  });
}

/** Most access first; a person may give a token their own role or less. */
const ROLES: Role[] = ["owner", "leader", "viewer"];

function openApiTokenSheet(ctx: AppContext): void {
  const roles = ROLES.slice(ROLES.indexOf(ctx.session.role));
  const sheet = openSheet(`<h2>Create an API token</h2>
    <p class="muted">Anyone who has the token can use this server as you, with the access you choose. It is shown once.</p>
    <form id="api-token-form" class="stack">
      <label>Name<input name="name" placeholder="Church website" required maxlength="120" /></label>
      <label>Access<select name="role">${roles.map((role) => `<option value="${role}">${accessChoice(role)}</option>`).join("")}</select></label>
      <p class="form-message" role="status"></p>
      <button class="button primary wide" type="submit">Create token</button>
    </form>`);
  const form = sheet.querySelector<HTMLFormElement>("#api-token-form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // Read the form first: disabled fields are left out of FormData.
    const data = new FormData(form);
    setFormBusy(form, true);
    try {
      const token = await ctx.api.createApiToken({ name: String(data.get("name")), role: String(data.get("role")) as Role });
      showToken(sheet, token);
    } catch (error) {
      setFormBusy(form, false);
      form.querySelector<HTMLElement>(".form-message")!.textContent = errorMessage(error);
    }
  });
  sheet.addEventListener("close", () => void ctx.navigate("#/more", true));
}

function accessName(role: Role): string {
  return role === "owner" ? "Owner access" : role === "leader" ? "Leader access" : "Read only";
}

function accessChoice(role: Role): string {
  return role === "owner"
    ? "Everything, like an owner"
    : role === "leader"
      ? "Songs, sets and desktops, like a leader"
      : "Read only";
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
    const name = String(new FormData(form).get("name"));
    setFormBusy(form, true);
    try {
      const token = await ctx.api.createDeviceToken(name);
      showToken(sheet, token);
    } catch (error) {
      setFormBusy(form, false);
      form.querySelector<HTMLElement>(".form-message")!.textContent = errorMessage(error);
    }
  });
  sheet.addEventListener("close", () => void ctx.navigate("#/more", true));
}

function showToken(sheet: HTMLDialogElement, device: { name: string; token: string }): void {
  const body = sheet.querySelector<HTMLElement>(".sheet-body")!;
  // The new heading still names the sheet, and focus goes to Copy.
  body.innerHTML = `<h2 id="${sheet.getAttribute("aria-labelledby") ?? ""}">Token for ${escapeHtml(device.name)}</h2>
    <p class="muted">Copy it now. The server will not show it again.</p>
    <code class="token">${escapeHtml(device.token)}</code>
    <button class="button primary wide" id="copy-token">Copy token</button>
    <button class="button secondary wide" id="token-done">Done</button>`;
  body.querySelector("#copy-token")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(device.token);
    showToast("Token copied.");
  });
  body.querySelector("#token-done")?.addEventListener("click", () => closeSheet(sheet));
  body.querySelector<HTMLElement>("#copy-token")?.focus();
}
