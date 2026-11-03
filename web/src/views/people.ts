import { setTitle } from "../../../shared/songs/a11y.ts";
import { emptyState, pageHead, type AppContext } from "../context.ts";
import { icon } from "../icons.ts";
import type { AccountLink, AccountLinkResponse, Member, Role } from "../types.ts";
import { errorMessage, escapeHtml, initials, roleName, setFormBusy, showToast } from "../ui.ts";
import { closeSheet, openSheet } from "../../../shared/songs/sheet.ts";
import { locale, t } from "../../../shared/songs/i18n.ts";

/** Most access first. */
const ROLES: Role[] = ["owner", "leader", "viewer"];

/**
 * `#/people`: owners add people (or invite them with a link, so they choose
 * their own password), change their role, name or username, set a new
 * password or send a link to choose one, disable sign-in and remove people
 * (`/members`).
 */
export async function peopleView(ctx: AppContext): Promise<void> {
  const head = pageHead({ title: t("People"), church: ctx.session.church_name, compact: true, menu: true });
  setTitle(t("People"), t("Settings"));
  if (ctx.session.role !== "owner") {
    ctx.main.innerHTML = `${head}${emptyState(t("Only owners manage people"), t("Ask an owner of your church to add people or change what they can do."))}`;
    return;
  }
  const [members, links] = await Promise.all([ctx.api.listMembers(), ctx.api.listAccountLinks()]);

  ctx.main.innerHTML = `${head}
  <ul class="list" aria-label="${t("People")}">
    ${members.map((member) => `<li><button class="list-row" data-member="${member.user_id}">
      <span class="avatar" aria-hidden="true">${escapeHtml(initials(member.display_name))}</span>
      <span class="row-main"><strong>${escapeHtml(member.display_name)}${member.user_id === ctx.session.user_id ? ` ${t("(you)")}` : ""}</strong><small>${escapeHtml(member.username)} · ${roleName(member.role)}${member.disabled ? ` · ${t("cannot sign in")}` : ""}</small></span>
      ${icon("next")}
    </button></li>`).join("")}
    <li><button class="list-row" id="invite-member">${icon("share")}<span class="row-main"><strong>${t("Invite with a link")}</strong><small>${t("They choose their own username and password")}</small></span></button></li>
    <li><button class="list-row" id="add-member">${icon("plus")}<span class="row-main"><strong>${t("Add a person")}</strong><small>${t("With a username and a first password")}</small></span></button></li>
  </ul>
  ${links.length ? `<h2 class="list-heading">${t("Links not used yet")}</h2>
  <ul class="list" aria-label="${t("Links not used yet")}">
    ${links.map((link) => `<li><div class="list-row">
      <span class="row-main"><strong>${escapeHtml(linkTitle(link))}</strong><small>${escapeHtml(linkSummary(link))}</small></span>
      <button class="button secondary" data-revoke="${link.id}" aria-label="${t("Withdraw: {link}", { link: escapeHtml(linkTitle(link)) })}">${t("Withdraw")}</button>
    </div></li>`).join("")}
  </ul>` : ""}
  <p class="muted">${t("Owners run the church: its people, its settings and everyone's API tokens. Leaders add and edit songs and sets, and connect and steer desktops. Viewers read songs and sets.")}</p>`;

  ctx.main.querySelectorAll<HTMLButtonElement>("[data-member]").forEach((button) => {
    const member = members.find((candidate) => candidate.user_id === button.dataset.member);
    if (member) button.addEventListener("click", () => openMemberSheet(ctx, member));
  });
  ctx.main.querySelector("#add-member")?.addEventListener("click", () => openAddSheet(ctx));
  ctx.main.querySelector("#invite-member")?.addEventListener("click", () => openInviteSheet(ctx));
  ctx.main.querySelectorAll<HTMLButtonElement>("[data-revoke]").forEach((button) => {
    button.addEventListener("click", () => void ctx.run(async () => {
      await ctx.api.revokeAccountLink(String(button.dataset.revoke));
      showToast(t("The link no longer works."));
      ctx.navigate("#/people", true);
    }));
  });
}

