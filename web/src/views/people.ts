import { setTitle } from "../a11y.ts";
import { emptyState, pageHead, type AppContext } from "../context.ts";
import { icon } from "../icons.ts";
import type { AccountLink, AccountLinkResponse, Member, Role } from "../types.ts";
import { errorMessage, escapeHtml, initials, roleName, setFormBusy, showToast } from "../ui.ts";
import { closeSheet, openSheet } from "./songs.ts";

/** Most access first. */
const ROLES: Role[] = ["owner", "leader", "viewer"];

/**
 * `#/people`: owners add people (or invite them with a link, so they choose
 * their own password), change their role, name or username, set a new
 * password or send a link to choose one, disable sign-in and remove people
 * (`/members`).
 */
export async function peopleView(ctx: AppContext): Promise<void> {
  const head = pageHead({ title: "People", back: "#/more", church: ctx.session.church_name });
  setTitle("People", "More");
  if (ctx.session.role !== "owner") {
    ctx.main.innerHTML = `${head}${emptyState("Only owners manage people", "Ask an owner of your church to add people or change what they can do.")}`;
    return;
  }
  const [members, links] = await Promise.all([ctx.api.listMembers(), ctx.api.listAccountLinks()]);

  ctx.main.innerHTML = `${head}
  <ul class="list" aria-label="People">
    ${members.map((member) => `<li><button class="list-row" data-member="${member.user_id}">
      <span class="avatar" aria-hidden="true">${escapeHtml(initials(member.display_name))}</span>
      <span class="row-main"><strong>${escapeHtml(member.display_name)}${member.user_id === ctx.session.user_id ? " (you)" : ""}</strong><small>${escapeHtml(member.username)} · ${roleName(member.role)}${member.disabled ? " · cannot sign in" : ""}</small></span>
      ${icon("next")}
    </button></li>`).join("")}
    <li><button class="list-row" id="invite-member">${icon("share")}<span class="row-main"><strong>Invite with a link</strong><small>They choose their own username and password</small></span></button></li>
    <li><button class="list-row" id="add-member">${icon("plus")}<span class="row-main"><strong>Add a person</strong><small>With a username and a first password</small></span></button></li>
  </ul>
  ${links.length ? `<h2 class="list-heading">Links not used yet</h2>
  <ul class="list" aria-label="Links not used yet">
    ${links.map((link) => `<li><div class="list-row">
      <span class="row-main"><strong>${escapeHtml(linkTitle(link))}</strong><small>${escapeHtml(linkSummary(link))}</small></span>
      <button class="button secondary" data-revoke="${link.id}" aria-label="Withdraw: ${escapeHtml(linkTitle(link))}">Withdraw</button>
    </div></li>`).join("")}
  </ul>` : ""}
  <p class="muted">Owners run the church: its people, its settings and everyone's API tokens. Leaders add and edit songs and sets, and connect and steer desktops. Viewers read songs and sets.</p>`;

  ctx.main.querySelectorAll<HTMLButtonElement>("[data-member]").forEach((button) => {
    const member = members.find((candidate) => candidate.user_id === button.dataset.member);
    if (member) button.addEventListener("click", () => openMemberSheet(ctx, member));
  });
  ctx.main.querySelector("#add-member")?.addEventListener("click", () => openAddSheet(ctx));
  ctx.main.querySelector("#invite-member")?.addEventListener("click", () => openInviteSheet(ctx));
  ctx.main.querySelectorAll<HTMLButtonElement>("[data-revoke]").forEach((button) => {
    button.addEventListener("click", () => void ctx.run(async () => {
      await ctx.api.revokeAccountLink(String(button.dataset.revoke));
      showToast("The link no longer works.");
      ctx.navigate("#/people", true);
    }));
  });
}

function linkTitle(link: AccountLink): string {
  return link.kind === "invite"
    ? `Invite${link.display_name ? ` for ${link.display_name}` : ""}`
    : `New password for ${link.display_name ?? "someone"}`;
}

