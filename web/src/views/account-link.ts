import { setTitle } from "../../../shared/songs/a11y.ts";
import { ApiError, type SongServerApi } from "../api.ts";
import type { AccountLinkKind, PublicAccountLink, Session } from "../types.ts";
import { errorMessage, escapeHtml, roleName, setFormBusy, showFormError } from "../ui.ts";

/**
 * Invite and reset links an owner sends: `/invite/{token}` lets a new person
 * choose their username and password, `/reset-password/{token}` lets someone
 * choose a new password. Either signs them in. Lives outside the app shell,
 * like `/join`, since the person has no session yet.
 */

export interface AccountLinkPath {
  kind: AccountLinkKind;
  token: string;
}

export function accountLinkPath(): AccountLinkPath | null {
  const match = /^\/(invite|reset-password)\/([A-Za-z0-9_]+)\/?$/.exec(location.pathname);
  if (!match) return null;
  return { kind: match[1] === "invite" ? "invite" : "reset", token: match[2] };
}

export async function renderAccountLink(
  app: HTMLElement,
  api: SongServerApi,
  path: AccountLinkPath,
  signedIn: (session: Session) => void,
): Promise<void> {
  let link: PublicAccountLink;
  try {
    link = await api.getAccountLink(path.token);
  } catch (error) {
    const gone = error instanceof ApiError && error.status === 404;
    setTitle(gone ? "Link does not work" : "Could not open the link");
    app.innerHTML = frame(
      gone ? "This link does not work" : "Could not open the link",
      gone
        ? path.kind === "invite"
          ? "It was used already, has expired or was withdrawn. Ask an owner of your church for a new invite."
          : "It was used already, has expired or was withdrawn. Ask an owner of your church for a new link."
        : escapeHtml(errorMessage(error)),
      `<a class="button secondary wide" href="/">Open the song library</a>`,
    );
    return;
  }

  const church = escapeHtml(link.church_name);
  const invite = link.kind === "invite";
  setTitle(invite ? "Join" : "Choose a new password");
  app.innerHTML = frame(
    invite ? `Join ${link.church_name}` : "Choose a new password",
    invite
      ? `You are invited to <strong>${church}</strong>'s song library as a ${roleName(link.role ?? "viewer").toLowerCase()}. Choose how you sign in.`
      : `For <strong>${escapeHtml(link.display_name ?? "")}</strong> at <strong>${church}</strong>. You sign in as <strong>${escapeHtml(link.username ?? "")}</strong>. Your other sessions end.`,
    `<form class="stack" id="link-form">
      ${invite ? `<label>Your name<input name="display_name" value="${escapeHtml(link.display_name ?? "")}" autocomplete="name" maxlength="120" required /></label>
      <label>Username<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="100" required autofocus /></label>`
        : `<input type="hidden" name="username" value="${escapeHtml(link.username ?? "")}" autocomplete="username" />`}
      <label>${invite ? "Password" : "New password"}<input name="password" type="password" minlength="10" autocomplete="new-password" aria-describedby="link-password-hint" required ${invite ? "" : "autofocus"} /></label>
      <p class="hint field-hint" id="link-password-hint">At least 10 characters.</p>
      <button class="button primary wide" type="submit">${invite ? "Join" : "Save and sign in"}</button>
      <p class="form-message" role="status"></p>
    </form>`,
  );
  const form = app.querySelector<HTMLFormElement>("#link-form")!;
  form.querySelector<HTMLElement>("[autofocus]")?.focus();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    setFormBusy(form, true);
    try {
      const session = await api.useAccountLink(path.token, {
        password: String(data.get("password")),
        ...(invite ? { username: String(data.get("username")).trim(), display_name: String(data.get("display_name")).trim() } : {}),
      });
      signedIn(session);
    } catch (error) {
      setFormBusy(form, false);
      const field = error instanceof ApiError && error.status === 409
        ? form.querySelector<HTMLInputElement>("input[name=username]")
        : null;
      showFormError(form, errorMessage(error), field);
    }
  });
}

function frame(title: string, copy: string, body: string): string {
  return `<main class="auth">
    <div class="auth-card">
      <div class="brand large"><span class="brand-mark" aria-hidden="true">150</span><span>PSA150</span></div>
      <h1 tabindex="-1">${escapeHtml(title)}</h1>
      <p class="lede">${copy}</p>
      ${body}
    </div>
  </main>`;
}
