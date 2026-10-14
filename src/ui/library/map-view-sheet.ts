import { ORIGIN_NAMES } from '../../core/architecture.ts';
import { linksAround, type MapConnection, type MapPlace, type MapProof } from '../../core/project-map.ts';
import { button, chip, h } from '../components/dom.ts';
import { CONNECTION_PAGE, LIST_PAGE, SHAPES, type Tab, ZOOM, act, cardName, iconAct, lineIcon, plural, previewable, typeBadge } from './map-view-shared.ts';
import { DocumentMapDrawing } from './map-view-drawing.ts';

export abstract class DocumentMapSheet extends DocumentMapDrawing {
  /** The same places as rows, by folder: everything the map can show, without geometry. */
  protected drawList(): void {
    const list = this.q('.mr-pm-list');
    list.replaceChildren();
    if (this.view === 'map') return;
    const { model } = this.state;
    const inner = h('div', 'mr-pm-list-inner');
    list.append(inner);
    const degree = new Map(model.places.map((place) => [place.id, { incoming: 0, outgoing: 0 }]));
    for (const connection of model.connections) {
      degree.get(connection.from)!.outgoing++;
      degree.get(connection.to)!.incoming++;
    }
    if (this.state.review) {
      this.reviewList(inner, degree);
      this.mark();
      return;
    }
    let places = model.places;
    if (this.near) {
      const near = this.near;
      const ids = new Set(model.connections.flatMap((c) => (c.from === near ? [c.to] : c.to === near ? [c.from] : [])));
      ids.delete(near);
      places = places.filter((place) => ids.has(place.id));
      const filter = h('p', 'mr-pm-filter');
      filter.append(
        h('span', '', `${plural(ids.size, 'document')} connected to ${this.place(near).title}`),
        iconAct('clear-near', 'Show every document', SHAPES.close),
      );
      inner.append(filter);
    }
    const folders = new Map<string, MapPlace[]>();
    for (const place of places.slice(0, this.listLimit)) folders.set(place.folder, [...(folders.get(place.folder) ?? []), place]);
    for (const [folder, group] of folders) {
      const section = h('section', 'mr-pm-group');
      const name = folder ? `${folder}/` : 'Top folder';
      section.setAttribute('aria-label', name);
      const heading = h('h2', 'mr-pm-folder', name);
      heading.append(h('span', '', plural(group.length, 'document')));
      const rows = h('div', 'mr-pm-rows');
      for (const place of group) rows.append(this.listRow(place, degree));
      section.append(heading, rows);
      inner.append(section);
    }
    if (places.length > this.listLimit)
      inner.append(act(`Show ${Math.min(LIST_PAGE, places.length - this.listLimit)} more of ${places.length}`, 'list-more', 'mr-btn mr-outline mr-pm-more'));
    this.mark();
  }

  /** A place as a row of List: its card, with its path for where it is, and how many links run each way. */
  protected listRow(place: MapPlace, degree: Map<string, { incoming: number; outgoing: number }>): HTMLElement {
    const row = this.card(place);
    const caption = row.querySelector('.mr-pm-caption')!;
    const plain = place.state === 'indexed' || place.state === 'file';
    caption.replaceWith(h('small', 'mr-pm-path', plain ? place.path : `${place.path} · ${caption.textContent}`));
    const counts = degree.get(place.id)!;
    // A file has no links of its own to count.
    row.append(
      h('small', 'mr-pm-counts', place.state === 'file' ? `${counts.incoming} linked from` : `${counts.incoming} linked from · ${counts.outgoing} links to`),
    );
    return row;
  }

