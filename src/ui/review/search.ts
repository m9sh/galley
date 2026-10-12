import { excerpt, occurrences, phrase, SEARCH_BUDGET } from '../../core/search.ts';
import { h } from '../components/dom.ts';
import { icons } from '../components/icons.ts';

/** What a result is: file text, a comment from the review, or something only the reviewer can see. */
export type SearchKind = 'document' | 'code' | 'test' | 'comment' | 'draft' | 'description';

/** One place text can be found: a block of one version of a file, a comment, a draft or the description. */
export interface SearchTarget<T> {
  kind: SearchKind;
  /** The file it belongs to; null for the request's description. */
  path: string | null;
  /** Where it is in that file: a heading, a line, or who wrote it. */
  place: string;
  /** The version of the file the text is in; null when both versions have it. */
  version: 'old' | 'new' | null;
  /** Text this review changed. Comments, drafts and the description count as changed. */
  changed: boolean;
  text: string;
  /** The same block's other version: a match in both is reported once, in the new version. */
  alsoNew?: string;
  /** Where the reader finds this text again, to show it. */
  at: T;
}

export interface SearchMatch<T> {
  target: SearchTarget<T>;
  start: number;
  end: number;
}

/** What was searched, and what was not, so no matches is never mistaken for nothing there. */
export interface SearchScope {
  files: number;
  comments: number;
  drafts: number;
  /** Code files are not loaded while Code files is off, so they are not searched. */
  code: number;
  loading: number;
  failed: number;
}

export interface SearchOptions<T> {
  /** Where the popup and the results bar live. */
  root: HTMLElement;
  toggle: HTMLButtonElement;
  beforeOpen(): void;
  targets(): Iterable<SearchTarget<T>>;
  scope(): SearchScope;
  /** Show a result in its real context, mark it and move focus to it. */
  reveal(match: SearchMatch<T>): Promise<void>;
  /** Remember the reading place before searching; the function returns to it. */
  remember(): () => void;
  /** The reader is done with the results: unmark them. */
  forget(): void;
  /** The reviewer's explicit choice to load and search code files. */
  showCode(): void;
}

const FILTERS = [
  ['all', 'All'],
  ['document', 'Documents'],
  ['code', 'Code'],
  ['comment', 'Comments'],
  ['draft', 'Your drafts'],
] as const;
type Filter = (typeof FILTERS)[number][0];
const FILTER_OF: Record<SearchKind, Exclude<Filter, 'all'>> = {
  document: 'document',
  description: 'document',
  code: 'code',
  test: 'code',
  comment: 'comment',
  draft: 'draft',
};
const TAG: Record<SearchKind, string> = {
  document: 'Document',
  description: 'Description',
  code: 'Code',
  test: 'Test',
  comment: 'Comment',
  draft: 'Your draft',
};

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

function control(label: string, className: string, action: () => void): HTMLButtonElement {
  const button = h('button', className, label);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}

/**
 * Search across a review (RFC 0045): exact phrases in what the reader already has, folded or not, listed in a
 * popup under the top bar. Choosing a result shows it where it is; a bar steps through the rest and goes back.
 */
export class ReviewSearch<T> {
  private readonly panel = h('div', 'mr-menu mr-search');
  private readonly field = h('input', 'mr-search-field');
  private readonly filters = h('div', 'mr-search-filters');
  private readonly changedOnly = control('Changed parts only', 'mr-search-chip mr-search-changed', () => {
    this.changed = !this.changed;
    this.render();
  });
  private readonly status = h('p', 'mr-search-status');
  private readonly list = h('div', 'mr-search-results');
  private readonly scopeNotes = h('div', 'mr-search-scope');
  private readonly bar = h('div', 'mr-search-bar');
  private readonly barText = h('span', 'mr-search-bar-text');
  private readonly previous = control('', 'mr-search-step', () => void this.choose(this.current - 1));
  private readonly next = control('', 'mr-search-step', () => void this.choose(this.current + 1));
  private filter: Filter = 'all';
  private changed = false;
  /** The first results found (bounded), and how many there are in all. */
  private matches: SearchMatch<T>[] = [];
  private total = 0;
  private problem: 'short' | 'long' | null = 'short';
  /** The results the filters leave, in the order the popup and the bar step through them. */
  private shown: SearchMatch<T>[] = [];
  private active = -1;
  private current = -1;
  private query = '';
  private run = 0;
  private refreshTimer = 0;
  /** Back to where the reader was before this search, once a result has been shown. */
  private restore: (() => void) | null = null;
  private place: (() => void) | null = null;
  /** What had focus before the popup opened: closing it goes back there. */
  private opener: Element | null = null;

