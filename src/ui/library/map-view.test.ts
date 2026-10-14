import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MapConnection, MapPlace, ProjectMapModel } from '../../core/project-map.ts';
import { Sheet } from '../components/sheet.ts';
import { DocumentMap } from './map-view.ts';
import type { DocumentMapHost, DocumentMapState } from './map-view-shared.ts';

/**
 * The Documents map on its own, with a stand-in for the library and the library's sheet. jsdom has no layout, so
 * each test says where places are drawn; the library's own tests (repo-map.test.ts) cover reading, evidence and
 * corrections.
 */

const media = new EventTarget() as MediaQueryList;
const resized: Array<() => void> = [];
const disconnect = vi.fn();
/** Where each place is drawn: left, top, width, height. */
let boxes: Record<string, [number, number, number, number]> = {};
let canvas = { width: 0, height: 0 };
let world = { width: 0, height: 0 };

beforeEach(() => {
  Object.defineProperty(media, 'matches', { value: false, configurable: true });
  vi.stubGlobal('matchMedia', () => media);
  resized.length = 0;
  disconnect.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized.push(callback);
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  Object.defineProperty(Element.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  boxes = {};
  canvas = { width: 0, height: 0 };
  world = { width: 0, height: 0 };
  const box = (el: HTMLElement): [number, number, number, number] => {
    if (el.classList.contains('mr-pm-world')) return [0, 0, world.width, world.height];
    if (el.classList.contains('mr-pm-lane')) return [0, 170, 0, 0];
    return boxes[el.dataset.id ?? ''] ?? [0, 0, 0, 0];
  };
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
    return box(this)[0];
  });
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return box(this)[1];
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return box(this)[2];
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return box(this)[3];
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('mr-pm-canvas') ? canvas.width : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('mr-pm-canvas') ? canvas.height : 0;
  });
});

afterEach(() => {
  document.body.replaceChildren();
});

function place(id: string, patch: Partial<MapPlace> = {}): MapPlace {
  const folder = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
  return {
    id,
    title: id.replace(/^.*\//, '').replace(/\.md$/, ''),
    path: id,
    folder,
    kind: 'Document',
    kindFrom: 'path',
    sourceKind: 'Document',
    sourceKindFrom: 'path',
    origin: 'documented',
    statuses: [],
    state: 'indexed',
    ...patch,
  };
}

function link(from: string, to: string, proofs = 1, hiddenProof = 0): MapConnection {
  return {
    id: `${from}\u0000${to}`,
    from,
    to,
    verb: 'links to',
    origin: 'documented',
    proof: Array.from({ length: proofs }, (_, at) => ({ path: from, line: at + 3, quote: at ? `more about ${to}` : '', section: at ? 'Part' : null })),
    hiddenProof,
  };
}

const graph = (places: MapPlace[], connections: MapConnection[]): ProjectMapModel => ({ places, connections, omittedPlaces: 0, omittedConnections: 0 });

function mount(state: Partial<DocumentMapState> & { model: ProjectMapModel }, host: Partial<DocumentMapHost> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const sheet = new Sheet({
    root,
    className: 'mr-pm-sheet',
    closeLabel: 'Close details',
    parts: () => [],
    background: () => [map.element, map.tools],
    dismiss: () => map.closeSheet(),
  });
  const library: DocumentMapHost = {
    preview: vi.fn(async (path: string) => {
      const box = document.createElement('div');
      box.className = 'mr-pm-preview';
      box.append(`Preview of ${path}`);
      return box;
    }),
    details: vi.fn(() => []),
    problems: vi.fn(() => null),
    refocus: vi.fn(),
    sheet,
    commit: 'c0ffee1234567890',
    ...host,
  };
  const map = new DocumentMap(library);
  root.prepend(map.tools, map.element);
  const full: DocumentMapState = { focus: 'f.md', here: null, changed: new Set(), ...state };
  map.draw(full);
  const q = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T & HTMLElement>(selector)!;
  const all = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];
  /** The library hands every `pm-` action to the map. */
  const press = (selector: string) => map.onAct(q(selector));
  const card = (id: string) => all('.mr-pm-place').find((node) => node.dataset.id === id)!;
  const key = (target: Element, key: string, init: KeyboardEventInit = {}) => {
    let handled = false;
    const listen = (event: Event) => {
      handled = map.onKey(event as KeyboardEvent);
    };
    target.addEventListener('keydown', listen);
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...init }));
    target.removeEventListener('keydown', listen);
    return handled;
  };
  const transform = () => q('.mr-pm-world').style.transform;
  return { map, sheet, host: library, state: full, q, all, press, card, key, transform };
}

/** a and c link to the middle, which links to b and d; the neighbours also link among themselves. */
const placed = () => {
  boxes = {
    'a.md': [0, 40, 200, 60],
    'c.md': [0, 200, 200, 60],
    'f.md': [300, 200, 240, 80],
    'b.md': [640, 40, 200, 60],
    'd.md': [640, 400, 200, 60],
  };
};
const neighbours = ['a.md', 'b.md', 'c.md', 'd.md', 'f.md'].map((id) => place(id));
const before = [
  link('f.md', 'a.md'),
  link('a.md', 'f.md'),
  link('f.md', 'b.md'),
  link('c.md', 'f.md'),
  link('f.md', 'd.md'),
  link('a.md', 'c.md'),
  link('c.md', 'a.md'),
  link('b.md', 'd.md'),
  link('a.md', 'b.md'),
  link('c.md', 'd.md'),
  link('d.md', 'a.md'),
  link('f.md', 'f.md'),
];
/** Reading b shows that it links back; it stays where it was drawn. */
const after = [...before.slice(0, 2), link('b.md', 'f.md'), ...before.slice(2)];

