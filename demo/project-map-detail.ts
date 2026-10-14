import { KIND_SOURCES } from '../src/core/docindex.ts';
import type { MapConnection, MapProof } from '../src/core/project-map.ts';
import { button, chip, h } from '../src/ui/components/dom.ts';
import { icons } from '../src/ui/components/icons.ts';
import { renderDocument } from '../src/ui/rendering/render.ts';
import { SHAPES, SHEET_TABS, type SheetTab, cardName, iconButton, lineIcon, placeBadge } from './project-map-shared.ts';
import { PrototypeList } from './project-map-list.ts';

/** The details sheet: the document preview, its links and evidence, and reading a document. */
export abstract class PrototypeDetail extends PrototypeList {
  protected proofItem(connection: MapConnection, at: number): HTMLElement {
    const proof = connection.proof[at];
    const item = h('div', 'mr-atlas-proof');
    const open = button('Read source paragraph', 'proof', 'mr-btn mr-outline');
    open.dataset.id = connection.id;
    open.dataset.at = String(at);
    item.append(
      h('blockquote', '', proof.quote),
      h('p', 'mr-atlas-path', `${proof.path} · ${proof.section || 'Document'} · line ${proof.line} · ${this.source.commit.slice(0, 7)}`),
      open,
    );
    return item;
  }

