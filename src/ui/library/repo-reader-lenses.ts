import { relatedDocuments } from '../../core/review-context.ts';
import { buildLens, MAX_CONFIG_CHARS, ORIGIN_NAMES, type ArchitectureInput, type LensName } from '../../core/architecture.ts';
import { configFormat } from '../../core/discovery.ts';
import { anchorState, exportMarkdown, exportMermaid, MAX_NOTES, NOTE_NAMES, sectionText, type ExportContext, type Note } from '../../core/notes.ts';
import { readConfiguration } from './configs.ts';
import { button, h } from '../components/dom.ts';
import { digestText } from './project-store.ts';
import { configStatus, exportSheet, lensSwitch, lensView, type ConfigState } from './repo-views.ts';
import { reviewMap } from '../../core/project-map.ts';
import { DocumentMap } from './map-view.ts';
import { CONFIG_CONCURRENCY, MAX_ISSUE_URL, edgeKey, newId, plural, sectionKey, shortSha } from './repo-reader-shared.ts';
import { RepoReaderMap } from './repo-reader-map.ts';

/** The architecture, infrastructure and decision views, private notes, their export, and a review's project context. */
export abstract class RepoReaderLenses extends RepoReaderMap {
  // ---------------------------------------------------------------- architecture, infrastructure and decisions

  protected lensInput(): ArchitectureInput {
    const thinking = this.notes!.thinking;
    return {
      index: this.index!,
      corrections: this.corrections,
      configs: this.configs,
      texts: this.read,
      proposed: thinking,
      kinds: new Map(thinking.entityKinds),
    };
  }

  protected configState(): ConfigState {
    const { state, read, notes } = this.config;
    return { state, read, notes, files: this.listing!.configs.files.length, commit: this.source!.commit };
  }

  protected drawLens(lens: LensName): void {
    const map = this.q('.mr-repo-map');
    const source = this.source!;
    const model = buildLens(lens, this.lensInput());
    this.redrawPane(
      map,
      this.mapHead(),
      lensView({
        lens,
        model,
        focus: this.entityFocus,
        config: this.configState(),
        links: { isDocument: (path) => this.index!.documentAt(path) === path, fileAt: (path, line) => `${source.links.blob(path)}#L${line}` },
        reading: this.path ? { path: this.path, title: this.titleOf(this.path) } : null,
      }),
    );
  }

  /**
   * Read the listed configuration files in the sandboxed frame, a few at a time, only when the reader
   * asks. Nothing in them is run or followed; what could not be read is said.
   */
  protected async readConfigs(): Promise<void> {
    const { files, limits } = this.listing!.configs;
    const run = { cancelled: false };
    const notes = [...limits];
    this.config = { state: 'reading', read: 0, notes, run };
    this.updateConfigStatus();
    let next = 0;
    const work = async () => {
      while (next < files.length) {
        const file = files[next++];
        const listedLarge = (file.size ?? 0) > MAX_CONFIG_CHARS;
        const text = listedLarge ? null : await this.load(file.path).catch(() => null);
        if (run.cancelled) return;
        const large = listedLarge || (text ?? '').length > MAX_CONFIG_CHARS;
        const reading = text === null || large ? null : await readConfiguration(this.shadow, file.path, configFormat(file.path)!, text);
        if (run.cancelled) return;
        if (reading) {
          this.configs.set(file.path, reading);
          this.config.read++;
          for (const note of reading.notes) notes.push(`${file.path}: ${note}`);
        } else notes.push(large ? `${file.path} is too large to read.` : `${file.path} could not be read.`);
        this.updateConfigStatus();
      }
    };
    await Promise.all(Array.from({ length: CONFIG_CONCURRENCY }, work));
    if (run.cancelled) return;
    this.config.state = 'done';
    this.config.run = null;
    this.redraw();
  }

  protected updateConfigStatus(): void {
    for (const box of this.shadow.querySelectorAll('.mr-lens-configs')) box.replaceWith(configStatus(this.configState()));
  }