  /**
   * This review as rows: what links to what it changes, each chapter's files, every one of them, and what they link to.
   * What the reader added to a chapter is listed with it, as a reading aid, never as a link.
   */
  protected reviewList(inner: HTMLElement, degree: Map<string, { incoming: number; outgoing: number }>): void {
    const review = this.state.review!;
    const around = linksAround(
      this.state.model,
      review.chapters.flatMap((chapter) => chapter.paths),
    );
    const group = (title: string, ids: string[], unit: string, added: Node[] = []) => {
      const section = h('section', 'mr-pm-group');
      section.setAttribute('aria-label', title);
      const heading = h('h2', 'mr-pm-folder', title);
      heading.append(h('span', '', plural(ids.length, unit)));
      const rows = h('div', 'mr-pm-rows');
      rows.append(...ids.map((id) => this.listRow(this.place(id), degree)), ...added);
      section.append(heading, rows);
      inner.append(section);
    };
    if (around.incoming.length) group('Linked from', around.incoming, 'document');
    for (const chapter of review.chapters) {
      const added = (chapter.attachments ?? []).map((attachment) => {
        const row = button('', 'open', 'mr-pm-place mr-pm-attachment');
        row.dataset.path = attachment.path;
        row.dataset.anchor = attachment.heading;
        row.append(h('strong', '', attachment.title), h('small', 'mr-pm-path', `Added by you · ${attachment.commit.slice(0, 7)}`));
        return row;
      });
      group(chapter.title, chapter.paths, 'file', added);
    }
    if (around.outgoing.length) group('Links to', around.outgoing, 'document');
    inner.append(h('p', 'mr-pm-note', 'Galley says what is worth checking; it never says a document is wrong.'));
  }

  protected open(id: string, tab: Tab): void {
    this.selected = id;
    this.tab = previewable(this.place(id)) ? tab : 'links';
    this.connection = null;
    this.connectionLimit = CONNECTION_PAGE;
    this.sheetOpen = true;
    this.mark();
    this.drawSheet();
    if (this.mobile.matches) this.host.sheet.close.focus();
  }

  protected setTab(tab: Tab): void {
    this.tab = tab;
    this.drawSheet();
    this.host.sheet.element.querySelector<HTMLElement>(`.mr-pm-tab[data-tab="${tab}"]`)!.focus();
  }

