import { reviewChapters, type ReviewChapter } from '../../core/chapters.ts';
import { testPartners } from '../../core/order.ts';
import type { DocRef, DocStatus } from '../../platforms/types.ts';
import { icons } from '../components/icons.ts';
import { Sheet, sheetRow, sheetSection, twin, type SheetContent, type SheetLayer } from '../components/sheet.ts';
import { platformLink } from '../rendering/render.ts';
import { glyph } from '../components/dom.ts';

export interface ChapterFileState {
  viewed: boolean;
  folded: boolean;
  hidden: boolean;
  unavailable: boolean;
  current: boolean;
  unsupported: boolean;
}

interface Options {
  root: HTMLElement;
  toggle: HTMLButtonElement;
  mount: HTMLElement;
  beforeOpen(): void;
  /** What slides aside as the sheet opens beside the review. */
  parts(): Iterable<HTMLElement>;
  /** Open or close the sheet beside the review: the review reflows into the width left, keeping its place. */
  reflow(change: () => void): void;
  navigate(doc: DocRef): void;
  resume(): void;
  reorder(docs: DocRef[] | null): void;
  state(doc: DocRef): ChapterFileState;
  diffUrl(): string;
  /** Library was chosen in the sheet's switch: the project library takes the first sheet (review-library.ts). */
  library(): void;
  /** The chapters took the first sheet again. */
  shown(): void;
  /** A chapter's docs, under its files (chapter-context.ts); null without a repository behind the review. */
  projectContext?(chapter: ReviewChapter): HTMLElement[] | null;
  /** How many documents link to a chapter's files, once the repository has been read; null before. */
  linked?(chapter: ReviewChapter): number | null;
}

const STATUS: Record<DocStatus, string> = { added: 'Added', modified: 'Edited', removed: 'Deleted', renamed: 'Renamed' };
/** The keys a list of rows answers to, shown at its foot. */
const KEYS: Array<[string[], string]> = [
  [['↑', '↓'], 'Move'],
  [['↵'], 'Open'],
];

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}
function button(text: string, action: () => void, className = 'mr-chapter-button'): HTMLButtonElement {
  const el = node('button', className, text);
  el.type = 'button';
  el.addEventListener('click', action);
  return el;
}
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const byData = (scope: ParentNode, key: 'chapter', value: string) =>
  [...scope.querySelectorAll<HTMLElement>(`[data-${key}]`)].find((el) => el.dataset[key] === value);

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** A chapter's place in the path, or a check once all its files are viewed. */
function mark(place: number, done: boolean): HTMLElement {
  const el = node('span', 'mr-sheet-num', done ? '' : String(place));
  if (done) el.replaceChildren(glyph(icons.check));
  return el;
}

/** An icon button that names itself in words, for Edit chapters. */
function iconButton(icon: string, words: string, action: () => void): HTMLButtonElement {
  const el = button('', action, 'mr-btn mr-icon-btn');
  el.replaceChildren(glyph(icon));
  el.append(node('span', 'mr-visually-hidden', words));
  return el;
}

/**
 * Review chapters, in the review's sheet: an optional path through the change. No file is hidden by grouping, and
 * only explicit Viewed actions count as progress. The first sheet lists the chapters; a chapter, All files and Edit
 * chapters each open on top of it, and a chapter's documents on top of that (review-library.ts).
 */
export class ChapterMap {
  private chapters: ReviewChapter[] = [];
  private docs: DocRef[] = [];
  private other: DocRef[] = [];
  private partners = new Map<DocRef, DocRef>();
  private custom = 0;
  private focus: HTMLElement;
  private project = false;
  private readonly sheet: Sheet;
  private readonly route = node('section', 'mr-chapter-route');
  private readonly routeText = node('span', 'mr-chapter-route-text');
  private readonly next = button('Next chapter', () => this.stepChapter(), 'mr-chapter-button mr-chapter-next');
  private readonly first = button('Start here', () =>
    this.start(this.chapters.find((item) => item.files.some((doc) => !this.options.state(doc).viewed && !this.options.state(doc).unsupported))!),
  );
  /** Chapters | Library: one sheet for the review's path and the docs around it, switched in its header. */
  private readonly tabs = node('div', 'mr-sheet-tabs');
  private readonly progress = node('p', 'mr-chapters-progress');
  /** Progress along the path: a segment for each chapter, as long as it has files, filled as they are viewed. */
  private readonly bar = node('span', 'mr-chapters-bar');
  /** The chapters, as a path: numbered, joined, and checked off as their files are viewed. */
  private readonly list = node('div', 'mr-sheet-rows mr-path');
  private readonly allFiles = button('All files', () => this.openFiles(), 'mr-sheet-link mr-chapters-all');
  private readonly edit = button('Edit', () => this.openEditor(), 'mr-sheet-link mr-chapters-edit');
  private readonly feedback = node('p', 'mr-chapters-feedback');
  /** The sheets this map opened on top, to draw again when something changes. */
  private opened: Array<{ layer: SheetLayer; draw(): SheetContent }> = [];

