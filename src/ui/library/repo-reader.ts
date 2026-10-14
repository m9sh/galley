import type { LensName } from '../../core/architecture.ts';
import type { DocKind } from '../../core/docindex.ts';
import type { RepositorySource } from '../../platforms/types.ts';
import { isPalette, PALETTE_KEYS, type DiagramPalette } from '../rendering/diagram-palette.ts';
import { renderDiagrams } from '../rendering/diagrams.ts';
import { button, h, loadingLines } from '../components/dom.ts';
import { LAYOUT_NAMES } from '../components/layout-controls.ts';
import { loadImage } from '../rendering/render.ts';
import { DEFAULT_SETTINGS, updateSettings, TEXT_SIZES, type Settings } from '../preferences/settings.ts';
import { applyReadingControls, nextTab, selectTab } from '../components/settings-sheet.ts';
import { type ReviewContext, SETTINGS_TABS, problem, safeDecode, session } from './repo-reader-shared.ts';
import { RepoReaderLenses } from './repo-reader-lenses.ts';

export interface RepoReaderHandle {
  close(): void;
}

/** Open the repository reader over the page. Accepts a promise so it can show loading and errors itself. */
export function openRepository(
  source: RepositorySource | Promise<RepositorySource>,
  options: { onClose?: (action?: 'continue') => void; review?: ReviewContext } = {},
): RepoReaderHandle {
  session.reader?.close();
  const reader = new RepoReader(options.onClose, options.review ?? null);
  session.reader = reader;
  Promise.resolve(source).then(
    (s) => reader.setSource(s),
    (err) => reader.showError(err),
  );
  return { close: () => reader.close() };
}
class RepoReader extends RepoReaderLenses {
  // ---------------------------------------------------------------- chrome

  protected skeleton(): HTMLElement {
    return loadingLines();
  }

  protected message(title: string, body: string, extra: Node[] = []): void {
    this.rendered = null;
    this.setView('read');
    this.q('.mr-toc').replaceChildren();
    const box = h('div', 'mr-message');
    box.append(h('h2', '', title));
    if (body) box.append(h('p', '', body));
    const actions = h('div', 'mr-actions');
    actions.append(...extra.filter((node) => node instanceof HTMLElement && node.matches('a, button')));
    box.append(...extra.filter((node) => !(node instanceof HTMLElement && node.matches('a, button'))), actions);
    actions.append(button('Close', 'close'));
    this.q('.mr-doc').replaceChildren(box);
  }

