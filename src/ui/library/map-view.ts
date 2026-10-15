import { CONNECTION_PAGE, type DocumentMapState, LIST_PAGE, type Tab } from './map-view-shared.ts';
import { DocumentMapSheet } from './map-view-sheet.ts';

export class DocumentMap extends DocumentMapSheet {
  /** Draw for the index as it is now. Selection, the sheet, the camera and the view stay as the reader left them. */
  draw(state: DocumentMapState): void {
    const moved = this.state?.focus !== state.focus;
    this.state = state;
    this.places = new Map(state.model.places.map((place) => [place.id, place]));
    const active = (this.element.getRootNode() as Document | ShadowRoot).activeElement;
    const { sheet } = this.host;
    // A control drawn again is found by what it does and what it is; the sheet keeps its own Close.
    const keep: Record<string, string | undefined> | null =
      active instanceof HTMLElement && (this.element.contains(active) || sheet.element.contains(active))
        ? { ...active.dataset, className: active.className }
        : null;
    const scroll = sheet.body.scrollTop;
    this.render();
    sheet.body.scrollTop = scroll;
    if (keep)
      [...this.element.querySelectorAll<HTMLElement>('[data-act]'), ...sheet.element.querySelectorAll<HTMLElement>('[data-act]')]
        .find((el) => el.className === keep.className && ['act', 'id', 'path', 'line', 'tab'].every((key) => el.dataset[key] === keep[key]))
        ?.focus({ preventScroll: true });
    if (moved) this.fit();
  }

  /** The reader is closing, or reading a new commit: stop watching the window, and close the details. */
  destroy(): void {
    this.park();
    this.observer.disconnect();
    this.mobile.removeEventListener('change', this.onMobile);
    this.previewVersion++;
  }

  /** Put keyboard focus on the document in the middle, after the library moved it there. */
  focusCentre(): void {
    this.focusPlace(this.state.focus);
  }

  /**
   * Show a document's details, as choosing it would: the library opens on the document it starts at. On a phone, where
   * the sheet would cover the map, the document is only chosen.
   */
  select(id: string): void {
    if (this.mobile.matches) {
      this.selected = id;
      this.mark();
    } else this.open(id, 'preview');
  }

  /** The library shows something else in the sheet: the details give it up without closing it, and the place stays chosen. */
  release(): void {
    this.sheetOpen = false;
    this.connection = null;
  }

  /** Close, the backdrop or Escape close the details sheet while the map is shown; focus goes back to the place it was about. */
  closeSheet(): boolean {
    if (!this.sheetOpen || !this.host.sheet.isOpen) return false;
    this.sheetOpen = false;
    this.connection = null;
    this.host.sheet.hide();
    this.focusPlace(this.selected!);
    return true;
  }

  /** The map is put away: its details go with it, and come back as they were when the map is drawn again. */
  park(): void {
    if (this.sheetOpen) this.host.sheet.hide();
  }

  /** A link in a preview previews the document it points to in the same sheet; anything else the library follows. */
  previewLink(link: HTMLAnchorElement, e: MouseEvent): boolean {
    const path = link.dataset.mrPath!.split('#')[0].replace(/\?.*$/, '');
    if (e.ctrlKey || e.metaKey || e.shiftKey || !this.places.has(path)) return false;
    e.preventDefault();
    this.open(path, 'preview');
    return true;
  }

  /** Arrow keys between the sheet's tabs, and the camera keys while the map itself has focus. */
  onKey(e: KeyboardEvent): boolean {
    const target = e.composedPath()[0] as HTMLElement;
    if (target.matches('.mr-pm-tab') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      this.setTab(this.tab === 'preview' ? 'links' : 'preview');
      return true;
    }
    if (!target.matches('.mr-pm-canvas') || this.stacked) return false;
    const moves: Record<string, [number, number]> = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
    if (moves[e.key]) {
      this.camera.x += moves[e.key][0];
      this.camera.y += moves[e.key][1];
      this.moveCamera();
    } else if (e.key === '0') this.fit();
    else if (e.key === '+' || e.key === '=') this.zoomTo(this.camera.zoom + 0.1);
    else if (e.key === '-') this.zoomTo(this.camera.zoom - 0.1);
    else return false;
    e.preventDefault();
    return true;
  }

  /** The library passes every `pm-` action here. */
  onAct(control: HTMLElement): void {
    const data = control.dataset;
    switch (data.act) {
      case 'pm-view-map':
      case 'pm-view-list':
        this.view = data.act === 'pm-view-map' ? 'map' : 'list';
        this.near = null;
        this.listLimit = LIST_PAGE;
        this.render();
        if (this.view === 'map') this.fit();
        return;
      case 'pm-select':
        this.open(data.id!, 'preview');
        return;
      case 'pm-tab':
        this.setTab(data.tab as Tab);
        return;
      case 'pm-details':
        this.connection = null;
        this.setTab('links');
        return;
      case 'pm-connection': {
        const connection = this.state.model.connections.find((c) => c.id === data.id)!;
        this.connection = connection.id;
        this.selected ??= connection.from;
        this.sheetOpen = true;
        this.mark();
        this.drawSheet();
        this.host.sheet.body.querySelector<HTMLElement>('[data-act="evidence"]')!.focus({ preventScroll: true });
        return;
      }
      case 'pm-connections-more':
        this.connectionLimit += CONNECTION_PAGE;
        this.drawSheet();
        return;
      case 'pm-focus':
        // Around a review, its connections are the Documents map's, with the document in the middle.
        if (this.state.review) this.host.explore!(this.selected!);
        else this.refocus(this.selected!);
        return;
      case 'pm-home':
        this.selected = this.state.here;
        this.refocus(this.state.here!);
        return;
      case 'pm-more':
        this.near = this.state.review ? null : this.state.focus;
        this.listLimit = LIST_PAGE;
        this.view = 'list';
        this.render();
        return;
      case 'pm-clear-near':
        this.near = null;
        this.listLimit = LIST_PAGE;
        this.render();
        this.q('.mr-pm-list .mr-pm-place').focus();
        return;
      case 'pm-list-more':
        this.listLimit += LIST_PAGE;
        this.drawList();
        return;
      case 'pm-fit':
        this.fit();
        return;
      case 'pm-zoom-in':
        this.zoomTo(this.camera.zoom + 0.1);
        return;
      case 'pm-zoom-out':
        this.zoomTo(this.camera.zoom - 0.1);
        return;
    }
  }
}