it('draws one line per pair of places, from the side that faces the middle, with an arrowhead where each link arrives', () => {
  placed();
  const ui = mount({ model: graph(neighbours, before) });
  ui.map.draw({ ...ui.state, model: graph(neighbours, after) });
  expect(ui.all('.mr-pm-place').map((node) => [node.dataset.id, node.dataset.lane])).toStrictEqual([
    ['a.md', 'incoming'],
    ['c.md', 'incoming'],
    ['f.md', 'here'],
    ['b.md', 'outgoing'],
    ['d.md', 'outgoing'],
  ]);
  const edges = ui.all('.mr-pm-edge');
  expect(
    edges.map((edge) => [`${edge.dataset.from} ${edge.dataset.to}`, edge.getAttribute('class'), edge.querySelectorAll('.mr-pm-arrow').length]),
  ).toStrictEqual([
    ['f.md a.md', 'mr-pm-edge is-focus', 2],
    ['b.md f.md', 'mr-pm-edge is-focus', 2],
    ['c.md f.md', 'mr-pm-edge is-focus', 1],
    ['f.md d.md', 'mr-pm-edge is-focus', 1],
    ['a.md c.md', 'mr-pm-edge is-context', 2],
    ['b.md d.md', 'mr-pm-edge is-context', 1],
    ['a.md b.md', 'mr-pm-edge is-context', 1],
    ['c.md d.md', 'mr-pm-edge is-context', 1],
    ['d.md a.md', 'mr-pm-edge is-context', 1],
  ]);
  const line = (at: number) => edges[at].querySelector('.mr-pm-line')!.getAttribute('d')!;
  // An incoming neighbour's line leaves its right edge for the middle's left edge.
  expect(line(0)).toBe('M 200 70 C 250 70, 250 240, 300 240');
  // Neighbours in one lane connect on its outer side; a line across clear of the middle runs straight.
  expect(line(4)).toMatch(/^M 0 70 C -/);
  expect(line(5)).toBe('M 840 70 C 940 70, 940 430, 840 430');
  expect(line(6)).toBe('M 200 70 C 420 70, 420 70, 640 70');
  // One that would run behind the middle bends below it.
  expect(line(7)).toContain(`L 540 304`);
  expect(line(8)).toContain(`L 540 304`);
  // Each line has a wide, invisible stroke to choose it by.
  expect(edges[0].querySelector<HTMLElement>('.mr-pm-hit')!.dataset).toMatchObject({ act: 'pm-connection', id: 'f.md\u0000a.md' });
});

it('lights the lines of the place pointed at, tabbed to or chosen, and dims the rest', () => {
  placed();
  const ui = mount({ model: graph(neighbours, before) });
  const lit = () => ui.all('.mr-pm-edge.is-lit').map((edge) => `${edge.dataset.from} ${edge.dataset.to}`);
  expect(lit()).toStrictEqual([]);
  expect(ui.all('.mr-pm-edge.is-dim')).toHaveLength(0);
  ui.card('c.md').dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  expect(lit()).toStrictEqual(['c.md f.md', 'a.md c.md', 'c.md d.md']);
  expect(ui.all('.mr-pm-edge.is-dim')).toHaveLength(6);
  ui.q('.mr-pm-lane-head').dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  expect(lit()).toStrictEqual([]);
  ui.card('d.md').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  expect(lit()).toStrictEqual(['f.md d.md', 'b.md d.md', 'c.md d.md', 'd.md a.md']);
  ui.q('.mr-pm-lane').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  expect(lit()).toStrictEqual([]);
  ui.card('b.md').click();
  ui.press('.mr-pm-place[data-id="b.md"]');
  ui.q('.mr-pm-world').dispatchEvent(new Event('focusout'));
  expect(lit()).toStrictEqual(['f.md b.md', 'b.md d.md', 'a.md b.md']);
  ui.q('.mr-pm-world').dispatchEvent(new Event('pointerleave'));
  expect(ui.card('b.md').getAttribute('aria-pressed')).toBe('true');
  // The middle's own lines are always drawn, so choosing it lights nothing extra.
  ui.press('.mr-pm-place[data-id="f.md"]');
  expect(lit()).toStrictEqual([]);
});

