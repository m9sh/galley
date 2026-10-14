import { indexDocument, ProjectIndex } from '../src/core/docindex.ts';
import { documentMap } from '../src/core/project-map.ts';
import type { RepositorySource } from '../src/platforms/types.ts';
import { button, h, glyph, markup } from '../src/ui/components/dom.ts';
import { loadReaderFonts } from '../src/ui/components/fonts.ts';
import { icons } from '../src/ui/components/icons.ts';
import { keyGroups, READING_SECTIONS, settingsSheet } from '../src/ui/components/settings-sheet.ts';
import readerCss from '../src/ui/components/reader-styles.ts';
import { DEFAULT_SETTINGS, loadSettings } from '../src/ui/preferences/settings.ts';
import css from './project-map-styles.ts';
import { DENSITY_SECTION, SHAPES, ZOOM, iconButton, lineIcon } from './project-map-shared.ts';
import { PrototypeDetail } from './project-map-detail.ts';

/** Try the real document index and safe renderer, without introducing a second provider or storage model. */
export async function openMapPrototype(source: RepositorySource, fixture = 'small'): Promise<void> {
  document.querySelector('#galley-map-prototype')?.dispatchEvent(new Event('close-prototype'));
  const host = h('div');
  host.id = 'galley-map-prototype';
  const shadow = host.attachShadow({ mode: 'open' });
  const styles = h('style', '', readerCss + css);
  const root = h('div', 'mr-root mr-atlas mode-clean no-top-glow is-waiting');
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Project map prototype');

  // One bar: where you are on the left, finding in the middle, how to look on the right.
  const top = h('header', 'mr-topbar mr-atlas-chrome');
  const left = h('div', 'mr-tb-left');
  // Reading a document puts the way back where the reader looks for it: first in the bar, beside where they are.
  const back = button('Back to map', 'return', 'mr-btn mr-atlas-back');
  back.title = 'Back to map (Esc)';
  back.hidden = true;
  back.prepend(glyph(icons.chevronLeft));
  const reading = h('span', 'mr-atlas-reading');
  reading.hidden = true;
  left.append(
    iconButton('close', 'Close prototype', 'Close prototype (Esc)', icons.close),
    back,
    h('span', 'mr-brand', 'galley'),
    h('span', 'mr-atlas-crumb', '/'),
    h('h1', 'mr-atlas-title', source.name),
    reading,
  );
  const center = h('div', 'mr-tb-center');
  // A combobox: results appear in a popup under the field and never replace the Map.
  const find = h('div', 'mr-atlas-search');
  const search = h('input');
  search.type = 'search';
  search.placeholder = 'Find a document…';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.setAttribute('role', 'combobox');
  search.setAttribute('aria-label', 'Find a document');
  search.setAttribute('aria-keyshortcuts', '/');
  search.setAttribute('aria-autocomplete', 'list');
  search.setAttribute('aria-expanded', 'false');
  search.setAttribute('aria-controls', 'mr-atlas-results-list');
  const slash = h('kbd', '', '/');
  slash.setAttribute('aria-hidden', 'true');
  const results = h('div', 'mr-atlas-results');
  results.hidden = true;
  const options = h('div', 'mr-atlas-results-list');
  options.id = 'mr-atlas-results-list';
  options.setAttribute('role', 'listbox');
  options.setAttribute('aria-label', 'Documents');
  const empty = h('p', 'mr-atlas-results-empty');
  empty.setAttribute('role', 'status');
  results.append(options, empty);
  find.append(lineIcon(SHAPES.search), search, slash, results);
  center.append(find);
  const right = h('div', 'mr-tb-right');
  const choices = h('div', 'mr-seg mr-atlas-choices');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', 'Map presentation');
  for (const [action, label, title] of [
    ['map', 'Map', 'Places and the links between them'],
    ['list', 'List', 'Every document, by folder'],
  ]) {
    const choice = button('', action, '');
    choice.title = title;
    if (action === 'map') {
      const icon = h('span', 'mr-atlas-choice-icon');
      icon.replaceChildren(glyph(icons.map));
      choice.append(icon);
    } else choice.append(lineIcon(SHAPES.list));
    choice.append(h('span', '', label));
    choices.append(choice);
  }
  const details = iconButton('details', 'Details', 'Details', lineIcon(SHAPES.panel));
  details.setAttribute('aria-expanded', 'false');
  details.setAttribute('aria-controls', 'mr-atlas-detail');
  const settingsButton = iconButton('settings', 'Reading settings', 'Reading settings (,)', icons.settings);
  settingsButton.setAttribute('aria-haspopup', 'dialog');
  settingsButton.setAttribute('aria-expanded', 'false');
  right.append(choices, details, settingsButton);
  top.append(left, center, right);

  const mapView = h('section', 'mr-atlas-map-view');
  mapView.setAttribute('aria-label', 'Places and connections');
  const canvas = h('div', 'mr-atlas-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Map canvas: arrow keys pan, plus and minus zoom, zero fits the map');
  canvas.append(h('div', 'mr-atlas-world'));
  const controls = h('div', 'mr-atlas-controls');
  const zoom = h('div', 'mr-atlas-zoom');
  zoom.setAttribute('role', 'group');
  zoom.setAttribute('aria-label', 'Zoom');
  zoom.append(
    iconButton('zoom-out', 'Zoom out', 'Zoom out (−)', icons.minus),
    iconButton('zoom-in', 'Zoom in', 'Zoom in (+)', icons.plus),
    iconButton('fit', 'Fit map', 'Fit map (0)', lineIcon(SHAPES.fit)),
  );
  const home = button('Back to my place', 'home', 'mr-btn mr-atlas-home');
  home.prepend(lineIcon(SHAPES.locate));
  controls.append(zoom, home);
  const status = h('p', 'mr-atlas-status', 'Reading the demo documents…');
  status.setAttribute('role', 'status');
  const info = h('div', 'mr-atlas-info');
  info.append(status, h('p', 'mr-atlas-footer', 'Prototype · #68 · Lines are links written in the documents. Select one to see its source.'));
  const list = h('div', 'mr-atlas-list');
  list.hidden = true;
  mapView.append(canvas, controls, info, list);
  const article = h('article', 'mr-atlas-article');
  article.hidden = true;
  const backdrop = button('Close details', 'close-details', 'mr-atlas-backdrop');
  backdrop.hidden = true;
  // A push sheet: on wider screens it takes a column beside the Map instead of covering it.
  const detail = h('aside', 'mr-atlas-detail');
  detail.id = 'mr-atlas-detail';
  detail.setAttribute('aria-label', 'Selected document');
  const shell = h('div', 'mr-atlas-shell');
  shell.append(mapView, article, backdrop, detail);
  const sheet = h('div');
  sheet.replaceChildren(
    markup(
      settingsSheet('Your reading preferences. Changes stay with this prototype.', [
        { id: 'reading', label: 'Reading', icon: icons.book, panel: READING_SECTIONS },
        { id: 'layout', label: 'Layout', icon: icons.layout, panel: DENSITY_SECTION },
        {
          id: 'keys',
          label: 'Keys',
          icon: icons.keyboard,
          panel: keyGroups([
            [
              'Map',
              [
                [['/'], 'Find a document'],
                [['↑', '↓', 'Enter'], 'Choose a search result'],
                [['←', '↑', '→', '↓'], 'Pan the focused canvas'],
                [['+', '−'], 'Zoom the focused canvas'],
                [['0'], 'Fit the map to the canvas'],
                [['←', '→'], 'Switch Links and Preview in the details sheet'],
              ],
            ],
            [
              'Settings',
              [
                [[','], 'Open reading settings'],
                [['?'], 'Show shortcuts'],
                [['Esc'], 'Close the innermost panel, then the prototype'],
              ],
            ],
          ]),
        },
      ]),
    ),
  );
  root.append(top, shell, sheet.firstElementChild!);
  shadow.append(styles, root);
  document.body.append(host);
  loadReaderFonts(document);
  root.focus();
  const settings = { ...DEFAULT_SETTINGS, ...(await loadSettings()) };
  let closed = false;
  const closeWaiting = () => {
    closed = true;
    host.remove();
  };
  const closeLoading = (event: MouseEvent) => {
    if ((event.target as Element).closest('[data-act="close"]')) closeWaiting();
  };
  const closeKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeWaiting();
    }
  };
  host.addEventListener('close-prototype', closeWaiting);
  root.addEventListener('keydown', closeKey);
  root.addEventListener('click', closeLoading);
  const texts = new Map<string, string>();
  try {
    const listing = await source.discover();
    const paths = listing.docs.map((doc) => doc.path);
    // Additional fixtures are bundled demo data, never repository discovery or provider reads.
    if (fixture !== 'small') {
      for (let i = 0; i < (fixture === 'dense' ? 300 : 30); i++) {
        const path = `docs/synthetic/${String(i).padStart(3, '0')}.md`;
        paths.push(path);
        texts.set(
          path,
          `# Demo place ${i}\n\n${fixture === 'sparse' ? '' : '[Architecture](../architecture/overview.md)'}\n\n${fixture === 'dense' ? '[Next](000.md)' : ''}`,
        );
      }
    }
    const index = new ProjectIndex(paths);
    await Promise.all(
      listing.docs.map(async (doc) => {
        const text = await source.load(doc.path);
        texts.set(doc.path, text);
        if (fixture !== 'partial' || doc.path === 'README.md' || doc.path === 'docs/architecture/overview.md') index.add(indexDocument(doc.path, text));
      }),
    );
    if (closed) return;
    for (const [path, text] of texts) if (path.startsWith('docs/synthetic/')) index.add(indexDocument(path, text));
    const model = documentMap(index, { docs: new Map(), folders: new Map() });
    host.removeEventListener('close-prototype', closeWaiting);
    root.removeEventListener('keydown', closeKey);
    root.removeEventListener('click', closeLoading);
    root.classList.remove('is-waiting');
    new Prototype(root, model, index, texts, source, settings, host);
  } catch {
    status.textContent = 'The demo documents could not be read. Close the prototype and reopen it to try again.';
  }
}
class Prototype extends PrototypeDetail {
  /** Fit shows the whole neighbourhood: at full size when it fits, otherwise scaled down and centred. */
  protected fit(): void {
    const canvas = this.q('.mr-atlas-canvas');
    const world = this.q('.mr-atlas-world');
    canvas.scrollTop = canvas.scrollLeft = 0;
    if (this.stacked || !world.offsetWidth) this.camera = { x: 0, y: 0, zoom: 1 };
    else {
      const zoom = Math.max(ZOOM.min, Math.min(1, canvas.clientWidth / world.offsetWidth, canvas.clientHeight / world.offsetHeight));
      this.camera = {
        x: Math.round((canvas.clientWidth - world.offsetWidth * zoom) / 2),
        y: Math.round((canvas.clientHeight - world.offsetHeight * zoom) / 2),
        zoom,
      };
    }
    this.moveCamera();
  }

  /** Zoom keeps the point under the pointer (or the canvas centre) still. */
  protected zoomTo(level: number, at?: { x: number; y: number }): void {
    const canvas = this.q('.mr-atlas-canvas');
    const point = at ?? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const zoom = Math.round(Math.min(ZOOM.max, Math.max(ZOOM.min, level)) * 100) / 100;
    this.camera.x = point.x - ((point.x - this.camera.x) * zoom) / this.camera.zoom;
    this.camera.y = point.y - ((point.y - this.camera.y) * zoom) / this.camera.zoom;
    this.camera.zoom = zoom;
    this.moveCamera();
  }

  protected moveCamera(): void {
    this.q('.mr-atlas-world').style.transform = this.stacked ? '' : `translate(${this.camera.x}px, ${this.camera.y}px) scale(${this.camera.zoom})`;
    this.q<HTMLButtonElement>('[data-act="zoom-in"]').disabled = this.camera.zoom >= ZOOM.max;
    this.q<HTMLButtonElement>('[data-act="zoom-out"]').disabled = this.camera.zoom <= ZOOM.min;
  }

  protected refocus(id: string): void {
    this.focus = this.selected = id;
    this.view = 'map';
    this.connection = null;
    this.draw();
    this.fit();
  }
}
