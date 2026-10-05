import { html, nothing, type TemplateResult } from "lit";
import { Psa150Element } from "./base";

export type ModalVariant = "default" | "wide" | "tall";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"], [contenteditable="plaintext-only"]';

let nextModalId = 0;

/**
 * Reusable modal shell: backdrop, card, header with title and close button.
 *
 * Body content is passed as a Lit template via the `content` property so the
 * markup keeps living with the owning component while the shell, sizing and
 * dismissal behaviour stay in one place.
 *
 * Accessibility: the card is a modal dialog named by its heading. Opening moves
 * focus into it (the first control after the header, else the close button),
 * Tab and Shift+Tab stay inside, and closing returns focus to where it was.
 * Escape is handled by the owner (`psa150-app`), which knows which dialog is
 * on top. A dialog that is not `dismissible` (import in progress) has no close
 * button and ignores backdrop clicks.
 */
export class Psa150Modal extends Psa150Element {
  static properties = {
    heading: {},
    open: { type: Boolean, reflect: true },
    variant: {},
    dismissible: { type: Boolean },
    content: { attribute: false },
  };

  declare heading: string;
  declare open: boolean;
  declare variant: ModalVariant;
  declare dismissible: boolean;
  declare content: TemplateResult | typeof nothing;

  private readonly headingId = `psa150-modal-heading-${++nextModalId}`;
  /** Where focus goes back to when the dialog closes. */
  returnFocusTarget: HTMLElement | null = null;

  constructor() {
    super();
    this.heading = "";
    this.open = false;
    this.variant = "default";
    this.dismissible = true;
    this.content = nothing;
  }

  private close() {
    this.dispatchEvent(new CustomEvent("psa150-close", { bubbles: true, composed: true }));
  }

  private onBackdrop = (event: MouseEvent) => {
    if (this.dismissible && event.target === event.currentTarget) this.close();
  };

  protected willUpdate(changed: Map<PropertyKey, unknown>) {
    if (changed.has("open") && this.open && !changed.get("open")) {
      // Opening one dialog from another (Settings → duplicates): return to
      // whatever opened the first one.
      const active = document.activeElement as HTMLElement | null;
      const owner = active?.closest("psa150-modal");
      this.returnFocusTarget =
        owner && owner !== this ? (owner as Psa150Modal).returnFocusTarget : active;
    }
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    if (!changed.has("open")) return;
    if (this.open) {
      this.focusInitial();
    } else if (changed.get("open")) {
      const target = this.returnFocusTarget;
      this.returnFocusTarget = null;
      const active = document.activeElement;
      if (target?.isConnected && (!active || active === document.body)) {
        target.focus({ preventScroll: true });
      }
    }
  }

  private card(): HTMLElement | null {
    return this.querySelector<HTMLElement>(":scope > .modal-backdrop > .modal-card");
  }

  private focusables(): HTMLElement[] {
    const card = this.card();
    if (!card) return [];
    return [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.getClientRects().length > 0 && !el.closest("[inert]"),
    );
  }

  private focusInitial() {
    const card = this.card();
    if (!card || card.contains(document.activeElement)) return;
    const all = this.focusables();
    const target = all.find((el) => !el.closest(".modal-header")) ?? all[0] ?? card;
    target.focus({ preventScroll: true });
  }

  private onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const all = this.focusables();
    if (all.length === 0) {
      event.preventDefault();
      return;
    }
    const first = all[0];
    const last = all[all.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !this.card()?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !this.card()?.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  render() {
    if (!this.open) return nothing;
    const cardClass =
      this.variant === "wide"
        ? "modal-card modal-card-wide"
        : this.variant === "tall"
          ? "modal-card modal-card-tall"
          : "modal-card";
    return html`
      <div class="modal-backdrop" @click=${this.onBackdrop}>
        <div
          class="${cardClass}"
          role="dialog"
          aria-modal="true"
          aria-labelledby=${this.headingId}
          tabindex="-1"
          @keydown=${this.onKeydown}
        >
          <div class="modal-header">
            <h2 id=${this.headingId}>${this.heading}</h2>
            ${this.dismissible
              ? html`<button class="icon-btn" type="button" aria-label="Close" @click=${() => this.close()}>
                  ×
                </button>`
              : nothing}
          </div>
          ${this.content}
        </div>
      </div>
    `;
  }
}

customElements.define("psa150-modal", Psa150Modal);

declare global {
  interface HTMLElementTagNameMap {
    "psa150-modal": Psa150Modal;
  }
}