it('moves and zooms with buttons, keys, a trackpad and dragging; Fit shows the whole neighbourhood', () => {
  placed();
  canvas = { width: 1000, height: 600 };
  world = { width: 1250, height: 500 };
  const ui = mount({ model: graph(neighbours, before) });
  // Fit scales a neighbourhood wider than the map down, and centres it.
  expect(ui.transform()).toBe('translate(0px, 100px) scale(0.8)');
  const canvasEl = ui.q('.mr-pm-canvas');
  expect(ui.key(canvasEl, 'ArrowLeft')).toBe(true);
  expect(ui.key(canvasEl, 'ArrowUp')).toBe(true);
  expect(ui.transform()).toBe('translate(60px, 160px) scale(0.8)');
  expect(ui.key(canvasEl, 'ArrowRight')).toBe(true);
  expect(ui.key(canvasEl, 'ArrowDown')).toBe(true);
  expect(ui.key(canvasEl, '+')).toBe(true);
  expect(ui.transform()).toBe('translate(-62.5px, 75px) scale(0.9)');
  expect(ui.key(canvasEl, '=')).toBe(true);
  expect(ui.key(canvasEl, '-')).toBe(true);
  expect(ui.key(canvasEl, 'x')).toBe(false);
  expect(ui.key(canvasEl, '0')).toBe(true);
  expect(ui.transform()).toBe('translate(0px, 100px) scale(0.8)');
  // Keys elsewhere are the library's.
  expect(ui.key(ui.card('a.md'), 'ArrowLeft')).toBe(false);
  // Zoom stops at its limits, and says so by disabling the button.
  for (let i = 0; i < 12; i++) ui.press('[data-act="pm-zoom-in"]');
  expect(ui.transform()).toMatch(/scale\(1\.5\)$/);
  expect(ui.q<HTMLButtonElement>('[data-act="pm-zoom-in"]').disabled).toBe(true);
  for (let i = 0; i < 12; i++) ui.press('[data-act="pm-zoom-out"]');
  expect(ui.transform()).toMatch(/scale\(0\.5\)$/);
  expect(ui.q<HTMLButtonElement>('[data-act="pm-zoom-out"]').disabled).toBe(true);
  ui.press('[data-act="pm-fit"]');
  // A trackpad moves the map; a pinch zooms around the pointer.
  canvasEl.dispatchEvent(new WheelEvent('wheel', { deltaX: 10, deltaY: 20, cancelable: true }));
  expect(ui.transform()).toBe('translate(-10px, 80px) scale(0.8)');
  const pinch = new WheelEvent('wheel', { deltaY: -30, ctrlKey: true, clientX: 0, clientY: 0, cancelable: true });
  canvasEl.dispatchEvent(pinch);
  expect(pinch.defaultPrevented).toBe(true);
  expect(ui.transform()).toBe('translate(-11px, 88px) scale(0.88)');
  canvasEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, metaKey: true, cancelable: true }));
  ui.press('[data-act="pm-fit"]');
  // Dragging the background moves the map; dragging from a place does not.
  canvasEl.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }));
  expect(ui.transform()).toBe('translate(0px, 100px) scale(0.8)');
  canvasEl.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
  canvasEl.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 30 }));
  expect(ui.transform()).toBe('translate(30px, 120px) scale(0.8)');
  canvasEl.dispatchEvent(new MouseEvent('pointerup'));
  canvasEl.dispatchEvent(new MouseEvent('pointermove', { clientX: 90, clientY: 90 }));
  expect(ui.transform()).toBe('translate(30px, 120px) scale(0.8)');
  ui.card('a.md').dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true }));
  canvasEl.dispatchEvent(new MouseEvent('pointermove', { clientX: 90, clientY: 90 }));
  canvasEl.dispatchEvent(new MouseEvent('pointercancel'));
  expect(ui.transform()).toBe('translate(30px, 120px) scale(0.8)');
  // A neighbourhood that fits is shown at full size.
  world = { width: 800, height: 400 };
  ui.press('[data-act="pm-fit"]');
  expect(ui.transform()).toBe('translate(100px, 100px) scale(1)');
});

it('stacks the lanes when the map is narrow, and lays them out again when it widens; a hidden map waits', () => {
  placed();
  canvas = { width: 1000, height: 600 };
  world = { width: 800, height: 400 };
  const ui = mount({ model: graph(neighbours, before) });
  expect(ui.all('.mr-pm-edge')).toHaveLength(9);
  canvas = { width: 0, height: 0 };
  for (const callback of resized) callback();
  expect(ui.map.element.classList).not.toContain('is-stacked');
  // The sheet narrowed it: one column, read top to bottom, with no lines, camera or drag.
  canvas = { width: 600, height: 600 };
  for (const callback of resized) callback();
  expect(ui.map.element.classList).toContain('is-stacked');
  expect(ui.all('.mr-pm-lines')).toHaveLength(0);
  expect(ui.transform()).toBe('');
  const canvasEl = ui.q('.mr-pm-canvas');
  const wheel = new WheelEvent('wheel', { deltaY: 20, cancelable: true });
  canvasEl.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(false);
  canvasEl.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
  canvasEl.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 30 }));
  expect(ui.transform()).toBe('');
  expect(ui.key(canvasEl, 'ArrowLeft')).toBe(false);
  ui.press('[data-act="pm-fit"]');
  expect(ui.transform()).toBe('');
  canvas = { width: 1000, height: 600 };
  for (const callback of resized) callback();
  expect(ui.map.element.classList).not.toContain('is-stacked');
  expect(ui.all('.mr-pm-edge')).toHaveLength(9);
  // Closing the reader stops watching.
  ui.map.destroy();
  expect(disconnect).toHaveBeenCalled();
});

it('on a phone, keeps four neighbours a side and opens details as a modal bottom sheet', async () => {
  Object.defineProperty(media, 'matches', { value: true, configurable: true });
  const many = Array.from({ length: 6 }, (_, at) => place(`in${at}.md`));
  const ui = mount({
    model: graph(
      [...many, place('f.md')],
      many.map((p) => link(p.id, 'f.md')),
    ),
  });
  expect(ui.map.element.classList).toContain('is-stacked');
  expect(ui.all('.mr-pm-place[data-lane="incoming"]')).toHaveLength(4);
  expect(ui.q('[data-lane="incoming"] .mr-pm-more').textContent).toBe('Show 2 more in List');
  ui.press('.mr-pm-place[data-id="in0.md"]');
  const sheet = ui.q('.mr-pm-sheet');
  expect(sheet.getAttribute('role')).toBe('dialog');
  expect(sheet.getAttribute('aria-modal')).toBe('true');
  expect(ui.map.element.inert).toBe(true);
  expect(ui.map.tools.inert).toBe(true);
  expect(ui.sheet.backdrop.hidden).toBe(false);
  expect(document.activeElement).toBe(ui.sheet.close);
  ui.sheet.backdrop.click();
  expect(sheet.hidden).toBe(true);
  expect(sheet.hasAttribute('aria-modal')).toBe(false);
  expect(ui.map.element.inert).toBe(false);
  expect(document.activeElement).toBe(ui.card('in0.md'));
  // Turning the phone into a wider window draws the full neighbourhood again.
  Object.defineProperty(media, 'matches', { value: false, configurable: true });
  media.dispatchEvent(new Event('change'));
  expect(ui.all('.mr-pm-place[data-lane="incoming"]')).toHaveLength(6);
  ui.map.destroy();
  media.dispatchEvent(new Event('change'));
});

