import { html, nothing } from "lit";
import { Psa150Element } from "./base";

export interface SelectOption {
  value: string;
  label: string;
}

let nextSelectId = 0;

/**
 * Styled dropdown select with a custom option list (native `<select>` popups
 * cannot be themed reliably on Windows/WebView2).
 *
 * Follows the ARIA select-only combobox pattern: the trigger keeps focus and
 * points at the highlighted option with `aria-activedescendant`. Keys: ↓/↑ or
 * Enter/Space open; ↓/↑, Home/End and Page Up/Down move; Enter/Space choose;
 * Escape closes without choosing; Tab closes. Keys it uses do not reach the
 * console's global shortcuts. Name it with `label` or `labelledby` (the id of
 * a visible label).
 */
export class Psa150Select extends Psa150Element {
  static properties = {
    options: { attribute: false },
    value: { type: String },
    label: {},
    labelledby: {},
    open: { state: true },
    highlightIndex: { state: true },
  };

  declare options: SelectOption[];
  declare value: string;
  declare label: string;
  declare labelledby: string;
  declare open: boolean;
  declare highlightIndex: number;

  private blurTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly uid = `psa150-select-${++nextSelectId}`;

  constructor() {
    super();
    this.options = [];
    this.value = "";
    this.label = "";
    this.labelledby = "";
    this.open = false;
    this.highlightIndex = 0;
  }

  private get selectedLabel(): string {
    return this.options.find((option) => option.value === this.value)?.label ?? "";
  }

  private optionId(index: number): string {
    return `${this.uid}-option-${index}`;
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

  private openList() {
    this.open = true;
    const selectedIndex = this.options.findIndex((option) => option.value === this.value);
    this.highlightIndex = selectedIndex >= 0 ? selectedIndex : 0;
  }

  private select(option: SelectOption) {
    this.close();
    this.emitChange(option.value);
  }

  private onTriggerClick() {
    this.clearBlurTimer();
    if (this.open) this.close();
    else this.openList();
  }

  private onTriggerBlur() {
    this.clearBlurTimer();
    this.blurTimer = setTimeout(() => this.close(), 120);
  }

  private onKeydown(event: KeyboardEvent) {
    if (event.altKey && event.key === "ArrowUp" && this.open) {
      const option = this.options[this.highlightIndex];
      event.preventDefault();
      event.stopPropagation();
      if (option) this.select(option);
      else this.close();
      return;
    }

    if (!this.open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        this.openList();
      }
      return;
    }

    const last = this.options.length - 1;
    const move = (index: number) => {
      event.preventDefault();
      event.stopPropagation();
      if (last >= 0) this.highlightIndex = Math.max(0, Math.min(last, index));
    };

    switch (event.key) {
      case "ArrowDown":
        move(this.highlightIndex + 1);
        return;
      case "ArrowUp":
        move(this.highlightIndex - 1);
        return;
      case "Home":
        move(0);
        return;
      case "End":
        move(last);
        return;
      case "PageDown":
        move(this.highlightIndex + 10);
        return;
      case "PageUp":
        move(this.highlightIndex - 10);
        return;
      case "Enter":
      case " ": {
        event.preventDefault();
        event.stopPropagation();
        const option = this.options[this.highlightIndex];
        if (option) this.select(option);
        return;
      }
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      case "Tab":
        this.close();
        return;
    }
  }

  protected updated() {
    if (!this.open) return;
    this.querySelector<HTMLElement>(`#${this.optionId(this.highlightIndex)}`)?.scrollIntoView({
      block: "nearest",
    });
  }

  render() {
    const showList = this.open && this.options.length > 0;
    const listId = `${this.uid}-list`;

    return html`
      <div class="select ${this.open ? "open" : ""}">
        <button
          type="button"
          class="select-trigger"
          role="combobox"
          aria-label=${this.label || nothing}
          aria-labelledby=${this.labelledby || nothing}
          aria-controls=${listId}
          aria-expanded=${showList ? "true" : "false"}
          aria-haspopup="listbox"
          aria-activedescendant=${showList ? this.optionId(this.highlightIndex) : nothing}
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
                  id=${listId}
                  class="dropdown-scroll"
                  role="listbox"
                  aria-label=${this.label || nothing}
                  aria-labelledby=${this.labelledby || nothing}
                  @scroll=${(event: Event) => this.onDropdownScroll(event)}
                >
                  ${this.options.map(
                    (option, index) => html`
                      <li
                        id=${this.optionId(index)}
                        role="option"
                        aria-selected=${option.value === this.value ? "true" : "false"}
                        class=${[
                          option.value === this.value ? "selected" : "",
                          index === this.highlightIndex ? "highlighted" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        @mousedown=${(event: MouseEvent) => event.preventDefault()}
                        @click=${() => this.select(option)}
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
