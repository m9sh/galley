import type { ReviewOverview } from '../../platforms/types.ts';
import { isSpecPath } from '../rendering/specs.ts';
import { h } from '../components/dom.ts';
import { platformLink, renderSnippet, type RenderedBlock } from '../rendering/render.ts';
import { readableText, revealContext, textRange } from '../rendering/reading.ts';
import type { SearchKind, SearchMatch, SearchScope, SearchTarget } from './search.ts';
import { type Draft, type Editor, FOCUS_LINE, type SearchAt, type SettingsTab, type View, blockAt, hasDraft, placeName, surfaceOf } from './reader-shared.ts';
import { ReaderChrome } from './reader-chrome.ts';

/** Stepping through changes and threads, and searching the review. */
export abstract class ReaderSearch extends ReaderChrome {
  // ---------------------------------------------------------------- navigation

  /** `glide` scrolls smoothly unless reduced motion asks otherwise; search jumps, as find in a browser does. */
  protected scrollToEl(el: Element, line = FOCUS_LINE, flash = true, glide = true): void {
    const top = this.root.scrollTop + el.getBoundingClientRect().top - this.root.clientHeight * line;
    const smooth = glide && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.root.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
    if (flash) this.flash(el);
  }

  /** Point something out once: a short tint that fades (components/styles/). */
  protected flash(el: Element): void {
    el.classList.remove('mr-flash');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('mr-flash');
    setTimeout(() => el.classList.remove('mr-flash'), 1700);
  }

  protected visibleChanges(): HTMLElement[] {
    return this.views.flatMap((view) => view.rendered?.changes ?? []).filter((el) => el.getClientRects().length > 0);
  }

  protected step(direction: 1 | -1): void {
    const target = this.nextOf(this.visibleChanges(), direction);
    if (target) this.scrollToEl(target);
  }

