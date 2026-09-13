import { html, nothing } from "lit";
import { Psa150Element } from "./base";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Styled dropdown select with a custom option list (native `<select>` popups
 * cannot be themed reliably on Windows/WebView2).
 */
export class Psa150Select extends Psa150Element {
  static properties = {
    options: { attribute: false },
    value: { type: String },
    open: { state: true },
    highlightIndex: { state: true },
  };

  declare options: SelectOption[];
  declare value: string;
  declare open: boolean;
  declare highlightIndex: number;

  private blurTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.options = [];
    this.value = "";
    this.open = false;
    this.highlightIndex = 0;
  }

  private get selectedLabel(): string {
    return this.options.find((option) => option.value === this.value)?.label ?? "";
  }

  private emitChange(next: string) {
    if (next === this.value) return;
    this.dispatchEvent(
      new CustomEvent("psa150-change", { detail: next, bubbles: true, composed: true }),
    );
  }

  private clearBlurTimer() {
    if (this.blurTimer) {
      clearTimeout(this.blurTimer);
      this.blurTimer = null;
    }
  }

  private close() {
    this.open = false;
    this.highlightIndex = 0;
  }

  private select(option: SelectOption) {
    this.close();
    this.emitChange(option.value);
  }

  private onTriggerClick() {
    this.clearBlurTimer();
    const nextOpen = !this.open;
    this.open = nextOpen;
    if (nextOpen) {
      const selectedIndex = this.options.findIndex((option) => option.value === this.value);
      this.highlightIndex = selectedIndex >= 0 ? selectedIndex : 0;
    }
  }

  private onTriggerBlur() {
    this.clearBlurTimer();
    this.blurTimer = setTimeout(() => this.close(), 120);
  }

  private onKeydown(event: KeyboardEvent) {
    if (!this.open && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      this.open = true;
      const selectedIndex = this.options.findIndex((option) => option.value === this.value);
      this.highlightIndex = selectedIndex >= 0 ? selectedIndex : 0;
      return;
    }

    if (!this.open) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (this.options.length === 0) return;
      this.highlightIndex = Math.min(this.highlightIndex + 1, this.options.length - 1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (this.options.length === 0) return;
      this.highlightIndex = Math.max(this.highlightIndex - 1, 0);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = this.options[this.highlightIndex];
      if (option) this.select(option);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
    }
  }

  render() {
    const showList = this.open && this.options.length > 0;

    return html`
      <div class="select ${this.open ? "open" : ""}">
        <button
          type="button"
          class="select-trigger"
          role="combobox"
          aria-expanded=${showList ? "true" : "false"}
          aria-haspopup="listbox"
          @click=${() => this.onTriggerClick()}
          @blur=${() => this.onTriggerBlur()}
          @keydown=${(event: KeyboardEvent) => this.onKeydown(event)}
        >
          <span class="select-value">${this.selectedLabel}</span>
          <span class="select-chevron" aria-hidden="true"></span>
        </button>
        ${showList
          ? html`
              <div class="select-list">
                <ul
                  class="dropdown-scroll"
                  role="listbox"
                  @scroll=${(event: Event) => this.onDropdownScroll(event)}
                >
                  ${this.options.map(
                    (option, index) => html`
                      <li
                        role="option"
                        aria-selected=${option.value === this.value ? "true" : "false"}
                        class=${[
                          option.value === this.value ? "selected" : "",
                          index === this.highlightIndex ? "highlighted" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        @mousedown=${(event: MouseEvent) => {
                          event.preventDefault();
                          this.select(option);
                        }}
                      >
                        ${option.label}
                      </li>
                    `,
                  )}
                </ul>
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

customElements.define("psa150-select", Psa150Select);

declare global {
  interface HTMLElementTagNameMap {
    "psa150-select": Psa150Select;
  }
}
