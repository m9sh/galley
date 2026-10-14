import type { MapPlace } from '../src/core/project-map.ts';
import { button, h } from '../src/ui/components/dom.ts';
import { icons } from '../src/ui/components/icons.ts';
import { LIST_RESULTS, RESULT_LIMIT, cardName, highlight, iconButton, matchScore, searchWords, typeIcon } from './project-map-shared.ts';
import { PrototypeDrawing } from './project-map-drawing.ts';

/** The List and the search popup. */
export abstract class PrototypeList extends PrototypeDrawing {
  protected drawList(): void {
    const list = this.q('.mr-atlas-list');
    list.replaceChildren();
    if (this.view !== 'list') return;
    const inner = h('div', 'mr-atlas-list-inner');
    list.append(inner);
    let candidates = this.model.places;
    if (this.near) {
      const near = this.near;
      const ids = new Set(this.model.connections.flatMap((c) => (c.from === near ? [c.to] : c.to === near ? [c.from] : [])));
      ids.delete(near);
      candidates = candidates.filter((place) => ids.has(place.id));
      inner.append(this.filterChip(`${ids.size} documents connected to ${this.title(near)}`, 'clear-near'));
    }
    if (this.listQuery) inner.append(this.filterChip(`Matching “${this.listQuery}”`, 'clear-query'));
    const words = searchWords(this.listQuery);
    const found = candidates.filter((place) => matchScore(place, words) >= 0);
    if (!found.length) inner.append(h('p', 'mr-atlas-note', 'No indexed name or path matches.'));
    if (this.index.docs.size < this.index.listed.length) inner.append(h('p', 'mr-atlas-note', 'Names from unindexed documents may be incomplete.'));
    const folders = new Map<string, MapPlace[]>();
    for (const place of found.slice(0, this.listLimit)) folders.set(place.folder, [...(folders.get(place.folder) ?? []), place]);
    for (const [folder, places] of folders) {
      const section = h('section', 'mr-atlas-list-group');
      section.dataset.folder = folder;
      const heading = h('h2', 'mr-atlas-folder', folder ? `${folder}/` : 'Project root');
      heading.append(h('span', '', `${places.length} shown`));
      const rows = h('div', 'mr-atlas-list-rows');
      for (const place of places) {
        const row = this.placeCard(place);
        row.querySelector('.mr-atlas-card-caption')!.replaceWith(h('small', 'mr-atlas-path', place.path));
        const degree = this.degree.get(place.id)!;
        row.append(h('small', 'mr-atlas-counts', `${degree.incoming} linked from · ${degree.outgoing} links to`));
        rows.append(row);
      }
      section.append(heading, rows);
      inner.append(section);
    }
    if (found.length > this.listLimit)
      inner.append(
        button(`Show ${Math.min(100, found.length - this.listLimit)} more of ${found.length} places`, 'list-more', 'mr-btn mr-outline mr-atlas-more'),
      );
    this.markSelection();
  }

  protected filterChip(label: string, act: string): HTMLElement {
    const filter = h('p', 'mr-atlas-filter');
    const clear = iconButton(act, `Remove filter: ${label}`, 'Remove filter', icons.close);
    filter.append(h('span', '', label), clear);
    return filter;
  }

  /** What choosing a result will do: stay on this map, or move the map to it. */
  protected relation(id: string): string {
    const lane = this.lanes.get(id);
    return lane === 'here' ? 'In focus' : lane ? 'On the map' : id === this.here ? 'You are here' : '';
  }