  protected drawDetail(): void {
    const detail = this.q('.mr-atlas-detail');
    const previous = detail.querySelector('.mr-atlas-sheet-body');
    if (detail.dataset.tab === 'preview' && previous?.getClientRects().length) this.previewScroll = { path: detail.dataset.id!, top: previous.scrollTop };
    detail.classList.toggle('is-open', this.detailsOpen);
    this.q('.mr-atlas-shell').classList.toggle('has-sheet', this.detailsOpen);
    this.q('[data-act="details"]').setAttribute('aria-expanded', String(this.detailsOpen));
    // Beside the Map the sheet is a complementary region; on phones it covers the Map and becomes a modal dialog.
    const modal = this.mobile.matches && this.detailsOpen;
    if (modal) {
      detail.setAttribute('role', 'dialog');
      detail.setAttribute('aria-modal', 'true');
    } else {
      detail.removeAttribute('role');
      detail.removeAttribute('aria-modal');
    }
    const settingsOpen = !this.q('.mr-settings').hidden;
    for (const section of ['.mr-atlas-chrome', '.mr-atlas-map-view']) this.q(section).inert = modal || settingsOpen;
    this.q('.mr-atlas-backdrop').hidden = !modal;
    // Closing keeps the last contents so the sheet slides away whole; it is hidden from focus and assistive technology.
    if (!this.detailsOpen) return;
    detail.replaceChildren();
    const place = this.place(this.selected);
    detail.dataset.id = place.id;
    detail.dataset.tab = this.connection ? 'evidence' : this.tab;
    detail.setAttribute('aria-label', this.connection ? 'Link evidence' : this.tab === 'preview' ? 'Document preview' : 'Selected document');
    // Actions sit at the top beside Close, where the eye starts; the body below is only the document or its links.
    const header = h('header', 'mr-atlas-sheet-header');
    const top = h('div', 'mr-atlas-sheet-top');
    const actions = h('div', 'mr-atlas-sheet-actions');
    const body = h('div', 'mr-atlas-sheet-body');
    const close = iconButton('close-details', 'Close details', 'Close details (Esc)', icons.close);
    header.append(top);
    detail.append(header, body);
    const commit = this.source.commit.slice(0, 7);
    if (this.connection) {
      const connection = this.connection;
      const back = button('Back to document', 'place-detail', 'mr-btn mr-atlas-sheet-back');
      // biome-ignore lint/plugin: a bundled reader icon constant, never document content.
      back.insertAdjacentHTML('afterbegin', icons.chevronLeft);
      actions.append(close);
      top.append(back, actions);
      header.append(
        h('p', 'mr-atlas-kicker', 'Documented · links to'),
        h('h2', '', 'Link evidence'),
        h('p', 'mr-atlas-sheet-description', `${this.title(connection.from)} → ${this.title(connection.to)}`),
      );
      for (const at of connection.proof.keys()) body.append(this.proofItem(connection, at));
      if (connection.hiddenProof) body.append(h('p', 'mr-atlas-note', `${connection.hiddenProof} additional source links beyond this preview budget.`));
      return;
    }
    const name = cardName(place.title);
    const badges = h('div', 'mr-atlas-sheet-badges');
    badges.append(placeBadge(place.kind, name.label));
    if (place.id === this.here) badges.append(h('span', 'mr-atlas-here', 'You are here'));
    if (place.id !== this.focus) actions.append(iconButton('focus', 'Show its connections', 'Show its connections on the map', lineIcon(SHAPES.locate)));
    const read = button('Read', 'read', 'mr-btn mr-outline mr-atlas-sheet-read');
    read.prepend(lineIcon(SHAPES.read));
    read.dataset.id = place.id;
    read.title = 'Read the whole document';
    read.disabled = !this.texts.has(place.id);
    actions.append(read, close);
    top.append(badges, actions);
    header.append(h('h2', '', name.name), h('p', 'mr-atlas-sheet-description', `${place.path} · ${commit}`));
    const connected = this.model.connections.filter((connection) => connection.from === place.id || connection.to === place.id);
    const tabs = h('div', 'mr-atlas-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Document details');
    for (const id of SHEET_TABS) {
      const tab = button(id === 'links' ? 'Links' : 'Preview', 'sheet-tab', 'mr-atlas-tab');
      if (id === 'links') tab.append(h('span', '', String(connected.length)));
      tab.dataset.tab = id;
      tab.id = `mr-atlas-tab-${id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(id === this.tab));
      tab.setAttribute('aria-controls', 'mr-atlas-sheet-panel');
      tab.tabIndex = id === this.tab ? 0 : -1;
      tab.disabled = id === 'preview' && !this.texts.has(place.id);
      tabs.append(tab);
    }
    header.append(tabs);
    body.id = 'mr-atlas-sheet-panel';
    body.setAttribute('role', 'tabpanel');
    body.setAttribute('aria-labelledby', `mr-atlas-tab-${this.tab}`);
    body.tabIndex = 0;
    if (this.tab === 'preview') {
      const content = h('div', 'mr-atlas-preview');
      const rendered = this.render(place.id).content;
      // The sheet's header already names the document.
      const heading = rendered.querySelector('h1');
      if (heading?.textContent?.trim() === place.title) heading.hidden = true;
      content.append(rendered);
      body.append(content);
      body.scrollTop = this.previewScroll.path === place.id ? this.previewScroll.top : 0;
      return;
    }
    if (place.state !== 'indexed')
      body.append(h('p', 'mr-atlas-note', place.state === 'not-read' ? 'Not indexed: its outgoing links are unknown.' : 'This document could not be indexed.'));
    // A neighbour's sheet opens with the sentence that put it on this map.
    const between = connected.filter((connection) => connection.from === this.focus || connection.to === this.focus);
    if (place.id !== this.focus && between.length) {
      const why = h('section', 'mr-atlas-why');
      const focusName = cardName(this.title(this.focus)).name;
      why.append(h('h3', '', `How it connects to ${focusName}`));
      for (const connection of between) {
        why.append(h('p', 'mr-atlas-why-direction', connection.from === place.id ? `This links to ${focusName}` : `${focusName} links here`));
        for (const at of connection.proof.keys()) if (at < 2) why.append(this.proofItem(connection, at));
        const count = connection.proof.length + connection.hiddenProof;
        if (count > 2) {
          const all = button(`See all ${count} source links`, 'connection', 'mr-btn mr-outline');
          all.dataset.id = connection.id;
          why.append(all);
        }
      }
      body.append(why);
    }
    const visible = new Set(connected.slice(0, this.connectionLimit));
    for (const incoming of [true, false]) {
      const links = connected.filter((connection) => (incoming ? connection.to : connection.from) === place.id);
      const group = h('section', 'mr-atlas-link-group');
      group.dataset.direction = incoming ? 'incoming' : 'outgoing';
      const heading = h('h3', '', incoming ? 'Linked from' : 'Links to');
      heading.append(h('span', '', String(links.length)));
      group.append(heading);
      for (const connection of links.filter((connection) => visible.has(connection))) {
        const target = this.place(incoming ? connection.from : connection.to);
        const name = cardName(target.title);
        const row = button('', 'connection', 'mr-atlas-connection');
        row.dataset.id = connection.id;
        row.setAttribute('aria-label', `Inspect evidence: ${this.title(connection.from)} links to ${this.title(connection.to)}`);
        const count = connection.proof.length + connection.hiddenProof;
        row.append(h('strong', '', name.name), h('small', '', `${name.label ?? target.kind} · ${count} source ${count === 1 ? 'link' : 'links'}`));
        group.append(row);
      }
      if (!links.length)
        group.append(
          h(
            'p',
            'mr-atlas-path',
            incoming
              ? 'No indexed documents link here.'
              : place.state === 'indexed'
                ? 'No outgoing document links found.'
                : 'Outgoing links have not been indexed.',
          ),
        );
      body.append(group);
    }
    if (connected.length > this.connectionLimit)
      body.append(
        button(`Show ${Math.min(12, connected.length - this.connectionLimit)} more connections`, 'connections-more', 'mr-btn mr-outline mr-atlas-more'),
      );
    const issues = this.index.problems.filter((problem) => problem.from === place.id);
    if (issues.length) {
      const box = h('details', 'mr-atlas-issues');
      box.append(h('summary', '', `${issues.length} unresolved links`));
      for (const issue of issues.slice(0, 12))
        box.append(
          h(
            'p',
            '',
            `${issue.link.text}: ${issue.kind === 'missing-anchor' ? `section “${issue.link.anchor}” was not found` : 'document was not listed'} · line ${issue.link.line}`,
          ),
        );
      if (issues.length > 12) box.append(h('p', '', `${issues.length - 12} additional unresolved links beyond this preview budget.`));
      body.append(box);
    }
    const source = h('details', 'mr-atlas-source');
    source.append(
      h('summary', '', 'Source and status'),
      h('p', 'mr-atlas-path', `${place.path} · ${commit}`),
      chip(null, 'Documented'),
      h('p', 'mr-atlas-path', `${place.kind} · ${KIND_SOURCES[place.kindFrom]}`),
    );
    if (place.kindFrom === 'reader')
      source.append(h('p', '', `The source says ${place.sourceKind} (${KIND_SOURCES[place.sourceKindFrom]}); you set ${place.kind}.`));
    for (const status of place.statuses) source.append(chip(null, status));
    body.append(source);
  }

  protected render(path: string): ReturnType<typeof renderDocument> {
    const text = this.texts.get(path)!;
    const rendered = renderDocument(document, {
      path,
      status: 'modified',
      base: text,
      head: text,
      links: this.source.links,
      origin: location.origin,
      images: 'ask',
    });
    // The spike leaves diagrams as their safe, readable source instead of extracting architectural entities.
    for (const diagram of rendered.diagrams)
      for (const version of diagram.versions) {
        version.view.hidden = true;
        version.sourceDetails.open = true;
      }
    return rendered;
  }

  /** Selecting changes the sheet and the lit lines; the cards and the camera stay where the reader left them. */
  protected select(id: string, tab: SheetTab = this.texts.has(id) ? 'preview' : 'links'): void {
    this.selected = id;
    this.tab = tab;
    this.connection = null;
    this.connectionLimit = 12;
    this.detailsOpen = true;
    this.recent = [id, ...this.recent.filter((other) => other !== id)].slice(0, 5);
    this.markSelection();
    this.drawDetail();
    if (this.mobile.matches) this.q('.mr-atlas-detail [data-act="close-details"]').focus();
  }

  protected showPreview(path: string, anchor?: string): void {
    this.select(path, 'preview');
    if (anchor) {
      const target = [...this.q('.mr-atlas-preview').querySelectorAll<HTMLElement>('[id]')].find(
        (el) => el.id === anchor || el.id === `user-content-${anchor}`,
      );
      target?.scrollIntoView({ block: 'start' });
    }
  }

  /** Reading puts the document in the address, so it can be shared, reloaded and reached with Back and Forward. */
  protected read(path: string, proof?: MapProof, anchor?: string, push = true): void {
    const text = this.texts.get(path);
    if (text === undefined) return;
    const article = this.q('.mr-atlas-article');
    if (article.hidden) {
      this.listScroll = (this.mobile.matches ? this.root : this.q('.mr-atlas-list')).scrollTop;
      this.sheetBeforeRead = this.detailsOpen;
    }
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set('doc', path);
      history.pushState({ atlasDepth: ++this.depth }, '', url);
    }
    this.closeResults();
    const rendered = this.render(path);
    article.replaceChildren(h('p', 'mr-atlas-path', `${path} · ${this.source.commit.slice(0, 7)}`), rendered.content);
    this.detailsOpen = false;
    this.drawDetail();
    this.q('.mr-atlas-map-view').hidden = true;
    article.hidden = false;
    this.root.classList.add('is-reading');
    this.q('[data-act="return"]').hidden = false;
    const reading = this.q('.mr-atlas-reading');
    reading.hidden = false;
    reading.textContent = cardName(this.title(path)).name;
    for (const choice of this.root.querySelectorAll<HTMLElement>('.mr-atlas-choices button')) choice.setAttribute('aria-pressed', 'false');
    const block = proof ? rendered.blocks.find((block) => block.head && block.head.lines[0] < proof.line && block.head.lines[1] >= proof.line) : undefined;
    const target =
      block?.el ??
      (anchor ? [...rendered.content.querySelectorAll<HTMLElement>('[id]')].find((el) => el.id === anchor || el.id === `user-content-${anchor}`) : undefined);
    if (target) {
      target.classList.add('mr-flash');
      target.scrollIntoView({ block: 'center' });
    } else {
      article.scrollTop = 0;
      this.root.scrollTop = 0;
    }
    this.q('[data-act="return"]').focus({ preventScroll: true });
  }

  /** Back to map retraces the entries reading added, so the browser's Back and Forward stay in step. */
  protected returnToMap(): void {
    if (this.depth > 0) {
      history.go(-this.depth);
      return;
    }
    const url = new URL(location.href);
    url.searchParams.delete('doc');
    history.replaceState({ atlasDepth: 0 }, '', url);
    this.showMap();
  }

  /** The map as the reader left it: the same view, camera, scroll and sheet. */
  protected showMap(): void {
    this.q('.mr-atlas-article').hidden = true;
    this.q('.mr-atlas-map-view').hidden = false;
    this.root.classList.remove('is-reading');
    this.q('[data-act="return"]').hidden = true;
    this.q('.mr-atlas-reading').hidden = true;
    // The sheet the reader left comes back with them, so the Map keeps the width it had.
    this.detailsOpen = this.sheetBeforeRead;
    this.draw();
    this.moveCamera();
    (this.mobile.matches ? this.root : this.q('.mr-atlas-list')).scrollTop = this.listScroll;
    // Focus goes back to what the reader used to leave: the evidence they were checking, or the preview's tab.
    if (this.detailsOpen && this.mobile.matches) this.q('.mr-atlas-detail [data-act="close-details"]').focus({ preventScroll: true });
    else if (this.detailsOpen && this.connection) this.q('.mr-atlas-detail [data-act="proof"]').focus({ preventScroll: true });
    else if (this.detailsOpen && this.tab === 'preview') this.q('#mr-atlas-tab-preview').focus({ preventScroll: true });
    else this.focusSelected();
  }

  protected focusSelected(): void {
    [...this.root.querySelectorAll<HTMLElement>('.mr-atlas-place')].find((node) => node.getClientRects().length && node.dataset.id === this.selected)?.focus();
  }

  protected closeDetails(): void {
    this.connection = null;
    this.tab = 'preview';
    this.detailsOpen = false;
    this.drawDetail();
    this.focusSelected();
  }
}