  /** Draw what is shown again after its data changed, keeping what the reader is typing: Notes, and the map or the documents list. */
  protected redraw(): void {
    this.drawNotes();
    if (!this.index) return;
    if (this.view === 'map') this.drawMap();
    else if (this.view === 'review') this.drawReview();
    else this.buildOutline();
  }

  /** After a refresh: links that changed among the documents read at both commits, and notes to look at again. */
  protected sinceRefresh(): HTMLElement | null {
    const previous = this.previous;
    if (!previous) return null;
    const index = this.index!;
    const both = (path: string) => previous.read.has(path) && index.docs.has(path);
    const now = index.edges.filter((edge) => both(edge.from)).map((edge) => edgeKey(edge.from, edge.to));
    const added = now.filter((key) => !previous.edges.has(key));
    const gone = [...previous.edges].filter((key) => both(key.split('\u0000')[0]) && !now.includes(key));
    const read = [...previous.read].filter(both).length;
    const box = h('section', 'mr-map-since');
    box.setAttribute('aria-label', `Since ${shortSha(previous.commit)}`);
    const head = h('h3', '', `Since ${shortSha(previous.commit)}`);
    box.append(head);
    box.append(
      h(
        'p',
        '',
        added.length || gone.length
          ? `Among the ${plural(read, 'document')} read at both commits, ${plural(added.length, 'link is', 'links are')} new and ${plural(gone.length, 'link is', 'links are')} gone.`
          : `No links changed among the ${plural(read, 'document')} read at both commits.`,
      ),
    );
    const list = h('ul', 'mr-map-since-list');
    for (const [key, what] of [...added.map((key) => [key, 'New'] as const), ...gone.map((key) => [key, 'Gone'] as const)]) {
      const [from, to] = key.split('\u0000');
      const item = h('li', '', `${what}: `);
      const a = button(this.titleOf(from), 'focus', 'mr-repo-edge-doc');
      a.dataset.path = from;
      const b = button(this.titleOf(to), 'focus', 'mr-repo-edge-doc');
      b.dataset.path = to;
      item.append(a, ' → ', b);
      list.append(item);
    }
    if (list.childElementCount) box.append(list);
    const stale = [...this.anchorStates.values()].filter((state) => state === 'changed' || state === 'missing').length;
    if (stale)
      box.append(
        h('p', '', `${plural(stale, 'of your notes is', 'of your notes are')} about a section that changed or is gone.`),
        button('Look at them', 'view-notes'),
      );
    box.append(button('Dismiss', 'dismiss-since'));
    return box;
  }

  protected proposeEntity(form: HTMLFormElement): void {
    const data = new FormData(form);
    const name = String(data.get('name')).trim();
    if (!name) return;
    // The switch is there only while a document is open: on, the proposal is about that document.
    const about = form.querySelector('[data-act="propose-about"]')?.getAttribute('aria-checked') === 'true';
    const reading = about ? { path: this.path!, label: this.titleOf(this.path!).slice(0, 200) } : null;
    const entity = { id: newId('reader'), name, kind: String(data.get('kind')), lens: form.dataset.lens as 'architecture' | 'infrastructure', anchor: reading };
    this.notes!.change((thinking) => thinking.entities.push(entity));
    this.entityFocus = entity.id;
    form.reset();
    this.drawMap();
    this.drawNotes();
    this.toast(`${name} added as your proposal. Save your notes to keep it.`);
  }

  protected proposeRelation(form: HTMLFormElement): void {
    const data = new FormData(form);
    const relation = { id: newId('link'), from: form.dataset.from!, to: String(data.get('to')), label: String(data.get('label')).trim() };
    if (!relation.label) return;
    this.notes!.change((thinking) => {
      const same = thinking.relations.some((r) => r.from === relation.from && r.to === relation.to && r.label === relation.label);
      if (!same) thinking.relations.push(relation);
    });
    this.drawMap();
    this.drawNotes();
  }

  // ---------------------------------------------------------------- notes

