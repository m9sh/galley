import { h } from '../components/dom.ts';
import { twin, type SheetContent } from '../components/sheet.ts';
import { when } from './project-store.ts';
import { sequenceSheet } from './reading-sequence.ts';
import { notesSheet } from './repo-views.ts';
import { type Panel, shortSha, typed } from './repo-reader-shared.ts';
import { RepoReaderLenses } from './repo-reader-lenses.ts';

/**
 * Chapters and Notes in the reader's sheet, beside the map or the document, as Chapters and the Library sit beside a
 * review: one sheet, which shows either of them or the details of a place chosen on a map. Chapters and Notes in the
 * top bar open it and close it; a switch at its head goes between the two.
 */
export abstract class RepoReaderPanels extends RepoReaderLenses {
  /** Chapters | Notes, at the head of the sheet. Opened from a review there are no library chapters, and no switch. */
  protected readonly tabs = this.panelTabs();

  private panelTabs(): HTMLElement {
    const group = h('div', 'mr-sheet-tabs');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Show in this sheet');
    for (const [panel, label] of [
      ['chapters', 'Chapters'],
      ['notes', 'Notes'],
    ] as const) {
      const tab = h('button', 'mr-sheet-tab', label);
      tab.type = 'button';
      tab.dataset.act = 'panel-tab';
      tab.dataset.panel = panel;
      group.append(tab);
    }
    return group;
  }

  /** Chapters, Notes, C and N open the sheet at that panel, and close it when it shows that panel already. */
  protected togglePanel(panel: Panel): void {
    if (this.panel === panel) this.closePanel();
    else this.openPanel(panel);
  }

  /** Show a panel in the sheet, in place of whatever it shows; the sheet takes focus, unless the switch had it. */
  protected openPanel(panel: Panel): void {
    if (!this.notes) return;
    this.closeMenus();
    if (!this.panel) {
      const active = this.shadow.activeElement;
      this.panelOpener = active instanceof HTMLElement && !this.sheet.element.contains(active) ? active : null;
    }
    const switching = this.tabs.contains(this.shadow.activeElement);
    // The map's details give the sheet up; they are not drawn again until a place is chosen.
    this.mapView?.release();
    this.reviewMap?.release();
    this.panel = panel;
    this.sheet.element.classList.remove('mr-map-sheet');
    this.fillPanel();
    this.sheet.show();
    if (switching) this.tabs.querySelector<HTMLElement>(`[data-panel="${panel}"]`)!.focus({ preventScroll: true });
    else this.sheet.root.element.focus({ preventScroll: true });
    if (panel === 'notes') void this.checkAnchors();
  }

  /** Close Chapters or Notes, and give focus back to what opened them. False when neither is shown. */
  protected closePanel(): boolean {
    if (!this.panel) return false;
    this.panel = null;
    this.markPanel();
    this.sheet.hide();
    const opener = this.panelOpener?.isConnected && !this.panelOpener.closest('[hidden]') ? this.panelOpener : this.root;
    opener.focus({ preventScroll: true });
    return true;
  }

  /** Close, the backdrop or Esc on the first sheet: Chapters or Notes close, or else the details of the map shown. */
  protected dismissSheet(): void {
    if (this.closePanel()) return;
    (this.view === 'review' ? this.reviewMap : this.mapView)!.closeSheet();
  }

  /** A place chosen on a map takes the sheet for its details. */
  protected claimSheet(): void {
    this.panel = null;
    this.sheet.element.classList.add('mr-map-sheet');
    this.markPanel();
  }

  /** Draw the panel shown again, after what it shows changed, keeping what the reader typed and where focus was. */
  protected drawPanel(): void {
    if (!this.panel) return;
    const active = this.shadow.activeElement;
    const inside = active instanceof HTMLElement && this.sheet.element.contains(active) ? active : null;
    const restore = typed(this.sheet.element);
    this.fillPanel();
    restore();
    const now = this.shadow.activeElement;
    if (inside && !(now instanceof HTMLElement && this.sheet.element.contains(now)))
      (twin(this.sheet.element, inside) ?? this.sheet.root.element).focus({ preventScroll: true });
  }

  protected drawNotes(): void {
    if (this.panel === 'notes') this.drawPanel();
  }

  private fillPanel(): void {
    this.sheet.fill(this.panel === 'chapters' ? this.chaptersContent() : this.notesContent());
    this.markPanel();
  }

  private chaptersContent(): SheetContent {
    return {
      label: 'Chapters',
      lead: [this.tabs],
      ...sequenceSheet({
        items: this.sequence.items,
        current: this.sequence.current(this.path, this.readingAnchor),
        commit: shortSha(this.source!.commit),
        from: this.path,
        links: this.sequenceLinks(),
      }),
    };
  }

  private notesContent(): SheetContent {
    const notes = this.notes!;
    return {
      label: 'Notes',
      lead: this.review ? [h('h2', 'mr-sheet-heading', 'Notes')] : [this.tabs],
      ...notesSheet({
        notes: notes.thinking.notes,
        state: notes.state,
        dirty: notes.dirty,
        error: notes.error,
        recovery: notes.offer ? { at: when(notes.offer.at) } : null,
        confirmDelete: this.confirmDelete,
        anchors: [...this.anchorOptions()].map(([value, option]) => ({ value, label: option.label })),
        anchorStates: this.anchorStates,
        targets: this.targets(),
        editing: this.editing,
        connecting: this.connecting,
      }),
    };
  }

  /** Which panel the sheet shows, on its switch and on the top bar's Chapters and Notes. */
  private markPanel(): void {
    for (const control of this.shadow.querySelectorAll<HTMLElement>('.mr-repo-panel'))
      control.setAttribute('aria-expanded', String(control.dataset.panel === this.panel));
    for (const tab of this.tabs.querySelectorAll<HTMLElement>('[data-panel]')) tab.setAttribute('aria-pressed', String(tab.dataset.panel === this.panel));
  }
}
