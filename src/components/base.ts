import { LitElement } from "lit";

/**
 * Base class for every Praise component.
 *
 * Components render into the light DOM (not a shadow root) so the global design
 * system in `styles.css` applies directly and layout-measuring code in the
 * projection windows can still query rendered nodes.
 */
export class PraiseElement extends LitElement {
  private dropdownScrollTimer: ReturnType<typeof setTimeout> | null = null;

  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  /** Reveal overlay scrollbar while scrolling; fades after idle. */
  protected onDropdownScroll(event: Event) {
    const el = event.currentTarget as HTMLElement;
    el.classList.add("is-scrolling");
    if (this.dropdownScrollTimer) clearTimeout(this.dropdownScrollTimer);
    this.dropdownScrollTimer = setTimeout(() => {
      el.classList.remove("is-scrolling");
      this.dropdownScrollTimer = null;
    }, 700);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.dropdownScrollTimer) clearTimeout(this.dropdownScrollTimer);
  }
}