  /** Conversations in reading order, by the text they discuss. */
  protected visibleThreads(): Array<{ anchor: HTMLElement; card: HTMLElement }> {
    return this.threadEls
      .filter(({ card, anchor }) => !card.hidden && anchor.getClientRects().length > 0)
      .map(({ card, anchor }) => ({ card, anchor, top: anchor.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top)
      .map(({ card, anchor }) => ({ card, anchor }));
  }

  /** N and P: bring the next or previous conversation level with the focus line, and point it out. */
  protected stepThread(direction: 1 | -1): void {
    const threads = this.visibleThreads();
    if (!threads.length) {
      this.toast('No conversations in this review yet');
      return;
    }
    // Several conversations can share one paragraph, so the list holds cards, positioned by their text.
    const cards = threads.map((thread) => thread.card);
    const tops = new Map(threads.map((thread) => [thread.card, thread.anchor.getBoundingClientRect().top]));
    const card = this.nextOf(cards, direction, (el) => tops.get(el)!);
    if (!card) {
      this.toast(direction === 1 ? 'No more conversations below' : 'No more conversations above');
      return;
    }
    this.scrollToEl(threads.find((thread) => thread.card === card)!.anchor, FOCUS_LINE, false);
    this.flash(card);
  }

  /** The next element in reading order after the focus line, or the one before it. */
  protected nextOf(list: HTMLElement[], direction: 1 | -1, topOf = (el: HTMLElement) => el.getBoundingClientRect().top): HTMLElement | undefined {
    if (!list.length) return undefined;
    let index: number;
    const recent = this.lastStep && performance.now() - this.lastStep.at < 900 ? list.indexOf(this.lastStep.el) : -1;
    if (recent !== -1) {
      // Pressed again while still scrolling: continue from the last target, not from mid-scroll positions.
      index = recent + direction;
    } else {
      const line = this.root.clientHeight * FOCUS_LINE;
      const tops = list.map(topOf);
      index = direction === 1 ? tops.findIndex((t) => t > line + 8) : tops.findLastIndex((t) => t < line - 8);
    }
    const target = list[index];
    if (target) this.lastStep = { el: target, at: performance.now() };
    return target;
  }

  /** The settings sheet, open at one of its tabs. */
  protected openSettings(tab: SettingsTab): void {
    this.selectSettingsTab(tab);
    // Shortcuts are ignored while the sheet is open, so it is always closed here.
    this.toggleMenu(this.el.settings, this.shadow.querySelector<HTMLElement>('[data-act="settings"]'));
    this.palettes.reveal(this.settings.theme);
  }

  /** A first document of the request's own title, author and description, folded under its title on demand. */
  protected renderOverview(overview: ReviewOverview): HTMLElement {
    const section = h('section', 'mr-document mr-overview');
    section.setAttribute('aria-label', `${overview.kind} description`);
    section.hidden = !this.settings.overview;
    const byline = h('div', 'mr-byline');
    if (overview.author) byline.append(h('span', 'mr-overview-author', `Opened by ${overview.author}`));
    const href = platformLink(overview.url, location.origin);
    if (href) {
      const link = h('a', 'mr-overview-link', `Open on ${new URL(href, location.href).host}`);
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      byline.append(link);
    }
    const body = h('details', 'mr-overview-body');
    body.open = true;
    const content = h('div', 'mr-content');
    if (overview.description.trim()) content.append(renderSnippet(document, overview.description, location.origin, this.settings.images));
    else content.append(h('p', 'mr-overview-empty', 'No description was added to this request.'));
    body.append(h('summary', '', 'Description'), content);
    section.append(h('p', 'mr-overview-kind', overview.kind), h('h1', 'mr-title', overview.title), byline, body);
    return section;
  }

  protected stepDoc(direction: 1 | -1): void {
    const indices = this.views.flatMap((view, i) => (view.section.hidden ? [] : [i]));
    const next = indices[indices.indexOf(this.index) + direction];
    if (next !== undefined) this.show(next);
  }

  // ---------------------------------------------------------------- search

  /** Everything search reads without loading anything, in reading order: the description, then each file with its comments and drafts. */
  protected *searchTargets(): Generator<SearchTarget<SearchAt>> {
    if (this.overview && !this.overview.hidden && this.source!.overview!.description.trim()) {
      const el = this.overview.querySelector<HTMLElement>('.mr-content')!;
      yield {
        kind: 'description',
        path: null,
        place: '',
        version: null,
        changed: true,
        text: readableText(el).text,
        at: { type: 'text', view: null, el, card: null },
      };
    }
    for (const view of this.views) {
      if (view.section.hidden || view.failed) continue;
      const kind: SearchKind = view.doc.kind !== 'code' ? 'document' : isSpecPath(view.doc.path) ? 'test' : 'code';
      if (view.rendered) yield* this.blockTargets(view, kind);
      else if (view.quiet) yield* this.lineTargets(view, kind);
      yield* this.commentTargets(view);
    }
  }

  /** Each block in the versions it has: a match in text both versions share is reported once, in the new one. */
  protected *blockTargets(view: View, kind: SearchKind): Generator<SearchTarget<SearchAt>> {
    const r = view.rendered!;
    let heading = '';
    for (const block of r.blocks) {
      // Code comments are read in the view Reading settings → Review shows; the other view holds the same lines.
      if (block.el.closest('[data-mr-comment-view][hidden]')) continue;
      const target = (side: 'base' | 'head', version: 'old' | 'new' | null, text: string, alsoNew?: string): SearchTarget<SearchAt> => {
        const line = block[side]!.lines[0] + 1;
        return {
          kind,
          path: view.doc.path,
          place: r.isCode ? placeName(side, line, line) : heading,
          version,
          changed: block.kind !== 'same',
          text,
          alsoNew,
          at: { type: 'block', view, block, side },
        };
      };
      const head = block.head ? readableText(block.el, 'head').text : '';
      // The nearest heading above, as the page shows it: a deleted document keeps its old headings.
      if (!r.isCode && (block.head ?? block.base)!.kind === 'heading') heading = (block.head ? head : readableText(block.el, 'base').text).trim();
      if (block.kind === 'removed') yield target('base', 'old', readableText(block.el, 'base').text);
      else if (block.kind === 'same') yield target('head', null, head);
      else {
        yield target('head', 'new', head);
        if (block.kind === 'modified') yield target('base', 'old', readableText(block.el, 'base').text, head);
      }
    }
  }

  /** A folded file that has not been shown is searched in its source lines; a line in only one version says which. */
  protected *lineTargets(view: View, kind: SearchKind): Generator<SearchTarget<SearchAt>> {
    const { base, head } = this.contentsOf.get(view.doc)!;
    const before = base.split('\n');
    const after = head.split('\n');
    const inBefore = new Set(before);
    const inAfter = new Set(after);
    const target = (side: 'base' | 'head', line: number, text: string, version: 'old' | 'new' | null): SearchTarget<SearchAt> => ({
      kind,
      path: view.doc.path,
      place: placeName(side, line, line),
      version,
      changed: version !== null,
      text,
      at: { type: 'line', view, side, line },
    });
    for (const [i, text] of after.entries()) yield target('head', i + 1, text, inBefore.has(text) ? null : 'new');
    for (const [i, text] of before.entries()) if (!inAfter.has(text)) yield target('base', i + 1, text, 'old');
  }

  /** Comments on the file, each on its own, then the reviewer's unsent drafts, which only they can see. */
  protected *commentTargets(view: View): Generator<SearchTarget<SearchAt>> {
    for (const card of this.searchCards(view)) {
      const thread = this.threadByCard.get(card)!;
      for (const item of card.querySelectorAll<HTMLElement>('.mr-thread-comment')) {
        const el = item.querySelector<HTMLElement>('.mr-thread-body')!;
        const author = item.querySelector('.mr-thread-author')!.textContent;
        yield {
          kind: 'comment',
          path: view.doc.path,
          place: thread.line === null ? `${author} · on the file` : `${author} · ${placeName(thread.side, thread.line, thread.line)}`,
          version: null,
          changed: true,
          text: readableText(el).text,
          at: { type: 'text', view, el, card },
        };
      }
    }
    for (const editor of this.searchDrafts(view))
      yield {
        kind: 'draft',
        path: view.doc.path,
        place:
          'thread' in editor
            ? 'Your reply'
            : `Your comment · ${placeName((editor as Draft).target.side, (editor as Draft).target.startLine, (editor as Draft).target.endLine)}`,
        version: null,
        changed: true,
        text: editor.textarea.value,
        at: { type: 'draft', editor },
      };
  }

  protected searchCards(view: View): HTMLElement[] {
    return [
      ...view.section.querySelectorAll<HTMLElement>('.mr-file-threads .mr-thread'),
      ...this.threadEls.filter((entry) => entry.view === view).map((entry) => entry.card),
    ];
  }

  protected searchDrafts(view: View): Editor[] {
    const replies = [...this.replyEditors.values()].filter((editor) => editor.thread.doc === view.doc);
    return [...this.drafts.filter((draft) => draft.view === view), ...replies].filter((editor) => hasDraft(editor));
  }

  /** What search covers, and what it cannot: code files left off, files still loading and files that failed. */
  protected searchScope(): SearchScope {
    const visible = this.views.filter((view) => !view.section.hidden);
    const searched = visible.filter((view) => !view.failed && (view.rendered || view.quiet));
    return {
      files: searched.length,
      comments: searched.reduce((sum, view) => sum + this.searchCards(view).reduce((n, card) => n + card.querySelectorAll('.mr-thread-comment').length, 0), 0),
      drafts: searched.reduce((sum, view) => sum + this.searchDrafts(view).length, 0),
      code: this.views.length - visible.length,
      loading: visible.filter((view) => !view.failed && !view.rendered && !view.quiet).length,
      failed: visible.filter((view) => view.failed).length,
    };
  }

  /** Show a result where it is: open what folds it, mark the words and move focus there. Viewed never changes. */
  protected async revealMatch({ target, start, end }: SearchMatch<SearchAt>): Promise<void> {
    const at = target.at;
    if (at.type === 'draft') {
      this.focusEditor(at.editor);
      at.editor.textarea.setSelectionRange(start, end);
      return;
    }
    if (at.view?.folded) this.unfoldView(at.view);
    if (at.type === 'text') {
      const card = at.card;
      if (card) {
        if (at.el.closest('.is-folded') && !card.classList.contains('is-expanded')) card.querySelector<HTMLElement>('[data-act="toggle-thread"]')!.click();
        this.scrollToEl(this.threadEls.find((entry) => entry.card === card)?.anchor ?? card, FOCUS_LINE, false, false);
        this.flash(card);
      } else {
        at.el.closest('details')!.open = true;
        this.scrollToEl(at.el, FOCUS_LINE, true, false);
      }
      this.markFound(at.el, undefined, start, end);
      const focus = card ?? at.el;
      focus.tabIndex = -1;
      focus.focus({ preventScroll: true });
      return;
    }
    if (at.type === 'block') {
      this.revealBlock(at.view, at.block, at.side, [start, end]);
      return;
    }
    const view = at.view;
    if (!view.rendered) await this.openQuiet(this.views.indexOf(view));
    const r = view.rendered;
    const block = r && blockAt(r, at.side, at.line);
    // The file could not be shown after all and says why, or no block shows the line (an HTML comment): go to the file.
    if (!block) {
      this.scrollToEl(view.section, 0.12, false, false);
      view.section.tabIndex = -1;
      view.section.focus({ preventScroll: true });
      return;
    }
    // A source line reads as its source. A document's block shows its line rendered: find the words again there.
    const words = target.text.slice(start, end);
    const from = r!.isCode ? start : readableText(block.el, at.side).text.toLowerCase().indexOf(words.toLowerCase());
    this.revealBlock(view, block, at.side, from < 0 ? null : [from, from + words.length]);
  }

  protected revealBlock(view: View, block: RenderedBlock, side: 'base' | 'head', span: [number, number] | null): void {
    const r = view.rendered!;
    if (block.el.hidden) revealContext(r, block.el);
    const section = block.el.closest('.mr-spec-section');
    if (section?.classList.contains('is-collapsed')) section.querySelector<HTMLElement>('.mr-spec-toggle')!.click();
    // A test plan shows a found line even when it is setup it would otherwise leave out.
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-mr-found]')) delete el.dataset.mrFound;
    block.el.dataset.mrFound = '';
    if (side === 'base' && view.doc.status !== 'removed' && this.settings.mode === 'clean') {
      this.update({ mode: 'changes' });
      this.toast('Change marks are on, to show the old version');
    }
    this.schedule(true);
    this.scrollToEl(surfaceOf(block.el), FOCUS_LINE, true, false);
    if (span) this.markFound(block.el, side, ...span);
    block.el.tabIndex = -1;
    block.el.focus({ preventScroll: true });
  }

  /** Mark the found words. Syntax colours can arrive after a file is shown and replace its text: mark them again then. */
  protected markFound(el: HTMLElement, side: 'base' | 'head' | undefined, start: number, end: number): void {
    this.unmark();
    const highlights = typeof Highlight === 'function' && CSS.highlights;
    if (!highlights) return;
    const mark = () => highlights.set('galley-search', new Highlight(textRange(el, side, start, end)));
    mark();
    this.found = new MutationObserver(mark);
    this.found.observe(el, { childList: true, subtree: true, characterData: true });
  }

  protected unmark(): void {
    this.found?.disconnect();
    this.found = null;
    CSS.highlights?.delete('galley-search');
  }

  /** A wide window keeps the wide layout unless a sheet beside the review leaves it less room than that needs. */
  protected fitWidth(): void {
    this.root.classList.toggle('is-narrowed', innerWidth >= 1280 && this.root.offsetWidth < 1280);
  }

  /** Change the reader's width and keep the paragraph at the top of the view where it was. */
  protected reflow(change: () => void): void {
    const top = this.root.getBoundingClientRect().top + 72;
    const anchor = [...this.root.querySelectorAll<HTMLElement>('.mr-main [data-mr-u]')].find((el) => el.getBoundingClientRect().bottom > top);
    const before = anchor?.getBoundingClientRect().top;
    change();
    this.fitWidth();
    if (anchor) this.root.scrollTop += anchor.getBoundingClientRect().top - before!;
    this.schedule(true);
  }

  /** Where the reader was before searching: the file in view, how far into it, and what had focus. */
  protected rememberPlace(): () => void {
    const view = this.views[this.index];
    const offset = this.root.getBoundingClientRect().top - view.section.getBoundingClientRect().top;
    const focus = this.shadow.activeElement as HTMLElement | null;
    return () => {
      // An instant scroll also stops one still running towards the result.
      const top = this.root.scrollTop + view.section.getBoundingClientRect().top - this.root.getBoundingClientRect().top + offset;
      this.root.scrollTo({ top, behavior: 'instant' });
      (focus?.isConnected ? focus : this.root).focus({ preventScroll: true });
    };
  }
}
