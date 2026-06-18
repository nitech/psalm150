import { LitElement } from "lit";

/**
 * Base class for every Visual Song Book component.
 *
 * Components render into the light DOM (not a shadow root) so the global design
 * system in `styles.css` applies directly and layout-measuring code in the
 * projection windows can still query rendered nodes.
 */
export class VsbElement extends LitElement {
  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }
}