it('List shows every document by folder, a hundred at a time, or only those connected to the middle', () => {
  const folder = Array.from({ length: 120 }, (_, at) => place(`docs/p${String(at).padStart(3, '0')}.md`));
  const ui = mount({
    model: graph(
      [place('README.md', { state: 'not-read' }), place('f.md'), ...folder],
      // Links that do not touch the middle stay out of its neighbourhood in List.
      [link('f.md', 'README.md'), link('docs/p000.md', 'docs/p001.md'), ...folder.slice(0, 110).map((p) => link(p.id, 'f.md'))],
    ),
  });
  ui.press('[data-act="pm-view-list"]');
  expect(ui.map.element.classList).toContain('is-list');
  expect(ui.q('.mr-pm-canvas').hidden).toBe(true);
  expect(ui.all('.mr-pm-folder').map((heading) => heading.textContent)).toStrictEqual(['Top folder2 documents', 'docs/98 documents']);
  expect(ui.card('README.md').querySelector('.mr-pm-path')!.textContent).toBe('README.md · Not read yet');
  expect(ui.card('f.md').querySelector('.mr-pm-counts')!.textContent).toBe('110 linked from · 1 links to');
  ui.press('[data-act="pm-list-more"]');
  expect(ui.all('.mr-pm-list .mr-pm-place')).toHaveLength(122);
  expect(ui.all('.mr-pm-list .mr-pm-more')).toHaveLength(0);
  // Show more in List keeps to the neighbourhood.
  ui.press('[data-act="pm-view-map"]');
  expect(ui.q('[data-lane="incoming"] .mr-pm-more').textContent).toBe('Show 102 more in List');
  ui.press('[data-lane="incoming"] .mr-pm-more');
  expect(ui.q('.mr-pm-filter').textContent).toBe('111 documents connected to f');
  expect(ui.all('.mr-pm-list .mr-pm-place')).toHaveLength(100);
  ui.press('[data-act="pm-clear-near"]');
  expect(ui.all('.mr-pm-list .mr-pm-place')).toHaveLength(100);
  expect(document.activeElement).toBe(ui.all('.mr-pm-list .mr-pm-place')[0]);
});

it('the sheet previews a document once and keeps it, says when it cannot, and drops a preview that arrives too late', async () => {
  const slow: Array<(value: HTMLElement | null) => void> = [];
  const preview = vi.fn((path: string) =>
    path === 'c.md'
      ? new Promise<HTMLElement | null>((resolve) => slow.push(resolve))
      : Promise.resolve(path === 'd.md' ? null : Object.assign(document.createElement('div'), { textContent: `Preview of ${path}` })),
  );
  const ui = mount({ model: graph(neighbours, before) }, { preview });
  ui.press('.mr-pm-place[data-id="a.md"]');
  expect(ui.q('.mr-pm-sheet .mr-sheet-body').textContent).toBe('Opening the document…');
  await vi.waitFor(() => expect(ui.q('.mr-pm-sheet .mr-sheet-body').textContent).toBe('Preview of a.md'));
  ui.press('.mr-pm-tab[data-tab="links"]');
  ui.press('.mr-pm-tab[data-tab="preview"]');
  expect(ui.q('.mr-pm-sheet .mr-sheet-body').textContent).toBe('Preview of a.md');
  expect(preview).toHaveBeenCalledTimes(1);
  ui.press('.mr-pm-place[data-id="d.md"]');
  await vi.waitFor(() => expect(ui.q('.mr-pm-sheet .mr-sheet-body').textContent).toBe('This document cannot be shown here. Read it to see why.'));
  ui.press('.mr-pm-place[data-id="c.md"]');
  ui.press('.mr-pm-tab[data-tab="links"]');
  slow[0](Object.assign(document.createElement('div'), { textContent: 'Late' }));
  await Promise.resolve();
  expect(ui.q('.mr-pm-sheet .mr-sheet-body').textContent).not.toContain('Late');
  // A preview after the map is gone is dropped too.
  ui.press('.mr-pm-tab[data-tab="preview"]');
  ui.map.destroy();
  slow[1](null);
  await Promise.resolve();
  expect(ui.q('.mr-pm-sheet .mr-sheet-body').textContent).toBe('Opening the document…');
});