  /** The details sheet: the reader's sheet, beside the map on wide screens and over it on phones. */
  protected drawSheet(): void {
    this.previewVersion++;
    // Closing keeps the contents, so the sheet slides away whole; a map put away keeps its sheet for the return.
    if (!this.sheetOpen || !this.element.isConnected || this.element.closest('[hidden]')) return;
    const { sheet } = this.host;
    const body = sheet.body;
    for (const name of ['id', 'role', 'aria-labelledby']) body.removeAttribute(name);
    const place = this.place(this.selected!);
    if (this.connection) {
      const connection = this.state.model.connections.find((c) => c.id === this.connection)!;
      const back = act('Back to document', 'details', 'mr-btn mr-pm-sheet-back');
      back.prepend(lineIcon(SHAPES.back));
      const proof: Node[] = connection.proof.map((item) => this.proof(item));
      if (connection.hiddenProof) proof.push(h('p', 'mr-pm-note', `${plural(connection.hiddenProof, 'more link')} not listed here.`));
      sheet.fill({
        label: 'Link evidence',
        lead: [back],
        kicker: `${ORIGIN_NAMES[connection.origin]} · ${connection.verb}`,
        title: 'Link evidence',
        description: `${this.place(connection.from).title} → ${this.place(connection.to).title}`,
        body: proof,
      });
      sheet.show();
      return;
    }
    const { focus, here, changed, review } = this.state;
    const name = cardName(place.title);
    const badges: Node[] = [typeBadge(place.kind, name.label)];
    if (changed.has(place.id)) badges.push(chip('modified', 'Changed in this review'));
    if (place.id === here) badges.push(h('span', 'mr-pm-here', 'You are here'));
    const actions: Node[] = [];
    // A file is not a document: there is nothing to read, and nothing of its own to map.
    const file = place.state === 'file';
    if (review ? !file : place.id !== focus) actions.push(iconAct('focus', 'Show its connections', SHAPES.locate, 'Show its connections on the map'));
    if (!file) {
      const read = button('Read', 'open', 'mr-btn mr-outline mr-pm-read');
      read.dataset.path = place.id;
      read.prepend(lineIcon(SHAPES.read));
      read.title = 'Read the whole document';
      actions.push(read);
    }
    const connected = this.state.model.connections.filter((connection) => connection.from === place.id || connection.to === place.id);
    const tabs = h('div', 'mr-pm-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Document details');
    for (const id of ['preview', 'links'] as const) {
      const tab = act(id === 'preview' ? 'Preview' : 'Links', 'tab', 'mr-pm-tab');
      if (id === 'links') tab.append(h('span', '', String(connected.length)));
      tab.dataset.tab = id;
      tab.id = `mr-pm-tab-${id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(id === this.tab));
      tab.setAttribute('aria-controls', 'mr-pm-sheet-panel');
      tab.tabIndex = id === this.tab ? 0 : -1;
      tab.disabled = id === 'preview' && !previewable(place);
      tabs.append(tab);
    }
    sheet.fill({
      label: this.tab === 'preview' ? 'Document preview' : 'Selected document',
      lead: badges,
      actions,
      title: name.name,
      description: `${place.path} · ${this.host.commit.slice(0, 7)}`,
      extra: [tabs],
      body: [],
    });
    body.id = 'mr-pm-sheet-panel';
    body.setAttribute('role', 'tabpanel');
    body.setAttribute('aria-labelledby', `mr-pm-tab-${this.tab}`);
    sheet.show();
    if (this.tab === 'links') this.links(body, place, connected);
    else if (this.shown?.path === place.id) body.append(this.shown.content);
    else {
      body.append(h('p', 'mr-pm-note', 'Opening the document…'));
      const version = this.previewVersion;
      void this.host.preview(place.id).then((content) => {
        if (version !== this.previewVersion) return;
        if (content) this.shown = { path: place.id, content };
        body.replaceChildren(content ?? h('p', 'mr-pm-note', 'This document cannot be shown here. Read it to see why.'));
      });
    }
  }

  /** Links: how a neighbour connects to the focus, every link in and out, what cannot be followed, and the type. */
  protected links(body: HTMLElement, place: MapPlace, connected: MapConnection[]): void {
    const { focus, review } = this.state;
    if (place.state === 'file') {
      body.append(h('p', 'mr-pm-note', 'A file, not a document: only the documents that link to it are shown.'));
      const declares = review!.declares?.[place.id];
      if (declares?.length) body.append(h('p', 'mr-pm-note', `Declares ${declares.join(', ')}.`));
    } else if (place.state !== 'indexed') body.append(h('p', 'mr-pm-note', 'Not read: only the links to it are shown.'));
    // How it connects to the middle: the document in focus, or around a review, what the review changes.
    const centre = new Set(review ? review.chapters.flatMap((chapter) => chapter.paths) : [focus]);
    const between = centre.has(place.id) ? [] : connected.filter((connection) => centre.has(connection.from) || centre.has(connection.to));
    if (between.length) {
      const why = h('section', 'mr-pm-why');
      why.append(h('h3', '', review ? 'How it connects to this review' : `How it connects to ${cardName(this.place(focus).title).name}`));
      for (const connection of between) {
        const other = cardName(this.place(connection.from === place.id ? connection.to : connection.from).title).name;
        why.append(h('p', 'mr-pm-why-direction', connection.from === place.id ? `This links to ${other}` : `${other} links here`));
        for (const proof of connection.proof.slice(0, 2)) why.append(this.proof(proof));
        const count = connection.proof.length + connection.hiddenProof;
        if (count > 2) {
          const all = act(`See all ${count} links`, 'connection');
          all.dataset.id = connection.id;
          why.append(all);
        }
      }
      body.append(why);
    }
    const visible = new Set(connected.slice(0, this.connectionLimit));
    for (const incoming of [true, false]) {
      const links = connected.filter((connection) => (incoming ? connection.to : connection.from) === place.id);
      const label = incoming ? 'Linked from' : 'Links to';
      const group = h('section', 'mr-pm-link-group');
      group.setAttribute('aria-label', label);
      const heading = h('h3', '', label);
      heading.append(h('span', '', String(links.length)));
      group.append(heading);
      for (const connection of links.filter((connection) => visible.has(connection))) {
        const other = this.place(incoming ? connection.from : connection.to);
        const name = cardName(other.title);
        const row = act('', 'connection', 'mr-pm-connection');
        row.dataset.id = connection.id;
        row.setAttribute('aria-label', `Link evidence: ${this.place(connection.from).title} links to ${this.place(connection.to).title}`);
        row.append(
          h('strong', '', name.name),
          h('small', '', `${name.label ?? other.kind} · ${plural(connection.proof.length + connection.hiddenProof, 'link')}`),
        );
        group.append(row);
      }
      if (!links.length) group.append(h('p', 'mr-pm-path', incoming ? 'No document read so far links here.' : 'No links to other listed documents.'));
      body.append(group);
    }
    if (connected.length > this.connectionLimit)
      body.append(
        act(`Show ${Math.min(CONNECTION_PAGE, connected.length - this.connectionLimit)} more links`, 'connections-more', 'mr-btn mr-outline mr-pm-more'),
      );
    const problems = this.host.problems(place.id);
    if (problems) body.append(problems);
    const details = this.host.details(place.id);
    if (details.length) {
      const about = h('section', 'mr-pm-about');
      about.append(h('h3', '', 'Type and status'), ...details);
      body.append(about);
    }
  }

  /** One link as evidence: its words, where it is, and the way to the paragraph that holds it. */
  protected proof(proof: MapProof): HTMLElement {
    const item = h('div', 'mr-pm-proof');
    const open = button('Read source paragraph', 'evidence');
    open.dataset.path = proof.path;
    open.dataset.line = String(proof.line);
    item.append(
      h('blockquote', '', proof.quote || 'A link without text'),
      h('p', 'mr-pm-path', `${proof.path} · ${proof.section ?? 'Document'} · line ${proof.line} · ${this.host.commit.slice(0, 7)}`),
      open,
    );
    return item;
  }

  protected focusPlace(id: string): void {
    [...this.element.querySelectorAll<HTMLElement>('.mr-pm-place')].find((node) => node.dataset.id === id)?.focus();
  }

  /** Fit shows the whole neighbourhood: at full size when it fits, otherwise scaled down, and centred. */
  protected fit(): void {
    const canvas = this.q('.mr-pm-canvas');
    const world = this.q('.mr-pm-world');
    canvas.scrollTop = 0;
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

  /** Zoom keeps the point under the pointer, or the middle of the map, where it is. */
  protected zoomTo(level: number, at?: { x: number; y: number }): void {
    const canvas = this.q('.mr-pm-canvas');
    const point = at ?? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const zoom = Math.round(Math.min(ZOOM.max, Math.max(ZOOM.min, level)) * 100) / 100;
    this.camera.x = point.x - ((point.x - this.camera.x) * zoom) / this.camera.zoom;
    this.camera.y = point.y - ((point.y - this.camera.y) * zoom) / this.camera.zoom;
    this.camera.zoom = zoom;
    this.moveCamera();
  }

  protected moveCamera(): void {
    const { x, y, zoom } = this.camera;
    this.q('.mr-pm-world').style.transform = this.stacked ? '' : `translate(${x}px, ${y}px) scale(${zoom})`;
    this.q<HTMLButtonElement>('[data-act="pm-zoom-in"]').disabled = zoom >= ZOOM.max;
    this.q<HTMLButtonElement>('[data-act="pm-zoom-out"]').disabled = zoom <= ZOOM.min;
  }

  /** Show its connections, and Back to my place: a deliberate new middle, which the library remembers. */
  protected refocus(id: string): void {
    this.host.refocus!(id);
    this.state = { ...this.state, focus: id };
    this.view = 'map';
    this.near = null;
    this.connection = null;
    this.render();
    this.fit();
  }
}