  /** What a new note can be about: the document being read, whole or one of its sections. */
  protected anchorOptions(): Map<string, { path: string; heading: string | null; label: string; text: string }> {
    const options = new Map<string, { path: string; heading: string | null; label: string; text: string }>();
    const path = this.path;
    const text = path === null ? undefined : this.read.get(path);
    if (text === undefined) return options;
    const doc = this.indexed(path!, text);
    const title = doc.title.slice(0, 200);
    options.set(`${path}\u0000`, { path: path!, heading: null, label: title, text });
    for (const heading of doc.headings.filter((heading) => heading.id.length <= 200))
      options.set(`${path}\u0000${heading.id}`, { path: path!, heading: heading.id, label: `${title} § ${heading.text}`.slice(0, 400), text });
    return options;
  }

  protected noteLabel(note: Note): string {
    const line = note.text.split('\n')[0];
    return `${NOTE_NAMES[note.kind]}: ${line.length > 60 ? `${line.slice(0, 59)}…` : line}`;
  }

  /** What a note can be connected to: other notes, and the components, services and environments in the views. */
  protected targets(): Array<{ id: string; label: string }> {
    const notes = this.notes!.thinking.notes.map((note) => ({ id: note.id, label: this.noteLabel(note) }));
    if (!this.index) return notes;
    const entities = (['architecture', 'infrastructure'] as const).flatMap((lens) =>
      buildLens(lens, this.lensInput()).entities.filter((entity) => !entity.doc),
    );
    return [...notes, ...entities.map((entity) => ({ id: entity.id, label: `${entity.name} (${entity.kind}, ${ORIGIN_NAMES[entity.origin].toLowerCase()})` }))];
  }

  /** Whether each note's section is still as it was when the note was written, at the commit read. */
  protected async checkAnchors(): Promise<void> {
    const source = this.source!;
    const listing = await this.discover().catch(() => null);
    // Fingerprints of the sections notes are about, at this commit; null for a section or document that is gone.
    const sections = new Map<string, string | null>();
    for (const note of this.notes!.thinking.notes) {
      const anchor = note.anchor;
      if (!anchor || anchor.commit === source.commit) continue;
      let digest: string | null = null;
      if (!listing || listing.docs.some((doc) => doc.path === anchor.path)) {
        // A document that cannot be read now says nothing about its sections.
        const text = await this.load(anchor.path).catch(() => null);
        if (text === null) continue;
        const section = sectionText(text, anchor.heading);
        digest = section === null ? null : await digestText(section);
      }
      sections.set(sectionKey(anchor), digest);
    }
    if (this.closed || this.source !== source) return;
    // States come from each note's anchor as it is now: one reconfirmed or detached meanwhile is not undone.
    for (const note of this.notes!.thinking.notes) {
      const anchor = note.anchor;
      if (anchor && (anchor.commit === source.commit || sections.has(sectionKey(anchor))))
        this.anchorStates.set(note.id, anchorState(anchor, source.commit, sections.get(sectionKey(anchor)) ?? null));
    }
    this.drawNotes();
    if (this.view === 'map' && this.previous) this.drawMap();
  }

  protected async addNote(form: HTMLFormElement): Promise<void> {
    const notes = this.notes!;
    const data = new FormData(form);
    const text = String(data.get('text')).trim();
    if (!text) return;
    if (notes.thinking.notes.length >= MAX_NOTES) {
      this.toast(`You have ${MAX_NOTES} notes, the most Galley keeps for one repository. Delete some to add more.`);
      return;
    }
    const kind = data.get('kind') as Note['kind'];
    const choice = this.anchorOptions().get(String(data.get('anchor')));
    const source = this.source!;
    const anchor = choice
      ? {
          path: choice.path,
          heading: choice.heading,
          label: choice.label,
          commit: source.commit,
          digest: await digestText(sectionText(choice.text, choice.heading)!),
        }
      : null;
    const now = Date.now();
    const note: Note = {
      id: newId('note'),
      kind,
      text,
      group: kind === 'alternative' ? String(data.get('group')).trim() : '',
      anchor,
      links: [],
      created: now,
      updated: now,
    };
    notes.change((thinking) => thinking.notes.push(note));
    if (anchor) this.anchorStates.set(note.id, 'current');
    // The form may have been drawn again meanwhile: the one on screen is the one to clear.
    this.q<HTMLFormElement>('form[data-act="add-note"]').reset();
    this.drawNotes();
    this.q<HTMLTextAreaElement>('form[data-act="add-note"] textarea').focus();
  }