  /** The chapters as they stand, with the paths of their files: what a repository read from this review shows. */
  outline(): Array<{ id: string; title: string; paths: string[] }> {
    return this.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, paths: chapter.files.map((doc) => doc.path) }));
  }

  constructor(private readonly options: Options) {
    this.focus = options.toggle;
    this.route.hidden = true;
    // The reader's sheet: beside the review on wide screens, which narrows and stays in reach; over it on phones.
    this.sheet = new Sheet({
      root: options.root,
      className: 'mr-chapters',
      closeLabel: 'Close',
      parts: () => options.parts(),
      background: () => this.background(),
      reflow: (change) => options.reflow(change),
      dismiss: () => this.close(),
    });
    this.tabs.setAttribute('role', 'group');
    this.tabs.setAttribute('aria-label', 'Show in this sheet');
    for (const [name, label] of [
      ['chapters', 'Chapters'],
      ['library', 'Library'],
    ] as const) {
      const tab = button(label, () => (name === 'chapters' ? this.showChapters() : this.options.library()), 'mr-sheet-tab');
      tab.dataset.tab = name;
      this.tabs.append(tab);
    }
    this.first.classList.add('mr-chapters-start');
    this.bar.setAttribute('aria-hidden', 'true');
    this.feedback.setAttribute('role', 'status');
    this.feedback.setAttribute('aria-live', 'polite');
    // Clicks in the sheet are its own, not the review's.
    for (const el of [this.sheet.element, this.sheet.backdrop]) el.addEventListener('click', (event) => event.stopPropagation());
    this.route.append(
      button('Chapters', () => this.open()),
      this.routeText,
      this.next,
    );
    this.route.addEventListener('click', (event) => event.stopPropagation());
    options.mount.before(this.route);
    options.toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this.open();
    });
  }

  setSource(docs: DocRef[], other: DocRef[], project: boolean): void {
    this.docs = docs;
    this.other = other;
    this.partners = testPartners(docs);
    this.chapters = reviewChapters(docs, other);
    const count = docs.length + other.length;
    this.options.toggle.hidden = count === 0 || (count === 1 && !project);
    this.project = project;
    this.update();
  }

  /** Chapters, M and the route's Chapters button open the sheet at the chapters, and close it when it is open. */
  open(): void {
    if (this.options.toggle.hidden) return;
    if (this.sheet.isOpen) {
      this.close();
      return;
    }
    this.options.beforeOpen();
    const active = (this.options.root.getRootNode() as Document | ShadowRoot).activeElement;
    this.focus = active instanceof HTMLElement ? active : this.options.toggle;
    this.showChapters();
    this.options.toggle.setAttribute('aria-expanded', 'true');
    this.sheet.show();
    this.sheet.root.element.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.sheet.hide()) return;
    this.options.toggle.setAttribute('aria-expanded', 'false');
    this.focus.focus({ preventScroll: true });
  }

  /**
   * Esc goes back a sheet, then closes; in a chapter, ← and → go to the one before and after it. Covering the review,
   * the sheet has every key; beside it, only those typed in it.
   */
  onKey(event: KeyboardEvent): boolean {
    if (this.sheet.onKey(event)) return true;
    const active = (this.options.root.getRootNode() as Document | ShadowRoot).activeElement;
    const inside = this.sheet.isOpen && this.sheet.element.contains(active);
    const step = { ArrowLeft: 0, ArrowRight: 1 }[event.key];
    // With a modifier they are the browser's, such as Back.
    if (inside && step !== undefined && this.sheet.top.kind === 'chapter' && !(event.altKey || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.sheet.top.element.querySelectorAll<HTMLButtonElement>('.mr-chapter-step')[step].click();
      return true;
    }
    return this.sheet.isModal || inside;
  }

  /** The chapters on the first sheet: progress, the way in, then every chapter; anything open on top goes. */
  showChapters(): void {
    const switching = this.switching();
    this.opened = [];
    this.sheet.fill(this.chaptersContent());
    this.choose('chapters', switching);
    this.update();
    this.options.shown();
  }

  /** The library on the first sheet, under the switch. */
  showPage(content: SheetContent): void {
    const switching = this.switching();
    this.opened = [];
    this.sheet.fill({ ...content, lead: [this.tabs, ...(content.lead ?? [])] });
    this.choose('library', switching);
  }

  /** A sheet on top of whatever is open: a document, from a chapter or the library. */
  push(content: SheetContent): SheetLayer {
    return this.sheet.push(content);
  }

  /** New docs were read, or the reader's additions changed: the open chapters show them, focus staying on its control. */
  redraw(): void {
    if (!this.sheet.isOpen) return;
    this.update();
    const active = (this.options.root.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null;
    const reading = active?.closest('.mr-docs-status');
    for (const { layer, draw } of this.live()) {
      const had = layer.element.contains(active);
      layer.fill(draw());
      if (!had) continue;
      // The status of the reading the reader asked for, while there is one; the same row; else the sheet.
      const again = reading ? layer.body.querySelector<HTMLElement>('.mr-docs-line') : twin(layer.body, active!);
      (again || layer.element).focus({ preventScroll: true });
    }
  }

  continueChapter(id: string): void {
    this.close();
    const chapter = this.chapters.find((chapter) => chapter.id === id)!;
    const current = chapter.files.find((doc) => this.options.state(doc).current);
    if (current) this.options.resume();
    else this.start(chapter);
  }

  /** Progress in words and as a bar, the way in, and the state of every row; the row with focus keeps it. */
  update(): void {
    const all = [...this.docs, ...this.other];
    const viewed = all.filter((doc) => this.options.state(doc).viewed).length;
    this.progress.textContent = `${viewed} of ${plural(all.length, 'file')} viewed`;
    this.bar.replaceChildren(
      ...this.chapters
        .filter((chapter) => chapter.files.length)
        .map((chapter) => {
          const seen = chapter.files.filter((doc) => this.options.state(doc).viewed).length;
          const part = node('span');
          part.setAttribute('style', `flex-grow: ${chapter.files.length}`);
          const fill = node('span');
          fill.setAttribute('style', `width: ${Math.round((seen / chapter.files.length) * 100)}%`);
          part.append(fill);
          return part;
        }),
    );
    this.first.disabled = !all.some((doc) => !this.options.state(doc).viewed && !this.options.state(doc).unsupported);
    this.first.textContent = viewed ? 'Continue here' : 'Start here';
    this.route.hidden = all.length < 6;
    const current = this.currentChapter();
    this.routeText.textContent =
      current < 0 ? `${this.chapters.length} chapters · ${all.length} files` : `${current + 1} of ${this.chapters.length} · ${this.chapters[current].title}`;
    this.next.disabled = current < 0 || !this.nextChapter(current);
    const active = (this.options.root.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null;
    const focused = active?.closest<HTMLElement>('.mr-sheet-rows [data-chapter]')?.dataset.chapter;
    this.list.replaceChildren(...this.chapters.map((chapter) => this.chapterRow(chapter)));
    if (focused) byData(this.list, 'chapter', focused)!.focus({ preventScroll: true });
    for (const row of this.sheet.element.querySelectorAll<HTMLElement>('.mr-sheet-row[data-file]')) {
      const fresh = this.fileRow(all[Number(row.dataset.file)]);
      row.replaceWith(fresh);
      if (row === active) fresh.focus({ preventScroll: true });
    }
    for (const option of this.sheet.element.querySelectorAll<HTMLOptionElement>('[data-chapter-destination] option'))
      option.textContent = this.chapters.find((chapter) => chapter.id === option.value)!.title;
  }

  private chaptersContent(): SheetContent {
    const status = node('div', 'mr-chapters-status');
    status.append(this.progress, this.first);
    return {
      label: 'Chapters',
      lead: this.project ? [this.tabs] : [node('h2', 'mr-sheet-heading', 'Chapters')],
      extra: [status, this.bar],
      body: [sheetSection('Reading path', [this.list], { actions: [this.allFiles, this.edit] })],
      keys: KEYS,
    };
  }

  private chapterRow(chapter: ReviewChapter): HTMLElement {
    const viewed = chapter.files.filter((doc) => this.options.state(doc).viewed).length;
    const linked = this.options.linked?.(chapter) ?? null;
    // What is in it, by name: the first two files, and how many more.
    const names = chapter.files.slice(0, 2).map((doc) => base(doc.path));
    if (chapter.files.length > 2) names.push(`+${chapter.files.length - 2}`);
    const done = chapter.files.length > 0 && viewed === chapter.files.length;
    const row = sheetRow({
      title: chapter.title,
      meta: [names.join(', ') || 'No files yet', linked ? plural(linked, 'doc') : ''].filter(Boolean).join(' · '),
      lead: mark(this.chapters.indexOf(chapter) + 1, done),
      opens: true,
      action: () => this.openChapter(chapter),
    });
    const end = row.querySelector('.mr-sheet-row-end')!;
    end.append(`${viewed}/${chapter.files.length}`, node('span', 'mr-visually-hidden', ' viewed'));
    // Only a chapter under way shows how far it is; its mark says the rest, and assistive technology hears it all.
    end.classList.toggle('mr-visually-hidden', viewed === 0 || done);
    row.classList.toggle('is-done', done);
    row.dataset.chapter = chapter.id;
    if (chapter.files.some((doc) => this.options.state(doc).current)) {
      row.setAttribute('aria-current', 'true');
      row.classList.add('is-current');
    }
    return row;
  }

  /** A chapter on top: why its files are together, the way in, its files, then the docs around them; or in place of the one shown. */
  private openChapter(chapter: ReviewChapter, step = false): void {
    this.remember(() => {
      const viewed = chapter.files.filter((doc) => this.options.state(doc).viewed).length;
      const read = button(viewed ? 'Continue chapter' : 'Read chapter', () => this.start(chapter), 'mr-chapter-button mr-chapters-start');
      read.disabled = !chapter.files.some((doc) => !this.options.state(doc).unsupported);
      const tools = node('div', 'mr-chapters-tools');
      tools.append(read, node('span', 'mr-chapters-count', `${viewed} of ${plural(chapter.files.length, 'file')} viewed`));
      const extra: Node[] = chapter.introduction ? [node('p', 'mr-chapter-introduction', chapter.introduction)] : [];
      const files = chapter.files.length ? chapter.files.map((doc) => this.fileRow(doc)) : [node('p', 'mr-sheet-note', 'No files yet. Move one here in Edit.')];
      const index = this.chapters.indexOf(chapter);
      return {
        label: chapter.title,
        actions: this.steps(index),
        kicker: `Chapter ${index + 1} of ${this.chapters.length}`,
        title: chapter.title,
        description: chapter.reason,
        extra: [...extra, tools],
        body: [sheetSection('Changed files', files, { count: chapter.files.length }), ...(this.options.projectContext?.(chapter) ?? [])],
        keys: [...KEYS, [['←', '→'], 'Chapter']],
        kind: 'chapter',
      };
    }, step);
  }

  /** The chapters before and after it, in its header: each takes its place, and ← and → do the same. */
  private steps(index: number): HTMLButtonElement[] {
    return (
      [
        [-1, 'Previous chapter', icons.chevronLeft, '←', 'previous'],
        [1, 'Next chapter', icons.chevronRight, '→', 'next'],
      ] as const
    ).map(([step, words, icon, key, name]) => {
      const to = this.chapters[index + step];
      const el = iconButton(icon, words, () => this.openChapter(to, true));
      el.classList.add('mr-chapter-step');
      el.dataset.step = name;
      el.title = `${words} (${key})`;
      el.disabled = !to;
      return el;
    });
  }

  /** Every changed file in one list, on top, under the chapter each is in. */
  private openFiles(): void {
    this.remember(() => {
      const rows = this.chapters.flatMap((chapter, index) =>
        chapter.files.length ? [node('h4', 'mr-sheet-subhead', `${index + 1} · ${chapter.title}`), ...chapter.files.map((doc) => this.fileRow(doc))] : [],
      );
      return {
        label: 'All files',
        title: 'All files',
        description: 'Every changed file, chapter by chapter.',
        body: [sheetSection('Changed files', rows, { count: this.docs.length + this.other.length })],
        keys: KEYS,
        kind: 'files',
      };
    });
  }

  /** Open a sheet on top, or step to it in place of the one on top, and draw it again when something changes. */
  private remember(draw: () => SheetContent, step = false): void {
    const layer = step ? this.sheet.replace(draw()) : this.sheet.push(draw());
    this.opened = [...this.live().filter((open) => open.layer !== layer), { layer, draw }];
  }

  /** The sheets this map opened that are still open. */
  private live(): Array<{ layer: SheetLayer; draw(): SheetContent }> {
    return this.opened.filter(({ layer }) => layer.element.isConnected && !layer.element.hidden);
  }

  private fileRow(doc: DocRef): HTMLElement {
    const state = this.options.state(doc);
    const at = doc.path.lastIndexOf('/');
    const meta = [doc.path.slice(0, Math.max(0, at)) || 'Top folder', STATUS[doc.status]];
    const partner = this.partners.get(doc);
    if (partner) meta.push(`Test for ${partner.path} · matched by name and nearest folder`);
    if (doc.status === 'renamed') meta.push(`from ${doc.oldPath}`);
    if (state.unsupported) meta.push('Platform only');
    if (state.hidden) meta.push('Code files off');
    if (state.unavailable) meta.push('Failed to load');
    if (state.folded) meta.push('Folded');
    const url = this.options.diffUrl();
    const row = sheetRow({
      title: doc.path.slice(at + 1),
      meta: meta.join(' · '),
      lead: node('span', `mr-status-dot is-${doc.status}`),
      end: state.viewed ? 'Viewed' : '',
      // Files the reader cannot show are on the platform's own diff.
      href: state.unsupported ? (platformLink(url, url) ?? '') : undefined,
      action: () => {
        this.close();
        if (!state.unsupported) this.options.navigate(doc);
      },
    });
    row.dataset.file = String([...this.docs, ...this.other].indexOf(doc));
    row.title = doc.path;
    if (state.current) {
      row.setAttribute('aria-current', 'true');
      row.classList.add('is-current');
    }
    return row;
  }

  /** Edit chapters, on top: names and what to look at, their order, which chapter a file is in; for this session. */
  private openEditor(): void {
    this.feedback.textContent = '';
    this.remember(() => {
      const blocks = this.chapters.map((chapter, index) => {
        const block = node('div', 'mr-chapter-edit');
        block.dataset.chapter = chapter.id;
        const order = node('div', 'mr-chapter-edit-order');
        const moves: Array<[HTMLButtonElement, string]> = [];
        for (const [step, word, icon] of [
          [-1, 'Earlier', icons.up],
          [1, 'Later', icons.down],
        ] as const) {
          const move = iconButton(icon, word, () => {
            [this.chapters[index], this.chapters[index + step]] = [this.chapters[index + step], chapter];
            this.edited(`${chapter.title} moved ${word.toLowerCase()}.`, chapter.id);
          });
          move.disabled = index + step < 0 || index + step >= this.chapters.length;
          move.title = `Move ${word.toLowerCase()}`;
          order.append(move);
          moves.push([move, word.toLowerCase()]);
        }
        // Each move says which chapter it moves, by the name it has now.
        const named = () => {
          for (const [move, word] of moves) move.setAttribute('aria-label', `Move ${chapter.title} ${word}`);
        };
        named();
        const name = node('input');
        name.value = chapter.title;
        name.maxLength = 80;
        name.setAttribute('aria-label', 'Chapter name');
        name.addEventListener('input', () => {
          chapter.title = name.value.trim() || 'Untitled chapter';
          named();
          this.update();
        });
        const top = node('div', 'mr-chapter-edit-top');
        top.append(name, node('span', 'mr-sheet-note', chapter.files.length ? plural(chapter.files.length, 'file') : 'No files yet'), order);
        const introduction = node('textarea');
        introduction.value = chapter.introduction;
        introduction.maxLength = 500;
        introduction.rows = 1;
        introduction.placeholder = 'What to look at (optional)';
        introduction.setAttribute('aria-label', 'What to look at (optional)');
        introduction.addEventListener('input', () => {
          chapter.introduction = introduction.value;
        });
        // Its place in the path, as the chapters show it; the controls name the chapter themselves.
        const place = mark(index + 1, false);
        place.setAttribute('aria-hidden', 'true');
        block.append(place, top, introduction);
        return block;
      });
      const actions = node('div', 'mr-chapters-tools');
      actions.append(
        button(
          'New chapter',
          () => {
            const chapter: ReviewChapter = { id: `custom:${++this.custom}`, title: 'New chapter', reason: 'Grouped by you.', introduction: '', files: [] };
            this.chapters.push(chapter);
            this.edited('New chapter added. Name it, then move files into it.', chapter.id);
          },
          'mr-chapter-button mr-chapter-new',
        ),
        button('Reset chapters', () => {
          this.chapters = reviewChapters(this.docs, this.other);
          // Drawn first: the review's reorder updates the editor's lists, which must no longer offer removed chapters.
          this.edited('Suggested chapters restored. File order follows your reading settings.');
          this.options.reorder(null);
        }),
      );
      return {
        label: 'Edit chapters',
        title: 'Edit chapters',
        description: 'Rename chapters, say what to look at in each, and move files between them. Changes last for this session.',
        body: [sheetSection('Chapters', blocks, { count: this.chapters.length }), sheetSection('Move a file', [this.assignment()]), actions, this.feedback],
        kind: 'edit',
      };
    });
  }

  /** A change in Edit chapters: everything open is drawn again, said aloud, and focus goes to the chapter it was about. */
  private edited(text: string, id?: string): void {
    if (id) this.applyOrder();
    for (const { layer, draw } of this.live()) layer.fill(draw());
    this.update();
    this.feedback.textContent = text;
    byData(this.sheet.top.body, 'chapter', id ?? this.chapters[0].id)!
      .querySelector('input')!
      .focus({ preventScroll: true });
  }

  private assignment(): HTMLElement {
    const form = node('form', 'mr-chapter-assignment');
    const file = node('select');
    file.setAttribute('aria-label', 'File to move');
    for (const [index, doc] of [...this.docs, ...this.other].entries()) {
      const option = node('option', '', doc.path);
      option.value = String(index);
      file.append(option);
    }
    const destination = node('select');
    destination.setAttribute('aria-label', 'To chapter');
    destination.dataset.chapterDestination = '';
    for (const chapter of this.chapters) {
      const option = node('option', '', chapter.title);
      option.value = chapter.id;
      destination.append(option);
    }
    const move = node('button', 'mr-chapter-button', 'Move file');
    move.type = 'submit';
    form.append(file, destination, move);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const doc = [...this.docs, ...this.other][Number(file.value)];
      const target = this.chapters.find((chapter) => chapter.id === destination.value)!;
      for (const chapter of this.chapters) chapter.files = chapter.files.filter((item) => item !== doc);
      target.files.push(doc);
      target.reason = 'Grouped by you.';
      this.edited(`${doc.path} moved to ${target.title}.`, target.id);
    });
    return form;
  }

  /** Was the switch in use? Drawn into the new sheet, it keeps focus. */
  private switching(): boolean {
    return this.tabs.contains((this.options.root.getRootNode() as Document | ShadowRoot).activeElement);
  }

  private choose(name: 'chapters' | 'library', focus: boolean): void {
    for (const tab of this.tabs.querySelectorAll<HTMLElement>('[data-tab]')) tab.setAttribute('aria-pressed', String(tab.dataset.tab === name));
    if (focus) this.tabs.querySelector<HTMLElement>(`[data-tab="${name}"]`)!.focus({ preventScroll: true });
  }

  private background(): NodeListOf<HTMLElement> {
    return this.options.root.querySelectorAll('.mr-topbar, .mr-main, .mr-toc, .mr-resume, .mr-select-chip');
  }

  private currentChapter(): number {
    return this.chapters.findIndex((chapter) => chapter.files.some((doc) => this.options.state(doc).current));
  }

  private start(chapter: ReviewChapter): void {
    const doc =
      chapter.files.find((doc) => !this.options.state(doc).viewed && !this.options.state(doc).unsupported) ??
      chapter.files.find((doc) => !this.options.state(doc).unsupported)!;
    this.close();
    this.options.navigate(doc);
  }

  private stepChapter(): void {
    this.start(this.nextChapter(this.currentChapter())!);
  }

  private nextChapter(index: number): ReviewChapter | undefined {
    return this.chapters.slice(index + 1).find((chapter) => chapter.files.some((doc) => !this.options.state(doc).unsupported));
  }

  private applyOrder(): void {
    this.options.reorder(this.chapters.flatMap((chapter) => chapter.files).filter((doc) => !this.options.state(doc).unsupported));
  }
}