function linkTitle(link: AccountLink): string {
  return link.kind === "invite"
    ? link.display_name ? t("Invite for {name}", { name: link.display_name }) : t("Invite")
    : link.display_name ? t("New password for {name}", { name: link.display_name }) : t("New password for someone");
}

function linkSummary(link: AccountLink): string {
  const until = new Date(link.expires_at).toLocaleDateString(locale(), { day: "numeric", month: "short" });
  return link.kind === "invite" ? `${roleName(link.role ?? "viewer")} · ${t("works until {date}", { date: until })}` : t("Works until {date}", { date: until });
}

function openInviteSheet(ctx: AppContext): void {
  const sheet = openSheet(`<h2>${t("Invite with a link")}</h2>
    <p class="muted">${t("Send the link to the person. They choose their own username and password, and are signed in. It works once, for 7 days.")}</p>
    <form id="invite-form" class="stack">
      <label>${t("Name (optional)")}<input name="display_name" maxlength="120" autocomplete="off" /></label>
      <label>${t("Role")}<select name="role">${roleOptions("viewer")}</select></label>
      <p class="form-message" role="status"></p>
      <button class="button primary wide" type="submit">${t("Make the link")}</button>
    </form>`);
  const form = sheet.querySelector<HTMLFormElement>("#invite-form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    setFormBusy(form, true);
    try {
      const link = await ctx.api.createInvite(String(data.get("role")) as Role, String(data.get("display_name")).trim());
      closeSheet(sheet);
      showLinkSheet(ctx, link, t("Join {church} on Psalm150", { church: ctx.session.church_name }));
    } catch (error) {
      setFormBusy(form, false);
      form.querySelector<HTMLElement>(".form-message")!.textContent = errorMessage(error);
    }
  });
}

/** A link just made, shown this once with Copy and Share. Closing it shows the list with it. */
function showLinkSheet(ctx: AppContext, link: AccountLinkResponse, shareTitle: string): void {
  const url = `${location.origin}${link.path}`;
  const invite = link.kind === "invite";
  const sheet = openSheet(`<h2>${invite ? t("Invite link") : t("New password link")}</h2>
    <p class="muted">${invite
      ? t("Send it to the person, by message or email. Anyone with the link can join, so send it only to them.")
      : link.display_name
        ? t("Send it to {name}. With it they choose a new password, and the old one stops working.", { name: escapeHtml(link.display_name) })
        : t("Send it to them. With it they choose a new password, and the old one stops working.")}
      ${t("The link is shown only now.")}</p>
    <label>${t("Link")}<input id="link-url" value="${escapeHtml(url)}" readonly /></label>
    <div class="inline-actions wrap">
      <button class="button primary" id="copy-link">${icon("copy")}${t("Copy the link")}</button>
      ${"share" in navigator ? `<button class="button secondary" id="share-link">${icon("share")}${t("Share")}</button>` : ""}
    </div>`);
  sheet.addEventListener("close", () => ctx.navigate("#/people", true), { once: true });
  const field = sheet.querySelector<HTMLInputElement>("#link-url")!;
  field.addEventListener("focus", () => field.select());
  sheet.querySelector("#copy-link")?.addEventListener("click", () => void ctx.run(async () => {
    await navigator.clipboard.writeText(url);
    showToast(t("Link copied."));
  }));
  sheet.querySelector("#share-link")?.addEventListener("click", () => {
    void navigator.share({ title: shareTitle, url }).catch(() => undefined);
  });
}