it('Links say how a place connects to the middle, list every link a page at a time, and open each one as evidence', () => {
  const others = Array.from({ length: 14 }, (_, at) => place(`n${String(at).padStart(2, '0')}.md`));
  const details = vi.fn((path: string) => (path === 'a.md' ? [Object.assign(document.createElement('p'), { textContent: 'Decision' })] : []));
  const problems = vi.fn((path: string) =>
    path === 'a.md' ? Object.assign(document.createElement('section'), { textContent: 'Links the map cannot follow' }) : null,
  );
  const ui = mount(
    { model: graph([...neighbours, ...others], [link('a.md', 'f.md', 3, 2), link('f.md', 'a.md'), ...others.map((p) => link('a.md', p.id))]) },
    { details, problems },
  );
  ui.press('.mr-pm-place[data-id="a.md"]');
  ui.press('.mr-pm-tab[data-tab="links"]');
  expect(document.activeElement).toBe(ui.q('.mr-pm-tab[data-tab="links"]'));
  expect(ui.q('.mr-pm-sheet').getAttribute('aria-label')).toBe('Selected document');
  const why = ui.q('.mr-pm-why');
  expect(why.querySelector('h3')!.textContent).toBe('How it connects to f');
  expect([...why.querySelectorAll('.mr-pm-why-direction')].map((p) => p.textContent)).toStrictEqual(['This links to f', 'f links here']);
  expect([...why.querySelectorAll('blockquote')].map((quote) => quote.textContent)).toStrictEqual([
    'A link without text',
    'more about f.md',
    'A link without text',
  ]);
  expect(why.querySelector('.mr-pm-path')!.textContent).toBe('a.md · Document · line 3 · c0ffee1');
  expect(why.querySelector<HTMLElement>('[data-act="evidence"]')!.dataset).toMatchObject({ path: 'a.md', line: '3' });
  expect(why.querySelector('[data-act="pm-connection"]')!.textContent).toBe('See all 5 links');
  expect(ui.all('.mr-pm-connection')).toHaveLength(12);
  expect(ui.q('.mr-pm-connection').getAttribute('aria-label')).toBe('Link evidence: f links to a');
  ui.press('[data-act="pm-connections-more"]');
  expect(ui.all('.mr-pm-connection')).toHaveLength(16);
  expect(ui.q('.mr-pm-about').textContent).toBe('Type and statusDecision');
  expect(ui.q('.mr-pm-sheet .mr-sheet-body').textContent).toContain('Links the map cannot follow');
  // All the evidence for one connection, and back.
  ui.press('.mr-pm-why [data-act="pm-connection"]');
  expect(ui.q('.mr-pm-sheet').getAttribute('aria-label')).toBe('Link evidence');
  expect(ui.q('.mr-pm-sheet .mr-sheet-header').textContent).toBe('Back to documentClose detailsDocumented · links toLink evidencea → f');
  expect(ui.all('.mr-pm-sheet .mr-pm-proof')).toHaveLength(3);
  expect(ui.q('.mr-pm-sheet .mr-sheet-body > .mr-pm-note').textContent).toBe('2 more links not listed here.');
  expect(document.activeElement).toBe(ui.q('.mr-pm-sheet [data-act="evidence"]'));
  ui.press('[data-act="pm-details"]');
  expect(ui.q('.mr-pm-tab[data-tab="links"]').getAttribute('aria-selected')).toBe('true');
  // A line chosen before any place opens its evidence for the place it starts from.
  const fresh = mount({ model: graph(neighbours, before) });
  fresh.map.onAct(fresh.q('.mr-pm-hit'));
  expect(fresh.q('.mr-pm-sheet .mr-sheet-description').textContent).toBe('f → a');
  expect(fresh.card('f.md').getAttribute('aria-pressed')).toBe('true');
});

it('keys move between the sheet’s tabs; links in a preview preview their target in place', async () => {
  const ui = mount({ model: graph(neighbours, before) });
  ui.press('.mr-pm-place[data-id="a.md"]');
  expect(ui.key(ui.q('.mr-pm-tab[data-tab="preview"]'), 'ArrowRight')).toBe(true);
  expect(ui.q('.mr-pm-tab[data-tab="links"]').getAttribute('aria-selected')).toBe('true');
  expect(ui.key(ui.q('.mr-pm-tab[data-tab="links"]'), 'ArrowLeft')).toBe(true);
  expect(document.activeElement).toBe(ui.q('.mr-pm-tab[data-tab="preview"]'));
  expect(ui.key(ui.q('.mr-pm-tab[data-tab="preview"]'), 'Enter')).toBe(false);
  const to = (target: string) => {
    const a = document.createElement('a');
    a.dataset.mrPath = target;
    return a;
  };
  const click = new MouseEvent('click', { cancelable: true });
  expect(ui.map.previewLink(to('b.md#part'), click)).toBe(true);
  expect(click.defaultPrevented).toBe(true);
  expect(ui.q('.mr-pm-sheet .mr-sheet-title').textContent).toBe('b');
  expect(ui.map.previewLink(to('b.md?plain=1'), new MouseEvent('click', { metaKey: true }))).toBe(false);
  expect(ui.map.previewLink(to('src/main.ts'), new MouseEvent('click'))).toBe(false);
  expect(ui.map.previewLink(to('d.md?plain=1'), new MouseEvent('click', { cancelable: true }))).toBe(true);
  expect(ui.q('.mr-pm-sheet .mr-sheet-title').textContent).toBe('d');
});

it('Escape closes the sheet only while the map is shown; the sheet keeps the reader’s place when the index redraws', () => {
  const ui = mount({ model: graph(neighbours, before), here: 'b.md', changed: new Set(['b.md']) });
  expect(ui.map.closeSheet()).toBe(false);
  ui.press('.mr-pm-place[data-id="b.md"]');
  expect(ui.q('.mr-pm-sheet .mr-sheet-lead').textContent).toBe('DocumentChanged in this reviewYou are here');
  expect(ui.card('b.md').textContent).toBe('DocumentbTop folderChanged in this reviewYou are here');
  // Drawing again, as indexing does, keeps focus on the same control, and the reader's place in the sheet.
  ui.sheet.close.focus();
  ui.sheet.body.scrollTop = 120;
  ui.map.draw({ ...ui.state });
  expect(document.activeElement).toBe(ui.sheet.close);
  expect(ui.sheet.body.scrollTop).toBe(120);
  ui.q('.mr-pm-sheet [data-act="pm-focus"]').focus();
  ui.map.draw({ ...ui.state });
  expect(document.activeElement).toBe(ui.q('.mr-pm-sheet [data-act="pm-focus"]'));
  ui.card('a.md').focus();
  ui.map.draw({ ...ui.state });
  expect(document.activeElement).toBe(ui.card('a.md'));
  ui.q('.mr-pm-canvas').focus();
  ui.map.draw({ ...ui.state });
  expect(document.activeElement).toBe(ui.q('.mr-pm-canvas'));
  ui.q('.mr-pm-more, [data-act="pm-zoom-in"]').focus();
  ui.map.draw({ ...ui.state, model: graph(neighbours, before.slice(0, 2)) });
  ui.map.draw({ ...ui.state });
  // Put away, hidden or taken out of the page, the map's sheet goes with it and leaves Escape to the library;
  // drawn again where it shows, the sheet comes back as it was.
  ui.map.park();
  expect(ui.sheet.isOpen).toBe(false);
  expect(ui.map.closeSheet()).toBe(false);
  const parent = ui.map.element.parentElement!;
  const hidden = document.createElement('section');
  hidden.hidden = true;
  hidden.append(ui.map.element);
  document.body.append(hidden);
  ui.map.draw({ ...ui.state });
  expect(ui.sheet.isOpen).toBe(false);
  ui.map.element.remove();
  ui.map.draw({ ...ui.state });
  expect(ui.sheet.isOpen).toBe(false);
  parent.prepend(ui.map.element);
  ui.map.draw({ ...ui.state });
  expect(ui.q('.mr-pm-sheet .mr-sheet-title').textContent).toBe('b');
  expect(ui.map.closeSheet()).toBe(true);
  expect(document.activeElement).toBe(ui.card('b.md'));
});

