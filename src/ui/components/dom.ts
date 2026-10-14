import { icons } from './icons.ts';

/**
 * Small builders both readers share, so the same control is built the same way everywhere
 * (docs/design/patterns.md): chips, settings rows, switches, selects and text fields.
 */

/**
 * Markup bundled with the extension (icons, templates, placeholders), parsed in an inert document and then moved
 * into the page. It is never document content: that goes through `sanitize()` or becomes text nodes (ADR 0006,
 * ADR 0033). Writing a string with `innerHTML` is a lint error, and so is parsing one anywhere else.
 */
export function markup(html: string): DocumentFragment {
  const body = new DOMParser().parseFromString(`<body>${html}`, 'text/html').body;
  const fragment = document.createDocumentFragment();
  for (const node of body.childNodes) fragment.append(document.importNode(node, true));
  return fragment;
}

const parsedIcons = new Map<string, DocumentFragment>();

/** One of Galley's bundled icons (`icons.ts`) as a new node. Each icon is parsed once and copied after that. */
export function glyph(svg: string): DocumentFragment {
  const parsed = parsedIcons.get(svg) ?? markup(svg);
  parsedIcons.set(svg, parsed);
  return parsed.cloneNode(true) as DocumentFragment;
}

/** The grey lines shown while something loads. */
export function loadingLines(): HTMLElement {
  const lines = h('div', 'mr-skeleton');
  lines.replaceChildren(markup('<i class="h"></i><i></i><i></i><i class="s"></i><i></i><i></i><i></i><i class="s"></i>'));
  return lines;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function button(label: string, act: string, className = 'mr-btn mr-outline'): HTMLButtonElement {
  const b = h('button', className, label);
  b.type = 'button';
  b.dataset.act = act;
  return b;
}

/** Change kinds colour the dot; `own` is the reader's own (a hint of the accent), `unverified` a guess (a hollow dot). */
export type ChipKind = 'added' | 'modified' | 'removed' | 'moved' | 'own' | 'unverified';

/** A fact as a chip: a dot and a word, never colour alone. */
export function chip(kind: ChipKind | null, text: string): HTMLElement {
  const el = h('span', kind ? `mr-chip is-${kind}` : 'mr-chip');
  el.append(h('span', 'mr-dot'), text);
  return el;
}

let rows = 0;

/** A settings row: the label, with an optional explanation, on the left; the control on the right. */
export function setRow(label: string, control: HTMLElement, explain = ''): HTMLElement {
  const row = h('div', 'mr-set-row');
  const id = `mr-row-${++rows}`;
  const name = h('span', '', label);
  name.id = id;
  if (explain) name.append(h('small', '', explain));
  // The control is named by its row, whatever kind of control it is.
  const field = control.matches('select, input, button, [role="group"]') ? control : control.querySelector('select, input');
  field?.setAttribute('aria-labelledby', id);
  row.append(name, control);
  return row;
}

/** An on/off control: `role="switch"` with its state in `aria-checked`; its row names it. */
export function switchButton(act: string, checked: boolean): HTMLButtonElement {
  const b = h('button', 'mr-switch');
  b.type = 'button';
  b.dataset.act = act;
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(checked));
  return b;
}

/** A native select with the reader's chevron. */
export function selectField(select: HTMLSelectElement): HTMLElement {
  const box = h('div', 'mr-font-select');
  box.append(glyph(icons.chevronDown));
  box.prepend(select);
  return box;
}

export function option(value: string, label: string, selected = false): HTMLOptionElement {
  const el = h('option', '', label);
  el.value = value;
  el.defaultSelected = selected;
  return el;
}

/** A one-line text field, styled like the select beside it. */
export function textField(name: string, value = '', most = 200): HTMLInputElement {
  const input = h('input', 'mr-field');
  input.name = name;
  input.defaultValue = value;
  input.maxLength = most;
  return input;
}