  protected toast(text: string): void {
    const toast = this.q('.mr-toast');
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 4000);
  }

  protected get settingsSheet(): HTMLElement {
    return this.q('.mr-settings:not(.mr-repo-export)');
  }

  protected openSheetEl(): HTMLElement | null {
    return this.shadow.querySelector<HTMLElement>('.mr-settings:not([hidden])');
  }

  protected openSettings(tab: string): void {
    selectTab(this.settingsSheet, tab, false);
    this.openSheet(this.settingsSheet, '[data-act="settings"]');
    this.palettes.reveal(this.settings.theme);
  }

  /** Settings and export open as sheets: the reader behind goes inert, and focus comes back to what opened them. */
  protected openSheet(sheet: HTMLElement, opener: string): void {
    this.closeMenus();
    sheet.hidden = false;
    this.sheetOpener = opener;
    this.q(opener).setAttribute('aria-expanded', 'true');
    for (const el of this.root.querySelectorAll<HTMLElement>('.mr-topbar, .mr-main, .mr-toc')) el.inert = true;
    sheet.querySelector<HTMLElement>('.mr-settings-heading .mr-icon-btn')!.focus();
  }

  protected closeSheet(): boolean {
    const sheet = this.openSheetEl();
    if (!sheet) return false;
    sheet.hidden = true;
    for (const el of this.root.querySelectorAll<HTMLElement>('.mr-topbar, .mr-main, .mr-toc')) el.inert = false;
    const opener = this.q(this.sheetOpener);
    opener.setAttribute('aria-expanded', 'false');
    opener.focus({ preventScroll: true });
    return true;
  }

  protected closeMenus(): boolean {
    let closed = false;
    for (const [menu, control] of [
      ['.mr-repo-docs', '[data-act="docs"]'],
      ['.mr-repo-views', '[data-act="views"]'],
    ]) {
      if (!this.q(menu).hidden) closed = true;
      this.q(menu).hidden = true;
      this.q(control).setAttribute('aria-expanded', 'false');
    }
    return closed;
  }

  protected closeZoom(): boolean {
    const zoom = this.q('.mr-repo-zoom');
    if (zoom.hidden) return false;
    zoom.hidden = true;
    return true;
  }

  protected onScroll(): void {
    const max = this.root.scrollHeight - this.root.clientHeight;
    this.q('.mr-progress > div').style.transform = `scaleX(${max > 0 ? Math.min(1, this.root.scrollTop / max) : 0})`;
    this.q('.mr-topbar').classList.toggle('is-scrolled', this.root.scrollTop > 8);
  }

  protected onClick(e: MouseEvent): void {
    const target = e.target as Element;
    const link = target.closest<HTMLAnchorElement>('.mr-content a[data-mr-path]');
    if (link) {
      if (link.closest('.mr-pm-sheet') && this.mapView!.previewLink(link, e)) return;
      if (link.closest('.mr-doc-sheet') && this.reviewMap!.previewLink(link, e)) return;
      this.follow(link, e);
      return;
    }
    const section = target.closest<HTMLAnchorElement>('.mr-content a[href^="#"]');
    if (section) {
      e.preventDefault();
      this.showAnchor(safeDecode(section.getAttribute('href')!.slice(1)));
      return;
    }
    const view = target.closest<HTMLElement>('[data-view]');
    if (view) {
      this.closeMenus();
      if (view.dataset.view === 'map') void this.showMap();
      else if (view.dataset.view === 'notes') this.showNotes();
      else if (view.dataset.view === 'review') void this.showReview();
      else if (view.dataset.view === 'chapters') this.showSequence();
      else if (this.path && this.rendered?.content.isConnected) this.setView('read');
      else if (this.path) void this.open(this.path, { push: false });
      else this.start();
      return;
    }
    const el = target.closest<HTMLElement>('[data-act]');
    const value = target.closest<HTMLElement>('[data-setting] [data-value]');
    if (value) {
      const key = value.closest<HTMLElement>('[data-setting]')!.dataset.setting!;
      if (key === 'layout') {
        if (this.layouts.select(value.dataset.value!)) this.arrangeLayout();
      } else this.update({ [key]: value.dataset.value });
      return;
    }
    const tab = target.closest<HTMLElement>('[data-settings-tab]');
    if (tab) {
      selectTab(this.settingsSheet, tab.dataset.settingsTab!);
      return;
    }
    if (!el) {
      if (!target.closest('.mr-menu, [data-act="docs"], [data-act="settings"]')) this.closeMenus();
      return;
    }
    if (el.dataset.act!.startsWith('pm-')) {
      (this.view === 'review' ? this.reviewMap! : this.mapView!).onAct(el);
      return;
    }
    const path = el.dataset.path;
    const id = el.dataset.id!;
    const notes = this.notes!;
    switch (el.dataset.act) {
      case 'close':
        this.close();
        return;
      case 'continue-chapter':
        this.close('continue');
        return;
      case 'back':
        this.go(-1);
        return;
      case 'forward':
        this.go(1);
        return;
      case 'docs':
        this.toggleDocs();
        return;
      case 'views': {
        const menu = this.q('.mr-repo-views');
        const open = menu.hidden;
        this.closeMenus();
        if (open) {
          menu.hidden = false;
          el.setAttribute('aria-expanded', 'true');
          menu.querySelector<HTMLElement>('[aria-pressed="true"]')!.focus();
        }
        return;
      }
      case 'sequence':
        this.showSequence();
        return;
      case 'sequence-add':
        this.addStop({ path: path!, anchor: el.dataset.anchor!, title: el.dataset.title! });
        return;
      case 'sequence-open': {
        const stop = this.sequence.items[Number(el.dataset.at)];
        this.root.focus({ preventScroll: true });
        return void this.open(stop.path, { anchor: stop.anchor });
      }
      case 'sequence-earlier':
      case 'sequence-later':
      case 'sequence-remove': {
        let at = Number(el.dataset.at);
        if (el.dataset.act === 'sequence-remove') this.sequence.remove(at);
        else {
          const step = el.dataset.act === 'sequence-earlier' ? -1 : 1;
          this.sequence.move(at, step);
          at += step;
        }
        this.updateSequence();
        this.showSequence();
        const opens = this.q('.mr-repo-chapters').querySelectorAll<HTMLElement>('[data-act="sequence-open"]');
        if (this.sequence.items.length) opens[Math.min(at, this.sequence.items.length - 1)].focus();
        else this.q('.mr-repo-chapters [data-act="docs"]').focus();
        this.toast(el.dataset.act === 'sequence-remove' ? 'Removed from this chapter.' : 'Reading order updated.');
        return;
      }
      case 'settings':
        this.openSettings('reading');
        return;
      case 'close-settings':
      case 'close-export':
        this.closeSheet();
        return;
      case 'palette-prev':
      case 'palette-next':
      case 'palette-page':
        this.palettes.onClick(el.dataset.act, el);
        return;
      case 'top-glow':
        this.update({ topGlow: !this.settings.topGlow });
        return;
      case 'refresh':
        return void this.refresh();
      case 'open':
        this.closeMenus();
        if (path === this.path && !el.dataset.anchor && this.view === 'read') return;
        return void this.open(path!, { anchor: el.dataset.anchor });
      case 'evidence':
        this.closeMenus();
        return void this.open(path!, { line: Number(el.dataset.line) });
      case 'focus':
        this.focus = path!;
        this.drawMap();
        this.mapView!.focusCentre();
        return;
      case 'map':
        return void this.showMap();
      case 'index':
        return void (this.index
          ? this.indexMore()
          : this.discover().then(
              () => this.indexMore(),
              (err) => this.toast(problem(err).title),
            ));
      case 'stop-index':
        this.stopIndexing();
        return;
      case 'retry-list':
        if (this.source!.start.folder && !this.path) this.start();
        else this.toggleDocs(true);
        return;
      case 'heading':
        e.preventDefault();
        this.showAnchor(el.getAttribute('href')!.slice(1));
        return;
      case 'load-image':
        loadImage(el.parentElement!.nextElementSibling as HTMLImageElement);
        return;
      case 'load-images':
        for (const img of this.rendered!.content.querySelectorAll<HTMLImageElement>('img[data-mr-src]')) loadImage(img);
        el.remove();
        return;
      case 'zoom-diagram': {
        const zoom = this.q('.mr-repo-zoom');
        zoom.querySelector('img')!.src = el.querySelector('img')!.src;
        zoom.hidden = false;
        this.q('[data-act="close-zoom"]').focus();
        return;
      }
      case 'close-zoom':
        this.closeZoom();
        return;
      // ---- map lenses
      case 'lens':
        this.lens = el.dataset.lens as 'documents' | LensName;
        this.entityFocus = null;
        this.drawMap();
        this.q(`[data-act="lens"][data-lens="${this.lens}"]`).focus();
        return;
      case 'entity':
        this.entityFocus = id;
        this.drawMap();
        this.q('.mr-map-title').focus();
        return;
      case 'doc-map':
        this.lens = 'documents';
        this.focus = path!;
        this.drawMap();
        this.mapView!.focusCentre();
        return;
      case 'read-configs':
        return void this.readConfigs();
      case 'kind-folder': {
        const select = el.closest('.mr-map-kind')!.querySelector<HTMLSelectElement>('[data-act="kind"]')!;
        this.setKind(select.dataset.path!, select.value as DocKind, el.getAttribute('aria-checked') !== 'true');
        this.q('[data-act="kind-folder"]').focus();
        return;
      }
      case 'propose-about':
        el.setAttribute('aria-checked', String(el.getAttribute('aria-checked') !== 'true'));
        return;
      case 'remove-entity':
        notes.change((thinking) => {
          thinking.entities = thinking.entities.filter((entity) => entity.id !== id);
          thinking.relations = thinking.relations.filter((relation) => relation.from !== id && relation.to !== id);
          for (const note of thinking.notes) note.links = note.links.filter((link) => link !== id);
        });
        this.entityFocus = null;
        this.drawMap();
        return;
      case 'remove-relation': {
        const { from, to, label } = el.dataset;
        notes.change((thinking) => {
          thinking.relations = thinking.relations.filter((relation) => relation.from !== from || relation.to !== to || relation.label !== label);
        });
        this.drawMap();
        return;
      }
      case 'dismiss-since':
        this.previous = null;
        this.drawMap();
        return;
      // ---- notes
      case 'view-notes':
        this.showNotes();
        return;
      case 'note-here':
        this.showNotes();
        this.q('form[data-act="add-note"] textarea').focus();
        return;
      case 'save-notes':
        return void this.afterStore(notes.save(), 'Notes saved in this browser.');
      case 'delete-notes':
        this.confirmDelete = true;
        this.drawNotes();
        this.q('[data-act="confirm-delete-notes"]').focus();
        return;
      case 'confirm-delete-notes':
        this.confirmDelete = false;
        return void this.afterStore(notes.deleteAll(), 'Your notes for this repository are deleted.', () => {
          this.chosen.clear();
          this.anchorStates.clear();
          this.applyCorrections();
        });
      case 'cancel-delete-notes':
        this.confirmDelete = false;
        this.drawNotes();
        this.q('[data-act="delete-notes"]').focus();
        return;
      case 'recover':
        notes.recover();
        this.applyCorrections();
        this.drawNotes();
        this.toast('Your unsaved notes are back. Save to keep them.');
        void this.checkAnchors();
        return;
      case 'discard-draft':
        return void this.afterStore(notes.discard(), 'Unsaved notes discarded.');
      case 'reconfirm':
        return void this.reconfirm(id);
      case 'detach':
        this.anchorStates.delete(id);
        this.changeNote(id, (note) => {
          note.anchor = null;
        });
        return;
      case 'connect':
        this.connecting = id;
        this.drawNotes();
        this.q('[data-act="connect-note"]').focus();
        return;
      case 'cancel-connect':
        this.connecting = null;
        this.drawNotes();
        this.focusNote(id, 'connect');
        return;
      case 'disconnect':
        this.changeNote(id, (note) => {
          note.links = note.links.filter((link) => link !== el.dataset.link);
        });
        return;
      case 'edit-note':
        this.editing = id;
        this.drawNotes();
        this.q('form[data-act="save-note"] textarea').focus();
        return;
      case 'cancel-edit': {
        const editing = this.editing!;
        this.editing = null;
        this.drawNotes();
        this.focusNote(editing);
        return;
      }
      case 'delete-note':
        this.deleteNote(id);
        return;
      // ---- export
      case 'export':
        this.openExport();
        return;
      case 'choose-note':
        if (this.chosen.has(id)) this.chosen.delete(id);
        else this.chosen.add(id);
        this.drawExport();
        this.q(`[data-act="choose-note"][data-id="${CSS.escape(id)}"]`).focus();
        return;
      case 'export-format':
        this.exportFormat = el.dataset.format as 'markdown' | 'mermaid';
        this.drawExport();
        this.q(`[data-act="export-format"][data-format="${this.exportFormat}"]`).focus();
        return;
      case 'copy-export':
        void navigator.clipboard.writeText(this.exportText()).then(
          () => this.toast('Copied. Paste it where you choose.'),
          () => this.toast('Galley could not copy. Select the text and copy it instead.'),
        );
        return;
      case 'download-export':
        this.downloadExport();
        return;
      // ---- review
      case 'show-review':
        return void this.showReview();
      case 'smaller':
      case 'larger':
        this.update({ size: Math.min(TEXT_SIZES.length - 1, Math.max(0, this.settings.size + (el.dataset.act === 'larger' ? 1 : -1))) });
        return;
    }
  }

  protected onChange(e: Event): void {
    const el = e.target as HTMLInputElement;
    const id = el.dataset.id!;
    if (el.id === 'mr-typeface') {
      this.update({ font: el.value as Settings['font'] });
      return;
    }
    switch (el.dataset.act) {
      case 'kind': {
        const folderWide = el.closest('.mr-map-kind')!.querySelector('[data-act="kind-folder"]')?.getAttribute('aria-checked') === 'true';
        this.setKind(el.dataset.path!, el.value as DocKind, folderWide);
        this.q('[data-act="kind"]').focus();
        return;
      }
      case 'note-kind':
        // Only alternatives answer a question.
        el.closest('form')!.querySelector<HTMLElement>('.mr-note-group')!.hidden = el.value !== 'alternative';
        return;
      case 'entity-kind': {
        // The reader's own proposal changes; a declared or documented type stays visible beside theirs.
        const kind = el.value;
        this.notes!.change((thinking) => {
          const proposed = thinking.entities.find((entity) => entity.id === id);
          if (proposed) proposed.kind = kind;
          else
            thinking.entityKinds = [
              ...thinking.entityKinds.filter(([entity]) => entity !== id),
              ...(kind === el.dataset.original ? [] : [[id, kind] as [string, string]]),
            ];
        });
        this.drawMap();
        this.q('[data-act="entity-kind"]').focus();
        return;
      }
      case 'connect-note': {
        const to = el.value;
        this.connecting = null;
        this.changeNote(id, (note) => {
          note.links.push(to);
        });
        this.focusNote(id, 'connect');
        return;
      }
    }
  }

  protected onSubmit(e: SubmitEvent): void {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    switch (form.dataset.act) {
      case 'propose-entity':
        this.proposeEntity(form);
        return;
      case 'propose-relation':
        this.proposeRelation(form);
        return;
      case 'add-note':
        void this.addNote(form);
        return;
      case 'save-note':
        this.saveNote(form);
        return;
    }
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.closeSheet()) return;
      if (this.closeZoom()) {
        this.root.focus({ preventScroll: true });
        return;
      }
      const views = !this.q('.mr-repo-views').hidden;
      if (this.closeMenus()) {
        this.q(views ? '[data-act="views"]' : '[data-act="docs"]').focus({ preventScroll: true });
        return;
      }
      if (this.mapView?.closeSheet() || this.reviewMap?.closeSheet()) return;
      const attachment = this.shadow.querySelector<HTMLDetailsElement>('.mr-repo-read:not([hidden]) .mr-chapter-attachment[open]');
      if (attachment) {
        attachment.open = false;
        attachment.querySelector('summary')!.focus({ preventScroll: true });
        return;
      }
      this.close();
      return;
    }
    const sheet = this.openSheetEl();
    if (sheet && e.key === 'Tab') {
      // Focus stays inside an open sheet.
      const controls = [...sheet.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, [tabindex="0"]')].filter(
        (el) => el.getClientRects().length && !el.matches(':disabled'),
      );
      const at = controls.indexOf(this.shadow.activeElement as HTMLElement);
      controls[e.shiftKey ? (at <= 0 ? controls.length - 1 : at - 1) : (at + 1) % controls.length].focus();
      e.preventDefault();
      return;
    }
    // Over the page on a phone, a sheet keeps Tab inside it.
    if (this.mapSheet.onKey(e) || this.docSheet.onKey(e)) return;
    const target = e.composedPath()[0];
    const tab = target instanceof HTMLElement && target.matches('[data-settings-tab]') ? nextTab(SETTINGS_TABS, target.dataset.settingsTab!, e.key) : null;
    if (tab) {
      e.preventDefault();
      selectTab(this.settingsSheet, tab, true);
      return;
    }
    // In the search box, Alt/Option + arrows move the caret by word, and letters are typed.
    if (this.shadow.activeElement?.matches('input, select, textarea')) return;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      this.go(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if ((this.view === 'review' ? this.reviewMap : this.mapView)?.onKey(e)) return;
    // A phone's map sheet is modal too: shortcuts wait until it closes.
    if (sheet || this.mapSheet.isModal || this.docSheet.isModal) return;
    if (e.key === '/') {
      e.preventDefault();
      this.toggleDocs(true);
    } else if (e.key === ',' || e.key === '?') {
      e.preventDefault();
      this.openSettings(e.key === '?' ? 'keys' : 'reading');
    } else if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      this.layouts.next();
      this.arrangeLayout();
      this.toast(`Layout: ${LAYOUT_NAMES[this.layouts.value]}`);
    } else if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      if (!this.review) this.showSequence();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      if (this.view === 'map') this.q<HTMLElement>('[data-view="read"]').click();
      else void this.showMap();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      if (this.view === 'notes') this.q<HTMLElement>('[data-view="read"]').click();
      else this.showNotes();
    }
  }

  // ---------------------------------------------------------------- settings

  protected update(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    this.applySettings();
    if (patch.images === 'load' && this.rendered)
      for (const img of this.rendered.content.querySelectorAll<HTMLImageElement>('img[data-mr-src]')) loadImage(img);
    void updateSettings(patch);
  }

  protected applySettings(): void {
    const s = this.settings;
    const r = this.root;
    r.dataset.font = s.font;
    r.dataset.theme = s.theme;
    r.dataset.density = s.density;
    r.dataset.layout = this.layouts.value;
    r.classList.toggle('no-top-glow', !s.topGlow);
    r.classList.toggle('is-dark', s.appearance === 'dark' || (s.appearance === 'auto' && this.dark.matches));
    const text = TEXT_SIZES[s.size] ?? TEXT_SIZES[DEFAULT_SETTINGS.size];
    r.style.setProperty('--text-scale', String(Math.round((text / TEXT_SIZES[DEFAULT_SETTINGS.size]) * 1000) / 1000));
    r.style.setProperty('--body-size', `${text}px`);
    applyReadingControls(this.shadow, { ...s, layout: this.layouts.value });
    this.drawDiagrams();
  }

  protected drawDiagrams(): void {
    if (!this.rendered) return;
    const style = getComputedStyle(this.root);
    const palette = Object.fromEntries(PALETTE_KEYS.map((key) => [key, style.getPropertyValue(key === 'code' ? '--code-bg' : `--${key}`).trim()]));
    renderDiagrams(this.rendered.diagrams, this.root.classList.contains('is-dark'), () => {}, isPalette(palette) ? (palette as DiagramPalette) : undefined);
  }
}
