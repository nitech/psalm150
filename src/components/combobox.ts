import { html, nothing } from "lit";
import { PraiseElement } from "./base";

/**
 * Typeahead combobox: type to filter options and pick by exact match, Enter, or click.
 */
export class PraiseCombobox extends PraiseElement {
  static properties = {
    options: { attribute: false },
    value: { type: String },
    placeholder: { type: String },
    open: { state: true },
    filter: { state: true },
    highlightIndex: { state: true },
  };

  declare options: string[];
  declare value: string;
  declare placeholder: string;
  declare open: boolean;
  declare filter: string;
  declare highlightIndex: number;

  private blurTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.options = [];
    this.value = "";
    this.placeholder = "";
    this.open = false;
    this.filter = "";
    this.highlightIndex = 0;
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("value") && !this.open) {
      this.filter = this.value;
    }
  }

  private get filteredOptions(): string[] {
    const query = this.filter.trim().toLowerCase();
    if (!query) return this.options;
    return this.options.filter((option) => option.toLowerCase().startsWith(query));
  }

  private emitChange(next: string) {
    if (next === this.value) return;
    this.dispatchEvent(
      new CustomEvent("praise-change", { detail: next, bubbles: true, composed: true }),
    );
  }

  private select(option: string) {
    this.filter = option;
    this.open = false;
    this.highlightIndex = 0;
    this.emitChange(option);
  }

  private clearBlurTimer() {
    if (this.blurTimer) {
      clearTimeout(this.blurTimer);
      this.blurTimer = null;
    }
  }

  private onFocus() {
    this.clearBlurTimer();
    this.open = true;
    this.filter = this.value;
    this.highlightIndex = 0;
  }

  private onBlur() {
    this.clearBlurTimer();
    this.blurTimer = setTimeout(() => {
      this.open = false;
      this.filter = this.value;
      this.highlightIndex = 0;
    }, 120);
  }

  private tryExactMatch(text: string) {
    const match = this.options.find((option) => option.toLowerCase() === text.trim().toLowerCase());
    if (match) this.select(match);
  }

  private onInput(event: Event) {
    const text = (event.target as HTMLInputElement).value;
    this.filter = text;
    this.open = true;
    this.highlightIndex = 0;
    this.tryExactMatch(text);
  }

  focusInput() {
    this.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }

  private onKeydown(event: KeyboardEvent) {
    const matches = this.filteredOptions;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.open = true;
      if (matches.length === 0) return;
      this.highlightIndex = Math.min(this.highlightIndex + 1, matches.length - 1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.open = true;
      if (matches.length === 0) return;
      this.highlightIndex = Math.max(this.highlightIndex - 1, 0);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (matches.length > 0) {
        this.select(matches[this.highlightIndex] ?? matches[0]);
      } else {
        this.tryExactMatch(this.filter);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.open = false;
      this.filter = this.value;
      this.highlightIndex = 0;
    }
  }

  render() {
    const matches = this.filteredOptions;
    const showList = this.open && matches.length > 0;

    return html`
      <div class="combobox">
        <input
          type="text"
          role="combobox"
          aria-expanded=${showList ? "true" : "false"}
          aria-autocomplete="list"
          aria-controls="combobox-list"
          placeholder=${this.placeholder}
          .value=${this.filter}
          autocomplete="off"
          spellcheck="false"
          @focus=${() => this.onFocus()}
          @blur=${() => this.onBlur()}
          @input=${(event: Event) => this.onInput(event)}
          @keydown=${(event: KeyboardEvent) => this.onKeydown(event)}
        />
        ${showList
          ? html`
              <div class="combobox-list">
                <ul
                  id="combobox-list"
                  class="dropdown-scroll"
                  role="listbox"
                  @scroll=${(event: Event) => this.onDropdownScroll(event)}
                >
                  ${matches.map(
                    (option, index) => html`
                      <li
                        role="option"
                        aria-selected=${index === this.highlightIndex ? "true" : "false"}
                        class=${index === this.highlightIndex ? "highlighted" : ""}
                        @mousedown=${(event: MouseEvent) => {
                          event.preventDefault();
                          this.select(option);
                        }}
                      >
                        ${option}
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

customElements.define("praise-combobox", PraiseCombobox);

declare global {
  interface HTMLElementTagNameMap {
    "praise-combobox": PraiseCombobox;
  }
}