  /** The popup: suggestions while the field is empty, ranked matches once the reader types. */
  protected drawResults(): void {
    const input = this.q<HTMLInputElement>('.mr-atlas-search input');
    const list = this.q('.mr-atlas-results-list');
    const empty = this.q('.mr-atlas-results-empty');
    const query = input.value.trim();
    list.replaceChildren();
    this.results = [];
    const groups: Array<[string, MapPlace[]]> = [];
    let total = 0;
    if (query) {
      const words = searchWords(query);
      // Places already on the map, and the reader's own place, win ties: choosing them keeps the map still.
      const bonus = (id: string) => (this.lanes.has(id) ? 8 : 0) + (id === this.here ? 4 : 0);
      const ranked = this.model.places
        .map((place) => ({ place, score: matchScore(place, words) }))
        .filter((match) => match.score >= 0)
        .sort((a, b) => b.score + bonus(b.place.id) - a.score - bonus(a.place.id) || a.place.title.localeCompare(b.place.title))
        .map((match) => match.place);
      total = ranked.length;
      groups.push([`${total} ${total === 1 ? 'match' : 'matches'}`, ranked.slice(0, RESULT_LIMIT)]);
    } else {
      const recent = this.recent.slice(0, 4);
      const around = [...this.lanes.keys()].filter((id) => !recent.includes(id)).slice(0, 6);
      groups.push(['Recent', recent.map((id) => this.place(id))], [`Around ${cardName(this.title(this.focus)).name}`, around.map((id) => this.place(id))]);
    }
    for (const [at, [label, places]] of groups.entries()) {
      if (!places.length) continue;
      const group = h('div', 'mr-atlas-results-group');
      const heading = h('div', 'mr-atlas-results-heading', label);
      heading.id = `mr-atlas-results-heading-${at}`;
      group.setAttribute('role', 'group');
      group.setAttribute('aria-labelledby', heading.id);
      group.append(heading);
      for (const place of places) {
        const option = this.resultOption();
        this.results.push(place.id);
        const text = h('span', 'mr-atlas-result-text');
        const title = h('span', 'mr-atlas-result-title');
        title.append(...highlight(place.title, query));
        const path = h('span', 'mr-atlas-result-path');
        path.append(...highlight(place.path, query));
        text.append(title, path);
        option.append(typeIcon(place.kind), text);
        const relation = this.relation(place.id);
        if (relation) option.append(h('span', 'mr-atlas-result-relation', relation));
        group.append(option);
      }
      list.append(group);
    }
    if (total > RESULT_LIMIT) {
      const all = this.resultOption();
      this.results.push(LIST_RESULTS);
      all.classList.add('mr-atlas-result-all');
      all.textContent = `See all ${total} in List`;
      list.append(all);
    }
    empty.textContent = query && !total ? `No document matches “${query}”.` : '';
    if (!this.results.length && !empty.textContent) {
      this.closeResults();
      return;
    }
    this.active = query && this.results.length ? 0 : -1;
    this.markResult();
    this.q('.mr-atlas-results').hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  protected resultOption(): HTMLElement {
    const option = h('div', 'mr-atlas-result');
    option.id = `mr-atlas-result-${this.results.length}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.dataset.act = 'pick';
    option.dataset.index = String(this.results.length);
    return option;
  }

  protected markResult(): void {
    const input = this.q('.mr-atlas-search input');
    for (const option of this.root.querySelectorAll<HTMLElement>('.mr-atlas-result'))
      option.setAttribute('aria-selected', String(option.dataset.index === String(this.active)));
    const current = this.active >= 0 ? this.q(`#mr-atlas-result-${this.active}`) : null;
    if (current) {
      input.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  protected closeResults(): void {
    const input = this.q('.mr-atlas-search input');
    this.q('.mr-atlas-results').hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    this.active = -1;
  }

  protected pick(index: number): void {
    const input = this.q<HTMLInputElement>('.mr-atlas-search input');
    const id = this.results[index];
    const query = input.value.trim();
    this.closeResults();
    input.value = '';
    const reading = !this.q('.mr-atlas-article').hidden;
    if (id === LIST_RESULTS) {
      this.listQuery = query;
      this.near = null;
      this.listLimit = 100;
      this.view = 'list';
      if (reading) this.returnToMap();
      else this.draw();
      return;
    }
    // Reading, a found document opens in the reader; on the map it is selected where it is, or becomes the centre.
    if (reading) {
      this.selected = id;
      this.read(id);
      return;
    }
    if (this.view === 'map' && !this.lanes.has(id)) {
      this.focus = id;
      this.connection = null;
      this.draw();
      this.fit();
    }
    this.select(id);
    if (!this.mobile.matches) this.focusSelected();
  }
}