function openAddSheet(ctx: AppContext): void {
  const sheet = openSheet(`<h2>${t("Add a person")}</h2>
    <p class="muted">${t("They sign in with this username and password. Give them the password in person; they can change it under Settings, Account.")}</p>
    <form id="member-form" class="stack">
      <label>${t("Name")}<input name="display_name" required maxlength="120" autocomplete="off" /></label>
      <label>${t("Username")}<input name="username" required maxlength="100" autocapitalize="none" autocomplete="off" spellcheck="false" /></label>
      <label>${t("First password")}<input name="password" type="password" required minlength="10" autocomplete="new-password" aria-describedby="first-password-hint" /></label>
      <p class="hint field-hint" id="first-password-hint">${t("At least 10 characters.")}</p>
      <label>${t("Role")}<select name="role">${roleOptions("viewer")}</select></label>
      <p class="form-message" role="status"></p>
      <button class="button primary wide" type="submit">${t("Add")}</button>
    </form>`);
  const form = sheet.querySelector<HTMLFormElement>("#member-form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // Read the form first: disabled fields are left out of FormData.
    const data = new FormData(form);
    setFormBusy(form, true);
    try {
      const member = await ctx.api.createMember({
        display_name: String(data.get("display_name")),
        username: String(data.get("username")),
        password: String(data.get("password")),
        role: String(data.get("role")) as Role,
      });
      closeSheet(sheet);
      showToast(t("{name} can now sign in.", { name: member.display_name }));
      ctx.navigate("#/people", true);
    } catch (error) {
      setFormBusy(form, false);
      form.querySelector<HTMLElement>(".form-message")!.textContent = errorMessage(error);
    }
  });
}