it('Show its connections and Back to my place move the middle on purpose, and the library remembers it', () => {
  const ui = mount({ model: graph(neighbours, before), here: 'zz.md' });
  expect(ui.q<HTMLButtonElement>('[data-act="pm-home"]').disabled).toBe(true);
  const away = mount({ model: graph(neighbours, before) });
  expect(away.q<HTMLButtonElement>('[data-act="pm-home"]').disabled).toBe(true);
  const reading = mount({ model: graph(neighbours, before), here: 'd.md' });
  reading.press('.mr-pm-place[data-id="a.md"]');
  reading.press('.mr-pm-sheet [data-act="pm-focus"]');
  expect(reading.host.refocus).toHaveBeenLastCalledWith('a.md');
  expect(reading.q('.mr-pm-place[data-lane="here"]').dataset.id).toBe('a.md');
  reading.press('[data-act="pm-home"]');
  expect(reading.host.refocus).toHaveBeenLastCalledWith('d.md');
  expect(reading.q('.mr-pm-place[data-lane="here"]').dataset.id).toBe('d.md');
  expect(reading.q('.mr-pm-sheet .mr-sheet-title').textContent).toBe('d');
  reading.map.focusCentre();
  expect(document.activeElement).toBe(reading.card('d.md'));
  // Other actions are the library's.
  const other = document.createElement('button');
  other.dataset.act = 'pm-unknown';
  reading.map.onAct(other);
});

it('an empty lane says why: nothing links here yet, the links go both ways, or the middle was not read', () => {
  const lone = mount({ model: graph([place('f.md')], []) });
  expect(lone.all('.mr-pm-empty').map((p) => p.textContent)).toStrictEqual(['No document read so far links here.', 'It links to no other listed document.']);
  const unread = mount({ model: graph([place('f.md', { state: 'not-read' })], []) });
  expect(unread.all('.mr-pm-empty')[1].textContent).toBe('Not read yet: its links are not shown.');
  expect(unread.card('f.md').textContent).toBe('DocumentfNot read yet');
  const failed = mount({ model: graph([place('f.md', { state: 'failed', kind: 'Decision', title: 'ADR 9: Keep it' })], []) });
  expect(failed.all('.mr-pm-empty')[1].textContent).toBe('Its links could not be read.');
  expect(failed.card('f.md').textContent).toBe('ADR 9Keep itCould not be read');
  failed.press('.mr-pm-place[data-id="f.md"]');
  expect(failed.q<HTMLButtonElement>('.mr-pm-tab[data-tab="preview"]').disabled).toBe(true);
  expect(failed.q('.mr-pm-link-group[aria-label="Links to"]').textContent).toBe('Links to0No links to other listed documents.');
  const large = mount({ model: graph([place('f.md', { state: 'too-large' })], []) });
  expect(large.card('f.md').textContent).toBe('DocumentfToo large to read');
  // Drawn before the documents that link to it were read, they stay on the right.
  const both = mount({ model: graph([place('a.md'), place('f.md')], [link('f.md', 'a.md')]) });
  both.map.draw({ ...both.state, model: graph([place('a.md'), place('f.md')], [link('f.md', 'a.md'), link('a.md', 'f.md')]) });
  expect(both.all('.mr-pm-empty').map((p) => p.textContent)).toStrictEqual(['Every document that links here is also one it links to.']);
  const left = mount({ model: graph([place('a.md'), place('f.md')], [link('a.md', 'f.md'), link('f.md', 'a.md')]) });
  expect(left.all('.mr-pm-empty').map((p) => p.textContent)).toStrictEqual(['Every document it links to also links here.']);
});

it('a line across the map bends above the middle when the places it joins sit higher than the middle', () => {
  boxes = {
    'e.md': [0, 130, 200, 60],
    'f.md': [300, 200, 240, 80],
    'g.md': [640, 170, 200, 60],
  };
  const ui = mount({ model: graph([place('e.md'), place('f.md'), place('g.md')], [link('e.md', 'f.md'), link('f.md', 'g.md'), link('e.md', 'g.md')]) });
  const across = ui.all('.mr-pm-edge').find((edge) => edge.dataset.from === 'e.md' && edge.dataset.to === 'g.md')!;
  expect(across.querySelector('.mr-pm-line')!.getAttribute('d')).toContain('L 540 150');
});

