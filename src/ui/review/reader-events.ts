import { LAYOUT_NAMES } from '../components/layout-controls.ts';
import { DEFAULT_SETTINGS, LAYOUTS, TEXT_SIZES, type Settings } from '../preferences/settings.ts';
import { nextTab } from '../components/settings-sheet.ts';
import { type Draft, type ReplyEditor, SETTINGS_TABS, type SettingKey, type SettingsTab, hasDraft } from './reader-shared.ts';
import { ReaderSearch } from './reader-search.ts';

/** Keyboard, clicks, and pointer and hover handling. */
export abstract class ReaderEvents extends ReaderSearch {
  protected onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    if (this.chapters.onKey(e) || this.search.onKey(e)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.closeLightbox() || this.closeMenus() || this.search.closeBar()) return;
      // A draft is only ever discarded with Cancel. Esc leaves an editor, and closes it when it is empty.
      const editor = this.editorAt(this.shadow.activeElement);
      if (editor) {
        if (editor.busy) return;
        if (!hasDraft(editor)) {
          if ('thread' in editor) this.closeReply((editor as ReplyEditor).thread);
          else this.closeDraft(editor as Draft);
          return;
        }
        editor.status.textContent = 'Draft kept. Cancel discards it.';
        this.root.focus({ preventScroll: true });
        return;
      }
      if (!this.el.chip.hidden) {
        this.hideChip();
        return;
      }
      const unsent = [...this.drafts, ...this.replyEditors.values()].find((item) => hasDraft(item) && item.form.isConnected && !item.form.closest('[hidden]'));
      if (unsent) {
        this.toast('You have an unsent comment. Post it, or choose Cancel to discard it.');
        this.focusEditor(unsent);
        return;
      }
      this.close();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      const editor = this.editorAt(e.composedPath()[0]);
      if (editor) {
        e.preventDefault();
        editor.send();
        return;
      }
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.composedPath()[0];
    const tab = target instanceof HTMLElement && target.matches('[data-settings-tab]') ? nextTab(SETTINGS_TABS, target.dataset.settingsTab!, e.key) : null;
    if (tab) {
      e.preventDefault();
      this.selectSettingsTab(tab as SettingsTab, true);
      return;
    }
    if (e.key === 'Tab') {
      const focusRoot = !this.el.lightbox.hidden ? this.el.lightbox : this.el.settings.hidden ? this.root : this.el.settings;
      const controls = [...focusRoot.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, summary, [tabindex="0"]')].filter(
        (el) => el.getClientRects().length && !el.matches(':disabled, [tabindex="-1"]'),
      );
      const index = controls.indexOf(this.shadow.activeElement as HTMLElement);
      const next = e.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length;
      controls[next]?.focus();
      e.preventDefault();
      return;
    }
    if (!this.el.lightbox.hidden) {
      const step = 80;
      const keys: Record<string, () => void> = {
        '+': () => this.zoomDiagram(1.25),
        '=': () => this.zoomDiagram(1.25),
        '-': () => this.zoomDiagram(0.8),
        '0': () => this.fitDiagram(),
        ArrowLeft: () => this.moveDiagram(step, 0),
        ArrowRight: () => this.moveDiagram(-step, 0),
        ArrowUp: () => this.moveDiagram(0, step),
        ArrowDown: () => this.moveDiagram(0, -step),
      };
      if (keys[e.key]) {
        e.preventDefault();
        keys[e.key]();
      }
      return;
    }
    if (!this.el.settings.hidden) return;
    if (target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable]')) return;
    switch (e.key) {
      case 'm':
        this.chapters.open();
        break;
      case 'j':
        this.step(1);
        break;
      case 'k':
        this.step(-1);
        break;
      case 'n':
        this.stepThread(1);
        break;
      case 'p':
        this.stepThread(-1);
        break;
      case '/':
        if (this.views.length) this.search.open();
        break;
      case 'f': {
        const button = this.shadow.querySelector<HTMLElement>('[data-act="files"]');
        if (button && !button.hidden && this.views.some((view) => !view.section.hidden)) this.toggleMenu(this.el.files, button);
        break;
      }
      case 'a':
        this.update({ scope: this.settings.scope === 'changed' ? 'all' : 'changed' });
        this.toast(this.settings.scope === 'all' ? 'Whole files' : 'Changed parts');
        break;
      case 'l': {
        const layout = LAYOUTS[(LAYOUTS.indexOf(this.settings.layout) + 1) % LAYOUTS.length];
        this.update({ layout });
        this.toast(`Layout: ${LAYOUT_NAMES[layout]}`);
        break;
      }
      case 'd':
        this.update({ density: this.settings.density === 'compact' ? 'comfortable' : 'compact' });
        this.toast(this.settings.density === 'compact' ? 'Compact' : 'Comfortable');
        break;
      case '0':
        this.update({ size: DEFAULT_SETTINGS.size });
        break;
      case ',':
        this.openSettings('reading');
        break;
      case '?':
        this.openSettings('keys');
        break;
      case ']':
        this.stepDoc(1);
        break;
      case '[':
        this.stepDoc(-1);
        break;
      case 'c':
        this.update({ mode: this.settings.mode === 'changes' ? 'clean' : 'changes' });
        break;
      case 'v':
        if (!this.el.viewed.hidden && !(this.el.viewed as HTMLButtonElement).disabled) void this.toggleViewed(this.index);
        break;
      case 'r':
        this.commentHere();
        break;
      case '+':
      case '=':
        this.update({ size: Math.min(TEXT_SIZES.length - 1, this.settings.size + 1) });
        break;
      case '-':
        this.update({ size: Math.max(0, this.settings.size - 1) });
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  protected onClick(e: MouseEvent): void {
    const target = e.target as Element;
    const inMenu = target.closest('.mr-menu, .mr-settings, [data-act="files"], [data-act="settings"], [data-act="search"]');
    if (!inMenu) this.closeMenus();

    const settingsTab = target.closest<HTMLElement>('[data-settings-tab]');
    if (settingsTab) {
      this.selectSettingsTab(settingsTab.dataset.settingsTab as SettingsTab);
      return;
    }

    const anchor = target.closest<HTMLAnchorElement>('.mr-content a[href^="#"]');
    if (anchor) {
      e.preventDefault();
      const id = decodeURIComponent(anchor.getAttribute('href')!.slice(1));
      const content = anchor.closest('.mr-content');
      const dest = id ? [...content!.querySelectorAll('[id]')].find((el) => el.id === id || el.id === `user-content-${id}`) : undefined;
      if (dest?.closest('[hidden]')) this.update({ scope: 'all' });
      if (dest) this.scrollToEl(dest, 0.12);
      return;
    }

    const scope = target.closest<HTMLElement>('[data-scope]');
    if (scope) {
      this.update({ scope: scope.dataset.scope as Settings['scope'] });
      return;
    }
    const mode = target.closest<HTMLElement>('[data-mode]');
    if (mode) {
      this.update({ mode: mode.dataset.mode as Settings['mode'] });
      return;
    }
    const setting = target.closest<HTMLElement>('[data-setting] [data-value]');
    if (setting) {
      const key = setting.closest<HTMLElement>('[data-setting]')!.dataset.setting as SettingKey;
      this.update({ [key]: setting.dataset.value } as Partial<Settings>);
      return;
    }

    const action = target.closest<HTMLElement>('[data-act]');
    if (!action) return;
    switch (action.dataset.act) {
      case 'close':
        this.close();
        return;
      case 'files':
        if (this.views.some((view) => !view.section.hidden)) this.toggleMenu(this.el.files, action);
        return;
      case 'search':
        // From the files menu, closing search gives focus to the file name that opened the menu.
        if (action.closest('.mr-files')) this.el.fileBtn.focus({ preventScroll: true });
        this.search.toggle();
        return;
      case 'settings':
        if (this.source && !this.views.some((view) => !view.section.hidden)) this.selectSettingsTab('review');
        this.toggleMenu(this.el.settings, action);
        if (!this.el.settings.hidden) this.palettes.reveal(this.settings.theme);
        return;
      case 'palette-prev':
      case 'palette-next':
      case 'palette-page':
        this.palettes.onClick(action.dataset.act, action);
        return;
      case 'overview':
        if (!this.source?.overview) return;
        this.update({ overview: !this.settings.overview });
        if (this.settings.overview) this.root.scrollTo({ top: 0 });
        return;
      case 'code-files':
        if (!this.settings.codeFiles && !this.source?.codeDocs?.length) return;
        this.update({ codeFiles: !this.settings.codeFiles });
        return;
      case 'signs':
        this.update({ signs: !this.settings.signs });
        return;
      case 'top-glow':
        this.update({ topGlow: !this.settings.topGlow });
        return;
      case 'zoom-diagram':
        this.openLightbox(action);
        return;
      case 'diagram-sides': {
        const open = action.closest('.mr-diagram')!.classList.toggle('is-sides');
        action.setAttribute('aria-expanded', String(open));
        action.textContent = open ? 'Hide before and after' : 'Show before and after';
        this.schedule(true);
        return;
      }
      case 'close-lightbox':
        this.closeLightbox();
        return;
      case 'zoom-in':
        this.zoomDiagram(1.25);
        return;
      case 'zoom-out':
        this.zoomDiagram(0.8);
        return;
      case 'zoom-fit':
        this.fitDiagram();
        return;
      case 'close-settings':
        this.closeMenus();
        return;
      case 'viewed':
        void this.toggleViewed(Number(action.dataset.doc));
        return;
      case 'viewed-file':
        void this.toggleViewed(this.views.findIndex((view) => view.section.contains(action)));
        return;
      case 'smaller':
        this.update({ size: Math.max(0, this.settings.size - 1) });
        return;
      case 'larger':
        this.update({ size: Math.min(TEXT_SIZES.length - 1, this.settings.size + 1) });
        return;
      case 'prev':
        this.step(-1);
        return;
      case 'next':
        this.step(1);
        return;
      case 'doc':
        void this.show(Number(action.dataset.doc));
        return;
      case 'retry-doc':
        void this.loadView(this.views.findIndex((view) => view.section.contains(action)));
        return;
      case 'show-quiet': {
        const index = this.views.findIndex((view) => view.section.contains(action));
        if (this.views[index].folded) this.unfoldView(this.views[index]);
        else void this.openQuiet(index);
        return;
      }
      case 'fold-file':
        this.foldView(this.views.find((view) => view.section.contains(action))!);
        return;
      case 'fold':
        this.update({ fold: !this.settings.fold });
        return;
      case 'resume':
        this.continueReading();
        return;
      case 'dismiss-resume':
        this.el.resume.hidden = true;
        return;
      case 'comment-block':
        this.commentOn(this.hover!);
        return;
      case 'comment-selection':
        this.startComment(this.chipTarget!.target, this.chipTarget!.elements, this.chipTarget!.range);
        return;
      case 'reply-to': {
        this.openReply(this.threadByCard.get(action.closest('.mr-thread')!)!, Number(action.dataset.comment));
        return;
      }
      case 'load-image': {
        this.loadImages(action.closest('.mr-img-hold')!.parentElement!);
        return;
      }
      case 'load-images':
        this.loadImages(action.closest('.mr-document')!);
        return;
      case 'toggle-thread': {
        const card = action.closest('.mr-thread')!;
        card.classList.toggle('is-expanded');
        action.textContent = card.classList.contains('is-expanded') ? 'Show fewer replies' : action.dataset.label!;
        this.schedule(true);
        return;
      }
      case 'heading': {
        e.preventDefault();
        this.scrollToEl(this.headings[Number(action.dataset.i)].el, 0.12, false);
        return;
      }
      case 'mark': {
        this.scrollToEl(this.markTargets[Number(action.dataset.i)]);
        return;
      }
    }
  }
}