function linkSummary(link: AccountLink): string {
  const until = new Date(link.expires_at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return link.kind === "invite" ? `${roleName(link.role ?? "viewer")} · works until ${until}` : `Works until ${until}`;
}

function openInviteSheet(ctx: AppContext): void {
  const sheet = openSheet(`<h2>Invite with a link</h2>
    <p class="muted">Send the link to the person. They choose their own username and password, and are signed in. It works once, for 7 days.</p>
    <form id="invite-form" class="stack">
      <label>Name (optional)<input name="display_name" maxlength="120" autocomplete="off" /></label>
      <label>Role<select name="role">${roleOptions("viewer")}</select></label>
      <p class="form-message" role="status"></p>
      <button class="button primary wide" type="submit">Make the link</button>
    </form>`);
  const form = sheet.querySelector<HTMLFormElement>("#invite-form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    setFormBusy(form, true);
    try {
      const link = await ctx.api.createInvite(String(data.get("role")) as Role, String(data.get("display_name")).trim());
      closeSheet(sheet);
      showLinkSheet(ctx, link, `Join ${ctx.session.church_name} on PSA150`);
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
  const sheet = openSheet(`<h2>${invite ? "Invite link" : "New password link"}</h2>
    <p class="muted">${invite
      ? "Send it to the person, by message or email. Anyone with the link can join, so send it only to them."
      : `Send it to ${escapeHtml(link.display_name ?? "them")}. With it they choose a new password, and the old one stops working.`}
      The link is shown only now.</p>
    <label>Link<input id="link-url" value="${escapeHtml(url)}" readonly /></label>
    <div class="inline-actions wrap">
      <button class="button primary" id="copy-link">${icon("copy")}Copy the link</button>
      ${"share" in navigator ? `<button class="button secondary" id="share-link">${icon("share")}Share</button>` : ""}
    </div>`);
  sheet.addEventListener("close", () => ctx.navigate("#/people", true), { once: true });
  const field = sheet.querySelector<HTMLInputElement>("#link-url")!;
  field.addEventListener("focus", () => field.select());
  sheet.querySelector("#copy-link")?.addEventListener("click", () => void ctx.run(async () => {
    await navigator.clipboard.writeText(url);
    showToast("Link copied.");
  }));
  sheet.querySelector("#share-link")?.addEventListener("click", () => {
    void navigator.share({ title: shareTitle, url }).catch(() => undefined);
  });
}

function openAddSheet(ctx: AppContext): void {
  const sheet = openSheet(`<h2>Add a person</h2>
    <p class="muted">They sign in with this username and password. Give them the password in person; they can change it under More.</p>
    <form id="member-form" class="stack">
      <label>Name<input name="display_name" required maxlength="120" autocomplete="off" /></label>
      <label>Username<input name="username" required maxlength="100" autocapitalize="none" autocomplete="off" spellcheck="false" /></label>
      <label>First password<input name="password" type="password" required minlength="10" autocomplete="new-password" aria-describedby="first-password-hint" /></label>
      <p class="hint field-hint" id="first-password-hint">At least 10 characters.</p>
      <label>Role<select name="role">${roleOptions("viewer")}</select></label>
      <p class="form-message" role="status"></p>
      <button class="button primary wide" type="submit">Add</button>
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
      showToast(`${member.display_name} can now sign in.`);
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
  const sheet = openSheet(`<h2>${escapeHtml(member.display_name)}${you ? " (you)" : ""}</h2>
    <form id="details-form" class="stack">
      <label>Name<input name="display_name" value="${escapeHtml(member.display_name)}" required maxlength="120" autocomplete="off" /></label>
      <label>Username<input name="username" value="${escapeHtml(member.username)}" required maxlength="100" autocapitalize="none" autocomplete="off" spellcheck="false" /></label>
      <label>Role<select name="role">${roleOptions(member.role)}</select></label>
      <p class="form-message" role="status"></p>
      <button class="button primary wide" type="submit">Save</button>
    </form>
    ${you ? `<p class="muted">Change your own password with <strong>Change your password</strong> (the lock beside your name) under More.</p>` : `<h3 class="list-heading">New password</h3>
    <div class="stack">
      <p class="muted">Send them a link to choose a new password themselves. It works once, for 3 days.</p>
      <button class="button secondary wide" id="reset-link">${icon("share")}Make a new password link</button>
      <p class="form-message" id="reset-message" role="status"></p>
    </div>
    <form id="password-form" class="stack">
      <p class="muted">Or choose one and give it to them. Setting one signs them out everywhere. Their API tokens keep working.</p>
      <label>Password<input name="password" type="password" required minlength="10" autocomplete="new-password" aria-describedby="member-password-hint" /></label>
      <p class="hint field-hint" id="member-password-hint">At least 10 characters.</p>
      <p class="form-message" role="status"></p>
      <button class="button secondary wide" type="submit">Set the password</button>
    </form>`}
    <h3 class="list-heading">Access</h3>
    <div class="stack">
      ${you ? "" : `<p class="muted">${member.disabled
        ? "They cannot sign in, and API tokens they had stay revoked."
        : "Disabling signs them out and revokes their API tokens."}</p>
      <button class="button secondary wide" id="toggle-disabled">${member.disabled ? "Let them sign in again" : "Disable sign-in"}</button>`}
      <button class="button secondary wide danger" id="remove-member">${you ? `Leave ${church}` : `Remove from ${church}`}</button>
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
        showToast("Saved.");
        ctx.navigate("#/more", true);
        await ctx.refreshSession(true);
        return;
      }
      done("Saved.");
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
      showLinkSheet(ctx, link, `New password for PSA150`);
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
      done(`New password set for ${member.display_name}.`);
    } catch (error) {
      setFormBusy(password, false);
      password.querySelector<HTMLElement>(".form-message")!.textContent = errorMessage(error);
    }
  });

  sheet.querySelector("#toggle-disabled")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const disable = !member.disabled;
    if (disable && !confirm(`Disable ${member.display_name}? They are signed out, and their API tokens stop working.`)) return;
    button.disabled = true;
    try {
      await ctx.api.updateMember(member.user_id, { disabled: disable });
      done(disable ? `${member.display_name} can no longer sign in.` : `${member.display_name} can sign in again.`);
    } catch (error) {
      button.disabled = false;
      accessMessage.textContent = errorMessage(error);
    }
  });

  sheet.querySelector("#remove-member")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const question = you
      ? `Leave ${ctx.session.church_name}? You will be signed out.`
      : `Remove ${member.display_name} from ${ctx.session.church_name}? They are signed out; the songs and sets they saved stay.`;
    if (!confirm(question)) return;
    button.disabled = true;
    try {
      await ctx.api.removeMember(member.user_id);
      if (you) {
        closeSheet(sheet);
        ctx.signOut();
        return;
      }
      done(`${member.display_name} was removed.`);
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
    ? "Owner: people, settings and everything else"
    : role === "leader"
      ? "Leader: songs, sets and desktops"
      : "Viewer: reads songs and sets";
}
