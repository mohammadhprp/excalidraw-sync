/**
 * Tiny hyperscript helper for the Shadow-DOM panel.
 *
 * Deliberately dependency-free: the panel ships inside a content-script
 * bundle, so a full UI framework would bloat every excalidraw.com page load.
 */

export type Child = Node | string | number | null | undefined | false;

export interface ElementProps {
  class?: string;
  text?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  id?: string;
  for?: string;
  role?: string;
  checked?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  ariaLabel?: string;
  attrs?: Record<string, string>;
  on?: Record<string, EventListener>;
}

/** Create an element, apply props, and append children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElementProps | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (props) {
    if (props.class !== undefined) el.className = props.class;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.title !== undefined) el.title = props.title;
    if (props.id !== undefined) el.id = props.id;
    if (props.role !== undefined) el.setAttribute("role", props.role);
    if (props.ariaLabel !== undefined) el.setAttribute("aria-label", props.ariaLabel);
    if (props.attrs) {
      for (const [key, value] of Object.entries(props.attrs)) {
        el.setAttribute(key, value);
      }
    }
    if (props.type !== undefined) (el as unknown as HTMLInputElement).type = props.type;
    if (props.value !== undefined) (el as unknown as HTMLInputElement).value = props.value;
    if (props.placeholder !== undefined) {
      (el as unknown as HTMLInputElement).placeholder = props.placeholder;
    }
    if (props.for !== undefined) (el as unknown as HTMLLabelElement).htmlFor = props.for;
    if (props.checked !== undefined) {
      (el as unknown as HTMLInputElement).checked = props.checked;
    }
    if (props.disabled !== undefined) {
      (el as unknown as HTMLButtonElement).disabled = props.disabled;
    }
    if (props.hidden !== undefined) el.hidden = props.hidden;
    if (props.on) {
      for (const [event, listener] of Object.entries(props.on)) {
        el.addEventListener(event, listener);
      }
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" || typeof child === "number" ? String(child) : child);
  }

  return el;
}

/** Remove every child of a node. */
export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
