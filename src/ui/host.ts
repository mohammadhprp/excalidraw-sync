/**
 * The panel's isolation boundary.
 *
 * A fixed-position host element is appended to `document.body`; an **open**
 * shadow root is attached to it so the panel can be inspected (and driven)
 * from the page for live verification. All panel CSS lives inside the shadow
 * root, and the inline host styles include `all: initial` so the page's global
 * selectors and inherited properties cannot reach the panel content.
 */

export const HOST_ID = "excalidraw-sync-host";

export interface PanelHost {
  host: HTMLElement;
  shadow: ShadowRoot;
}

/** Mount the host + shadow root once, returning the existing one if present. */
export function mountPanelHost(doc: Document = document): PanelHost {
  const existing = doc.getElementById(HOST_ID);
  if (existing && existing.shadowRoot) {
    return { host: existing, shadow: existing.shadowRoot };
  }

  const host = existing ?? doc.createElement("div");
  host.id = HOST_ID;
  // `all: initial` first, then the properties we actually want, so page rules
  // and inherited values cannot bleed in. Inline styles beat page stylesheets.
  host.style.cssText = [
    "all: initial",
    "position: fixed",
    "inset: auto 0 0 auto",
    "width: 0",
    "height: 0",
    "z-index: 2147483647",
  ].join("; ");

  if (!host.isConnected) doc.body.append(host);

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  return { host, shadow };
}