/** A review: two documents in its first chapter and two files in its second, what links to them, and where they lead. */
const file = (id: string) =>
  place(id, { title: id.replace(/^.*\//, ''), kind: 'File', kindFrom: 'none', sourceKind: 'File', sourceKindFrom: 'none', state: 'file' });
const reviewPlaces = [
  place('in/a.md'),
  place('in/b.md'),
  place('mid/rfc.md'),
  place('mid/adr.md'),
  file('src/code.ts'),
  file('src/quiet.ts'),
  place('out/x.md'),
];
const reviewLinks = [
  link('in/a.md', 'mid/rfc.md'),
  link('mid/rfc.md', 'in/a.md'),
  link('in/b.md', 'src/code.ts'),
  link('mid/rfc.md', 'mid/adr.md'),
  link('mid/rfc.md', 'out/x.md'),
  link('mid/adr.md', 'in/b.md'),
  link('in/a.md', 'in/b.md'),
  link('in/a.md', 'out/x.md'),
];
const thisReview = {
  chapters: [
    { title: 'Docs', paths: ['mid/rfc.md', 'mid/adr.md'] },
    { title: 'Empty', paths: [] },
    { title: 'Code', paths: ['src/code.ts', 'src/quiet.ts'], attachments: [{ path: 'in/a.md', heading: 'why', title: 'a — Why', commit: 'abc1234def' }] },
  ],
  declares: { 'src/code.ts': ['web'], 'src/quiet.ts': [] },
};
const reviewed = (model = graph(reviewPlaces, reviewLinks)) =>
  mount({ model, focus: '', changed: new Set(['mid/rfc.md', 'mid/adr.md']), review: thisReview }, { explore: vi.fn() });

it('around a review: its files in the middle, chapter by chapter, between what links to them and what they link to', () => {
  boxes = {
    'in/a.md': [0, 40, 200, 60],
    'in/b.md': [0, 140, 200, 60],
    'mid/rfc.md': [300, 40, 240, 60],
    'mid/adr.md': [300, 140, 240, 60],
    'src/code.ts': [300, 240, 240, 60],
    'out/x.md': [640, 40, 200, 60],
  };
  const ui = reviewed();
  expect(ui.map.element.classList).toContain('is-review');
  expect(ui.all('.mr-pm-lane-head').map((head) => head.textContent)).toStrictEqual(['Linked from2', 'In this review4', 'Links to1']);
  // Each chapter's files under its name; one nothing read links to or from is a quiet chip, with no line.
  expect(ui.all('.mr-pm-lane[data-lane="here"] :is(.mr-pm-group-head, .mr-pm-place)').map((el) => el.dataset.id ?? el.textContent)).toStrictEqual([
    'Docs',
    'mid/rfc.md',
    'mid/adr.md',
    'Code',
    'src/code.ts',
    'src/quiet.ts',
  ]);
  const quiet = ui.card('src/quiet.ts');
  expect([quiet.classList.contains('is-chip'), quiet.getAttribute('aria-label'), quiet.textContent]).toStrictEqual([
    true,
    'quiet.ts, File, src/quiet.ts, no links so far',
    'quiet.ts',
  ]);
  // Everything in the middle is changed, which its heading says: no card repeats it; and there is no one place to come back to.
  expect(ui.all('.mr-pm-place .mr-chip')).toHaveLength(0);
  expect(ui.card('mid/rfc.md').classList).toContain('is-centre');
  expect(ui.card('mid/rfc.md').classList).not.toContain('is-focus');
  expect(ui.q('[data-act="pm-home"]').hidden).toBe(true);
  // Lines run in to the middle and out of it; two of the middle connect on its right; a line between two neighbours is
  // context, and one across the middle is left to the sheet.
  const edges = ui.all('.mr-pm-edge');
  expect(
    edges.map((edge) => [`${edge.dataset.from} ${edge.dataset.to}`, edge.getAttribute('class'), edge.querySelectorAll('.mr-pm-arrow').length]),
  ).toStrictEqual([
    ['in/a.md mid/rfc.md', 'mr-pm-edge is-focus', 2],
    ['in/b.md src/code.ts', 'mr-pm-edge is-focus', 1],
    ['mid/rfc.md mid/adr.md', 'mr-pm-edge is-focus', 1],
    ['mid/rfc.md out/x.md', 'mr-pm-edge is-focus', 1],
    ['mid/adr.md in/b.md', 'mr-pm-edge is-focus', 1],
    ['in/a.md in/b.md', 'mr-pm-edge is-context', 1],
  ]);
  const line = (at: number) => edges[at].querySelector('.mr-pm-line')!.getAttribute('d');
  expect(line(0)).toBe('M 200 70 C 250 70, 250 70, 300 70');
  expect(line(2)).toBe('M 540 70 C 588 70, 588 170, 540 170');
  expect(line(3)).toBe('M 540 70 C 590 70, 590 70, 640 70');
  // A link from the middle back to a neighbour that links in arrives at the neighbour.
  expect(line(4)).toBe('M 200 170 C 250 170, 250 170, 300 170');
  expect(edges[4].querySelector('.mr-pm-arrow')!.getAttribute('d')).toBe('M 207 166 L 200 170 L 207 174');
  expect(line(5)).toBe('M 0 70 C -48 70, -48 170, 0 170');
  // Choosing a file of the review lights its lines.
  ui.press('.mr-pm-place[data-id="mid/rfc.md"]');
  expect(ui.all('.mr-pm-edge.is-lit').map((edge) => `${edge.dataset.from} ${edge.dataset.to}`)).toStrictEqual([
    'in/a.md mid/rfc.md',
    'mid/rfc.md mid/adr.md',
    'mid/rfc.md out/x.md',
  ]);
});

it('a review’s sheet says how a document connects to it; a file has nothing to read; Show its connections opens the Documents map', async () => {
  const ui = reviewed();
  const actions = () => ui.all('.mr-pm-sheet .mr-sheet-actions [data-act]').map((el) => el.dataset.act);
  ui.press('.mr-pm-place[data-id="in/a.md"]');
  expect(actions()).toStrictEqual(['pm-focus', 'open']);
  ui.press('.mr-pm-sheet [data-tab="links"]');
  const why = ui.q('.mr-pm-sheet .mr-pm-why');
  expect([why.querySelector('h3')!.textContent, ...[...why.querySelectorAll('.mr-pm-why-direction')].map((p) => p.textContent)]).toStrictEqual([
    'How it connects to this review',
    'This links to rfc',
    'rfc links here',
  ]);
  ui.press('.mr-pm-sheet [data-act="pm-focus"]');
  expect(ui.host.explore).toHaveBeenCalledWith('in/a.md');
  // A changed file: no Read, no connections of its own, opened at its links, saying what it declares.
  ui.press('.mr-pm-place[data-id="src/code.ts"]');
  expect(actions()).toStrictEqual([]);
  expect(ui.q<HTMLButtonElement>('.mr-pm-sheet [data-tab="preview"]').disabled).toBe(true);
  expect(ui.all('.mr-pm-sheet .mr-sheet-body > .mr-pm-note').map((note) => note.textContent)).toStrictEqual([
    'A file, not a document: only the documents that link to it are shown.',
    'Declares web.',
  ]);
  ui.press('.mr-pm-place[data-id="src/quiet.ts"]');
  expect(ui.all('.mr-pm-sheet .mr-sheet-body > .mr-pm-note').map((note) => note.textContent)).toStrictEqual([
    'A file, not a document: only the documents that link to it are shown.',
  ]);
  // A document of the review is the middle itself: its links are all there is to say.
  ui.press('.mr-pm-place[data-id="mid/rfc.md"]');
  expect(actions()).toStrictEqual(['pm-focus', 'open']);
  ui.press('.mr-pm-sheet [data-tab="links"]');
  expect(ui.q('.mr-pm-sheet .mr-pm-why')).toBe(null);
});

it('a review as List: what links in, each chapter’s files with what the reader added, then what they link to', () => {
  const ui = reviewed();
  ui.press('[data-act="pm-view-list"]');
  const groups = ui
    .all('.mr-pm-list .mr-pm-group')
    .map((group) => [
      group.querySelector('.mr-pm-folder')!.textContent,
      ...[...group.querySelectorAll<HTMLElement>('.mr-pm-place')].map((row) => row.dataset.id ?? row.textContent),
    ]);
  expect(groups).toStrictEqual([
    ['Linked from2 documents', 'in/a.md', 'in/b.md'],
    ['Docs2 files', 'mid/rfc.md', 'mid/adr.md'],
    ['Empty0 files'],
    ['Code2 files', 'src/code.ts', 'src/quiet.ts', 'a — WhyAdded by you · abc1234'],
    ['Links to1 document', 'out/x.md'],
  ]);
  // A file's row has its path and the links to it; a document's both ways.
  const row = (id: string) => [...ui.card(id).querySelectorAll('.mr-pm-path, .mr-pm-counts')].map((el) => el.textContent);
  expect(row('src/code.ts')).toStrictEqual(['src/code.ts', '1 linked from']);
  expect(row('mid/rfc.md')).toStrictEqual(['mid/rfc.md', '1 linked from · 3 links to']);
  const added = ui.q('.mr-pm-attachment');
  expect([added.dataset.act, added.dataset.path, added.dataset.anchor]).toStrictEqual(['open', 'in/a.md', 'why']);
  expect(ui.q('.mr-pm-list .mr-pm-note').textContent).toBe('Galley says what is worth checking; it never says a document is wrong.');
});

it('around a review a phone keeps short lanes and a shorter middle, counting the rest for List; empty sides say so', () => {
  Object.defineProperty(media, 'matches', { value: true, configurable: true });
  const many = Array.from({ length: 13 }, (_, at) => file(`src/f${String(at).padStart(2, '0')}.ts`));
  const into = Array.from({ length: 5 }, (_, at) => place(`docs/d${at}.md`));
  const ui = mount(
    {
      model: graph(
        [...many, ...into],
        into.map((doc) => link(doc.id, many[0].id)),
      ),
      focus: '',
      changed: new Set(),
      review: { chapters: [{ title: 'Code', paths: many.map((place) => place.id) }] },
    },
    { explore: vi.fn() },
  );
  expect(ui.all('.mr-pm-lane[data-lane="here"] .mr-pm-place')).toHaveLength(12);
  expect(ui.all('.mr-pm-more').map((more) => more.textContent)).toStrictEqual(['Show 1 more in List', 'Show 1 more in List']);
  expect(ui.q('.mr-pm-lane[data-lane="outgoing"] .mr-pm-empty').textContent).toBe('What this review changes links to no other listed document.');
  // Show more opens List whole, not filtered to one document.
  ui.press('.mr-pm-lane[data-lane="incoming"] .mr-pm-more');
  expect(ui.q('.mr-pm-filter')).toBe(null);
  expect(ui.all('.mr-pm-list .mr-pm-place')).toHaveLength(18);
  // Nothing links in at all.
  const alone = mount({
    model: graph(many, []),
    focus: '',
    changed: new Set(),
    review: { chapters: [{ title: 'Code', paths: many.map((place) => place.id) }] },
  });
  expect(alone.q('.mr-pm-lane[data-lane="incoming"] .mr-pm-empty').textContent).toBe('No document read so far links to what this review changes.');
  alone.press('[data-act="pm-view-list"]');
  expect(alone.all('.mr-pm-list .mr-pm-folder').map((head) => head.textContent)).toStrictEqual(['Code13 files']);
});