function openMemberSheet(ctx: AppContext, member: Member): void {
  const you = member.user_id === ctx.session.user_id;
  const church = escapeHtml(ctx.session.church_name);
  const sheet = openSheet(`<h2>${escapeHtml(member.display_name)}${you ? ` ${t("(you)")}` : ""}</h2>
    <form id="details-form" class="stack">
      <label>${t("Name")}<input name="display_name" value="${escapeHtml(member.display_name)}" required maxlength="120" autocomplete="off" /></label>
      <label>${t("Username")}<input name="username" value="${escapeHtml(member.username)}" required maxlength="100" autocapitalize="none" autocomplete="off" spellcheck="false" /></label>
      <label>${t("Role")}<select name="role">${roleOptions(member.role)}</select></label>
      <p class="form-message" role="status"></p>
      <button class="button primary wide" type="submit">${t("Save")}</button>
    </form>
    ${you ? `<p class="muted">${t("Change your own password with <strong>Change your password</strong> under Settings, Account.")}</p>` : `<h3 class="list-heading">${t("New password")}</h3>
    <div class="stack">
      <p class="muted">${t("Send them a link to choose a new password themselves. It works once, for 3 days.")}</p>
      <button class="button secondary wide" id="reset-link">${icon("share")}${t("Make a new password link")}</button>
      <p class="form-message" id="reset-message" role="status"></p>
    </div>
    <form id="password-form" class="stack">
      <p class="muted">${t("Or choose one and give it to them. Setting one signs them out everywhere. Their API tokens keep working.")}</p>
      <label>${t("Password")}<input name="password" type="password" required minlength="10" autocomplete="new-password" aria-describedby="member-password-hint" /></label>
      <p class="hint field-hint" id="member-password-hint">${t("At least 10 characters.")}</p>
      <p class="form-message" role="status"></p>
      <button class="button secondary wide" type="submit">${t("Set the password")}</button>
    </form>`}
    <h3 class="list-heading">${t("Access")}</h3>
    <div class="stack">
      ${you ? "" : `<p class="muted">${member.disabled
        ? t("They cannot sign in, and API tokens they had stay revoked.")
        : t("Disabling signs them out and revokes their API tokens.")}</p>
      <button class="button secondary wide" id="toggle-disabled">${member.disabled ? t("Let them sign in again") : t("Disable sign-in")}</button>`}
      <button class="button secondary wide danger" id="remove-member">${you ? t("Leave {church}", { church }) : t("Remove from {church}", { church })}</button>
      <p class="form-message" id="access-message" role="status"></p>
    </div>`);

  const done = (message: string) => {
    closeSheet(sheet);
    showToast(message);
    ctx.navigate("#/people", true);
  };
  const accessMessage = sheet.querySelector<HTMLElement>("#access-message")!;

  const details = sheet.querySelector<HTMLFormElement>("#details-form")!;
  details.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(details);
    const changes: { display_name?: string; username?: string; role?: Role } = {};
    const name = String(data.get("display_name")).trim();
    const username = String(data.get("username")).trim();
    const role = String(data.get("role")) as Role;
    if (name !== member.display_name) changes.display_name = name;
    if (username !== member.username) changes.username = username;
    if (role !== member.role) changes.role = role;
    if (!Object.keys(changes).length) return closeSheet(sheet);
    setFormBusy(details, true);
    try {
      await ctx.api.updateMember(member.user_id, changes);
      if (you && changes.role) {
        // Your own role changed: leave the owners' screen and pick it up.
        closeSheet(sheet);
        showToast(t("Saved."));
        ctx.navigate("#/settings", true);
        await ctx.refreshSession(true);
        return;
      }
      done(t("Saved."));
    } catch (error) {
      setFormBusy(details, false);
      details.querySelector<HTMLElement>(".form-message")!.textContent = errorMessage(error);
    }
  });

  sheet.querySelector("#reset-link")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      const link = await ctx.api.createResetLink(member.user_id);
      closeSheet(sheet);
      showLinkSheet(ctx, link, t("New password for Psalm150"));
    } catch (error) {
      button.disabled = false;
      sheet.querySelector<HTMLElement>("#reset-message")!.textContent = errorMessage(error);
    }
  });

  const password = sheet.querySelector<HTMLFormElement>("#password-form");
  password?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = String(new FormData(password).get("password"));
    setFormBusy(password, true);
    try {
      await ctx.api.updateMember(member.user_id, { password: value });
      done(t("New password set for {name}.", { name: member.display_name }));
    } catch (error) {
      setFormBusy(password, false);
      password.querySelector<HTMLElement>(".form-message")!.textContent = errorMessage(error);
    }
  });

  sheet.querySelector("#toggle-disabled")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const disable = !member.disabled;
    if (disable && !confirm(t("Disable {name}? They are signed out, and their API tokens stop working.", { name: member.display_name }))) return;
    button.disabled = true;
    try {
      await ctx.api.updateMember(member.user_id, { disabled: disable });
      done(disable ? t("{name} can no longer sign in.", { name: member.display_name }) : t("{name} can sign in again.", { name: member.display_name }));
    } catch (error) {
      button.disabled = false;
      accessMessage.textContent = errorMessage(error);
    }
  });

  sheet.querySelector("#remove-member")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const question = you
      ? t("Leave {church}? You will be signed out.", { church: ctx.session.church_name })
      : t("Remove {name} from {church}? They are signed out; the songs and sets they saved stay.", { name: member.display_name, church: ctx.session.church_name });
    if (!confirm(question)) return;
    button.disabled = true;
    try {
      await ctx.api.removeMember(member.user_id);
      if (you) {
        closeSheet(sheet);
        ctx.signOut();
        return;
      }
      done(t("{name} was removed.", { name: member.display_name }));
    } catch (error) {
      button.disabled = false;
      accessMessage.textContent = errorMessage(error);
    }
  });
}

function roleOptions(selected: Role): string {
  return ROLES.map((role) => `<option value="${role}"${role === selected ? " selected" : ""}>${roleChoice(role)}</option>`).join("");
}

function roleChoice(role: Role): string {
  return role === "owner"
    ? t("Owner: people, settings and everything else")
    : role === "leader"
      ? t("Leader: songs, sets and desktops")
      : t("Viewer: reads songs and sets");
}