  constructor(private readonly options: SearchOptions<T>) {
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Search this review');
    const label = h('label', 'mr-search-label');
    // biome-ignore lint/plugin: a bundled icon constant.
    label.innerHTML = icons.search;
    this.field.type = 'search';
    this.field.placeholder = 'Search this review';
    this.field.autocomplete = 'off';
    this.field.spellcheck = false;
    this.field.setAttribute('role', 'combobox');
    this.field.setAttribute('aria-label', 'Search this review');
    this.field.setAttribute('aria-autocomplete', 'list');
    this.field.setAttribute('aria-expanded', 'false');
    this.field.setAttribute('aria-controls', 'mr-search-results');
    this.field.setAttribute('aria-describedby', 'mr-search-status');
    this.field.addEventListener('input', () => void this.search());
    label.append(this.field);
    this.filters.setAttribute('role', 'group');
    this.filters.setAttribute('aria-label', 'Show results from');
    this.changedOnly.title = 'Only text this review changed, with comments and your drafts';
    this.changedOnly.setAttribute('aria-pressed', 'false');
    this.status.id = 'mr-search-status';
    this.status.setAttribute('role', 'status');
    this.list.id = 'mr-search-results';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Results');
    // Choosing a result with the pointer must not take focus from the field first.
    this.list.addEventListener('pointerdown', (event) => event.preventDefault());
    this.panel.append(label, this.filters, this.status, this.list, this.scopeNotes);
    // The popup handles its own clicks. A filter redraws the buttons it holds, so a click must not travel on
    // to the reader, which would no longer find the button inside the popup and close it.
    this.panel.addEventListener('click', (event) => event.stopPropagation());

    this.bar.hidden = true;
    this.bar.setAttribute('role', 'region');
    this.bar.setAttribute('aria-label', 'Search results');
    this.barText.setAttribute('aria-live', 'polite');
    for (const [button, name, icon] of [
      [this.previous, 'Previous result', icons.up],
      [this.next, 'Next result', icons.down],
    ] as const) {
      button.setAttribute('aria-label', name);
      button.title = name;
      // biome-ignore lint/plugin: a bundled icon constant.
      button.innerHTML = icon;
    }
    const back = control('Back', 'mr-search-back', () => {
      const restore = this.restore!;
      this.closeBar();
      restore();
    });
    // Phones show only “Back”, to leave room for where the reader is in the results.
    back.append(h('span', 'mr-search-back-rest', ' to where you were'));
    const close = control('×', 'mr-search-close', () => this.closeBar());
    close.setAttribute('aria-label', 'Close search results');
    this.bar.append(this.barText, this.previous, this.next, back, close);
    options.root.append(this.panel, this.bar);
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  open(): void {
    this.options.beforeOpen();
    // Stepping through results keeps the place from before the first one.
    if (this.bar.hidden) this.place = this.options.remember();
    this.opener = this.focused();
    this.panel.hidden = false;
    this.options.toggle.setAttribute('aria-expanded', 'true');
    this.field.focus();
    this.field.select();
    void this.search();
  }

  close(): boolean {
    if (this.panel.hidden) return false;
    if (this.panel.contains(this.focused())) ((this.opener?.isConnected ? this.opener : this.options.toggle) as HTMLElement).focus({ preventScroll: true });
    this.panel.hidden = true;
    this.options.toggle.setAttribute('aria-expanded', 'false');
    this.field.setAttribute('aria-expanded', 'false');
    return true;
  }

  private focused(): Element | null {
    return (this.field.getRootNode() as Document | ShadowRoot).activeElement;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Something searchable arrived or changed: search again, once things settle, if results are showing. */
  refresh(): void {
    if (!this.isOpen || this.problem) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => void this.search(), 150);
  }

  /** Done with the results: the bar goes, and the reader stays where they are. */
  closeBar(): boolean {
    if (this.bar.hidden) return false;
    this.bar.hidden = true;
    this.restore = null;
    this.current = -1;
    this.options.forget();
    return true;
  }

  destroy(): void {
    this.run++;
    clearTimeout(this.refreshTimer);
  }

  /** Arrow keys move through the results and Enter shows one, while the field has focus. */
  onKey(e: KeyboardEvent): boolean {
    if (this.panel.hidden || e.composedPath()[0] !== this.field) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const count = this.shown.length;
      if (count) this.setActive((this.active + (e.key === 'ArrowDown' ? 1 : -1) + count) % count);
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.active >= 0) void this.choose(this.active);
      return true;
    }
    return false;
  }

  /** Matches in pauses of a few milliseconds; a newer query or closing the reader stops an older search. */
  private async search(): Promise<void> {
    const run = ++this.run;
    this.query = this.field.value.trim();
    const parsed = phrase(this.query);
    this.matches = [];
    this.total = 0;
    this.problem = 'problem' in parsed ? parsed.problem : null;
    if ('pattern' in parsed) {
      let pause = performance.now() + SEARCH_BUDGET.slice;
      for (const target of this.options.targets()) {
        let found = occurrences(target.text, parsed.pattern);
        if (target.alsoNew !== undefined) found = found.slice(0, Math.max(0, found.length - occurrences(target.alsoNew, parsed.pattern).length));
        for (const [start, end] of found) {
          this.total++;
          if (this.matches.length < SEARCH_BUDGET.results) this.matches.push({ target, start, end });
        }
        if (performance.now() > pause) {
          this.status.textContent = 'Searching…';
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (run !== this.run) return;
          pause = performance.now() + SEARCH_BUDGET.slice;
        }
      }
    }
    this.render();
  }

  private render(): void {
    this.changedOnly.setAttribute('aria-pressed', String(this.changed));
    const byChange = this.matches.filter((match) => !this.changed || match.target.changed);
    const counts = new Map<Filter, number>([['all', byChange.length]]);
    for (const match of byChange) {
      const filter = FILTER_OF[match.target.kind];
      counts.set(filter, (counts.get(filter) ?? 0) + 1);
    }
    // A filter with nothing to show goes, unless it is the one chosen.
    if (!counts.has(this.filter)) counts.set(this.filter, 0);
    this.filters.replaceChildren(
      ...FILTERS.filter(([filter]) => counts.has(filter)).map(([filter, name]) => {
        const chip = control(name, 'mr-search-chip', () => {
          this.filter = filter;
          this.render();
        });
        chip.append(h('span', 'mr-search-count', counts.get(filter)!.toLocaleString('en-US')));
        chip.setAttribute('aria-pressed', String(filter === this.filter));
        return chip;
      }),
      this.changedOnly,
    );
    this.filters.hidden = Boolean(this.problem);
    this.shown = byChange.filter((match) => this.filter === 'all' || FILTER_OF[match.target.kind] === this.filter);
    this.list.replaceChildren();
    let group: HTMLElement | null = null;
    let path: string | null | undefined;
    this.shown.forEach((match, index) => {
      if (!group || match.target.path !== path) {
        path = match.target.path;
        group = h('div', 'mr-search-group');
        group.setAttribute('role', 'group');
        const heading = h('div', 'mr-search-file');
        heading.id = `mr-search-group-${index}`;
        if (path === null) heading.append(h('span', 'mr-search-file-name', 'Request description'));
        else {
          const slash = path.lastIndexOf('/');
          heading.append(h('span', 'mr-search-file-name', path.slice(slash + 1)));
          if (slash > 0) heading.append(h('span', 'mr-search-file-dir', path.slice(0, slash + 1)));
        }
        group.setAttribute('aria-labelledby', heading.id);
        group.append(heading);
        this.list.append(group);
      }
      group.append(this.option(match, index));
    });
    this.status.textContent = this.summary();
    this.renderScope();
    this.field.setAttribute('aria-expanded', String(this.shown.length > 0));
    this.setActive(this.shown.length ? 0 : -1);
  }

  private summary(): string {
    if (this.problem === 'short') return 'Type at least two characters to search the review.';
    if (this.problem === 'long') return `Search for ${SEARCH_BUDGET.maxQuery} characters or fewer.`;
    if (!this.total) return `No matches for “${this.query}”.`;
    const listed = this.total > this.matches.length ? ` Showing the first ${this.matches.length.toLocaleString('en-US')}.` : '';
    if (!this.shown.length) return `${plural(this.total, 'match', 'matches')}, none with these filters.${listed}`;
    return `${plural(this.total, 'match', 'matches')}${this.shown.length < this.matches.length ? `, ${this.shown.length.toLocaleString('en-US')} shown` : ''}.${listed}`;
  }

  private option(match: SearchMatch<T>, index: number): HTMLElement {
    const { target } = match;
    const option = h('div', `mr-search-result is-${target.kind}`);
    option.id = `mr-search-result-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    const where = h('span', 'mr-search-where');
    where.append(h('span', `mr-search-tag is-${target.kind}`, TAG[target.kind]));
    if (target.place) where.append(h('span', 'mr-search-place', target.place));
    if (target.version) where.append(h('span', `mr-search-version is-${target.version}`, target.version === 'old' ? 'Old version' : 'New version'));
    if (target.kind === 'draft') where.append(h('span', 'mr-search-private', 'Only you can see it'));
    const { before, match: found, after } = excerpt(target.text, match.start, match.end);
    const quote = h('span', 'mr-search-excerpt');
    quote.append(before, h('mark', '', found), after);
    option.append(where, quote);
    option.addEventListener('click', () => void this.choose(index));
    return option;
  }

  private renderScope(): void {
    const scope = this.options.scope();
    const parts = [plural(scope.files, 'file')];
    if (scope.comments) parts.push(plural(scope.comments, 'comment'));
    if (scope.drafts) parts.push(plural(scope.drafts, 'draft'));
    const searched = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
    const notes: HTMLElement[] = [h('p', '', `Searches ${searched}, including folded parts.`)];
    if (scope.code) {
      const note = h('p', 'mr-search-unsearched', `${plural(scope.code, 'code file')} not searched while Code files is off.`);
      note.append(
        control('Turn on Code files', 'mr-search-code', () => {
          this.options.showCode();
          this.field.focus();
          void this.search();
        }),
      );
      notes.push(note);
    }
    if (scope.loading) notes.push(h('p', 'mr-search-unsearched', `${plural(scope.loading, 'file')} still loading; results update when they arrive.`));
    if (scope.failed)
      notes.push(
        h('p', 'mr-search-unsearched', `${plural(scope.failed, 'file')} could not be loaded and ${scope.failed === 1 ? 'was' : 'were'} not searched.`),
      );
    this.scopeNotes.replaceChildren(...notes);
  }

  private setActive(index: number): void {
    this.active = index;
    for (const option of this.list.querySelectorAll('[role="option"]')) option.setAttribute('aria-selected', 'false');
    if (index < 0) {
      this.field.removeAttribute('aria-activedescendant');
      return;
    }
    const option = this.list.querySelector<HTMLElement>(`#mr-search-result-${index}`)!;
    option.setAttribute('aria-selected', 'true');
    this.field.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  }

  /** Show one result. The first one remembers where the reader was, for Back to where you were. */
  private async choose(index: number): Promise<void> {
    const match = this.shown[index];
    this.restore ??= this.place;
    this.current = index;
    this.close();
    this.bar.hidden = false;
    this.barText.textContent = `“${this.query}” · ${index + 1} of ${this.shown.length.toLocaleString('en-US')}`;
    this.previous.disabled = index === 0;
    this.next.disabled = index === this.shown.length - 1;
    await this.options.reveal(match);
  }
}
