import { html, nothing, type TemplateResult } from "lit";
import { Psa150Element } from "./base";

export type ModalVariant = "default" | "wide" | "tall";

/**
 * Reusable modal shell: backdrop, card, header with title and close button.
 *
 * Body content is passed as a Lit template via the `content` property so the
 * markup keeps living with the owning component while the shell, sizing and
 * dismissal behaviour stay in one place.
 */
export class Psa150Modal extends Psa150Element {
  static properties = {
    heading: {},
    open: { type: Boolean, reflect: true },
    variant: {},
    content: { attribute: false },
  };

  declare heading: string;
  declare open: boolean;
  declare variant: ModalVariant;
  declare content: TemplateResult | typeof nothing;

  constructor() {
    super();
    this.heading = "";
    this.open = false;
    this.variant = "default";
    this.content = nothing;
  }

  private close() {
    this.dispatchEvent(new CustomEvent("psa150-close", { bubbles: true, composed: true }));
  }

  private onBackdrop = (event: MouseEvent) => {
    if (event.target === event.currentTarget) this.close();
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
        <div class="${cardClass}" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h2>${this.heading}</h2>
            <button class="icon-btn" type="button" aria-label="Close" @click=${() => this.close()}>
              ×
            </button>
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