  protected saveNote(form: HTMLFormElement): void {
    const data = new FormData(form);
    const text = String(data.get('text')).trim();
    if (!text) return;
    const kind = data.get('kind') as Note['kind'];
    const id = form.dataset.id!;
    this.notes!.change((thinking) => {
      const note = thinking.notes.find((n) => n.id === id)!;
      note.kind = kind;
      note.text = text;
      note.group = kind === 'alternative' ? String(data.get('group')).trim() : '';
      note.updated = Date.now();
    });
    this.editing = null;
    this.drawNotes();
    this.focusNote(id);
  }

  protected focusNote(id: string, act = 'edit-note'): void {
    this.shadow.querySelector<HTMLElement>(`.mr-note[data-id="${CSS.escape(id)}"] [data-act="${act}"]`)?.focus();
  }

  protected changeNote(id: string, change: (note: Note) => void): void {
    this.notes!.change((thinking) => change(thinking.notes.find((note) => note.id === id)!));
    this.drawNotes();
  }

  /** The reader has looked again at a changed section: the note is about it as it is now. */
  protected async reconfirm(id: string): Promise<void> {
    const source = this.source!;
    const anchor = this.notes!.thinking.notes.find((note) => note.id === id)!.anchor!;
    // The section was just checked at this commit, and the document is cached.
    const digest = await digestText(sectionText(await this.load(anchor.path), anchor.heading)!);
    if (this.source !== source) return;
    this.changeNote(id, (note) => {
      note.anchor = { ...anchor, commit: source.commit, digest };
    });
    this.anchorStates.set(id, 'current');
    this.drawNotes();
    this.toast(`Reconfirmed at ${shortSha(source.commit)}. Save your notes to keep it.`);
  }

  protected deleteNote(id: string): void {
    this.notes!.change((thinking) => {
      thinking.notes = thinking.notes.filter((note) => note.id !== id);
      for (const note of thinking.notes) note.links = note.links.filter((link) => link !== id);
    });
    this.chosen.delete(id);
    this.drawNotes();
    this.toast('Note deleted. Your saved notes keep it until you save.');
  }

  protected async afterStore(done: Promise<boolean>, success: string, then?: () => void): Promise<void> {
    const ok = await done;
    if (this.closed) return;
    if (ok) {
      then?.();
      this.toast(success);
    }
    this.drawNotes();
  }

  // ---------------------------------------------------------------- export

  protected exportText(): string {
    const source = this.source!;
    const targets = this.targets();
    const ctx: ExportContext = {
      name: source.name,
      ref: source.ref,
      commit: source.commit,
      date: new Date().toISOString().slice(0, 10),
      link: (path, heading) => `${source.links.blob(path)}${heading ? `#${heading}` : ''}`,
      describe: (id) => targets.find((target) => target.id === id)?.label ?? null,
    };
    const thinking = this.notes!.thinking;
    return this.exportFormat === 'markdown' ? exportMarkdown(thinking, this.chosen, ctx) : exportMermaid(thinking, this.chosen, ctx);
  }

  protected drawExport(): void {
    const source = this.source!;
    const notes = this.notes!.thinking.notes;
    const text = notes.some((note) => this.chosen.has(note.id)) ? this.exportText() : '';
    const issue = text ? source.newIssue(`Notes on ${source.name}`, text) : '';
    this.q('.mr-repo-export .mr-settings-panel').replaceChildren(
      ...exportSheet({
        format: this.exportFormat,
        text,
        notes: notes.map((note) => ({
          id: note.id,
          label: note.text.split('\n')[0],
          about: note.anchor ? `${NOTE_NAMES[note.kind]} about ${note.anchor.label}` : NOTE_NAMES[note.kind],
          chosen: this.chosen.has(note.id),
        })),
        issue: issue.length <= MAX_ISSUE_URL ? issue : null,
        platform: source.platform,
      }),
    );
  }

  protected openExport(): void {
    this.drawExport();
    this.openSheet(this.q('.mr-repo-export'), '[data-act="export"]');
  }

  protected downloadExport(): void {
    const markdown = this.exportFormat === 'markdown';
    const url = URL.createObjectURL(new Blob([this.exportText()], { type: markdown ? 'text/markdown' : 'text/plain' }));
    const a = h('a');
    a.href = url;
    a.download = `${this.source!.name.replace(/[^\w.-]+/g, '-')}-notes.${markdown ? 'md' : 'mmd'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // ---------------------------------------------------------------- a review's project context

  protected async showReview(): Promise<void> {
    this.closeMenus();
    this.front = 'review';
    this.setView('review');
    if (!this.index && !(await this.listed('review', this.q('.mr-repo-review'), 'show-review'))) return;
    this.drawReview();
    this.autoIndex();
  }

  protected publishContext(): Map<string, import('../../core/review-context.ts').ReviewRelated[]> {
    const related = new Map([...this.changed].map((path) => [path, relatedDocuments(this.index!, path, this.changed, this.corrections)]));
    const status = [...this.indexStatus().querySelectorAll('p')].map((p) => p.textContent).join(' ');
    if (this.review!.context) this.review!.context.snapshot = { commit: this.source!.commit, status, related };
    return related;
  }

  /**
   * This review on the Documents map (ADR 0030): what the review changes in the middle, chapter by chapter, between the
   * documents that link to it and those it links to, under the same top row as the map; List shows all of it as rows.
   */
  protected drawReview(): void {
    const review = this.review!;
    const source = this.source!;
    this.publishContext();
    const status = h('div', 'mr-review-status');
    status.append(this.indexStatus());
    const configs = new Set(this.listing!.configs.files.map((file) => file.path));
    if ([...this.changed].some((path) => configs.has(path))) status.append(configStatus(this.configState()));
    this.root.classList.add('is-map-space');
    this.reviewMap ??= new DocumentMap({
      preview: (path) => this.preview(path),
      details: (path) => this.mapDetails(path),
      problems: (path) => this.mapProblems(path),
      explore: (path) => {
        this.focus = path;
        void this.showMap();
      },
      sheet: this.sheet,
      claim: () => this.claimSheet(),
      commit: source.commit,
    });
    const head = h('header', 'mr-map-head');
    const at = h('p', 'mr-review-at', `${review.title} · ${review.ref} @ ${shortSha(source.commit)}`);
    at.title = 'The repository as this change leaves it';
    head.append(h('h1', 'mr-title', 'Project map'), lensSwitch('review', true), this.reviewMap.tools, at, status);
    const from = this.shadow.querySelector<HTMLElement>('.mr-repo-read > .mr-review-route')?.cloneNode(true) as HTMLElement | undefined;
    if (from) head.append(from);
    this.q('.mr-repo-review').replaceChildren(head, this.reviewMap.element);
    const paths = review.chapters.flatMap((chapter) => chapter.paths);
    this.reviewMap.draw({
      model: reviewMap(this.index!, this.corrections, paths),
      focus: '',
      here: this.path,
      changed: this.changed,
      review: {
        chapters: review.chapters.map((chapter) => ({ title: chapter.title, paths: chapter.paths, attachments: review.context?.forChapter(chapter.id!) })),
        declares: Object.fromEntries(paths.map((path) => [path, (this.configs.get(path)?.items ?? []).slice(0, 12).map((item) => item.name)])),
      },
    });
  }

  /** What moves when a sheet beside the page narrows or widens it: the view that is shown, and the top bar. */
  protected slidingParts(): NodeListOf<HTMLElement> {
    return this.root.querySelectorAll<HTMLElement>('.mr-main > :not([hidden]), .mr-tb-center, .mr-tb-right');
  }
}
