import type { RepoDiscovery } from '../../core/discovery.ts';
import { ProjectIndex } from '../../core/docindex.ts';
import { ReaderError, type RepositorySource } from '../../platforms/types.ts';
import { button, h } from '../components/dom.ts';
import { icons } from '../components/icons.ts';
import { ProjectNotes } from './project-store.ts';
import { external } from './repo-views.ts';
import { edgeKey, plural, problem, session, shortSha } from './repo-reader-shared.ts';
import { RepoReaderBase } from './repo-reader-base.ts';

/** Reading a snapshot: opening the repository, listing it, reading and caching its documents, and refreshing to a newer commit. */
export abstract class RepoReaderSource extends RepoReaderBase {
  /** Where the reader came from in the review, and the way on with that chapter. */
  protected continueBar(title: string, enabled: boolean): HTMLElement {
    const bar = h('nav', 'mr-review-route');
    bar.setAttribute('aria-label', 'Review chapter');
    const where = h('span', 'mr-review-route-text', 'From the review chapter ');
    where.append(h('strong', '', title));
    const next = button('Continue chapter', 'continue-chapter', 'mr-btn mr-review-continue');
    // biome-ignore lint/plugin: a bundled icon constant, never document content.
    next.insertAdjacentHTML('beforeend', icons.chevronRight);
    next.title = 'Back to the review, at the next part of this chapter';
    next.disabled = !enabled;
    bar.append(where, next);
    return bar;
  }

  // ---------------------------------------------------------------- source

  setSource(source: RepositorySource): void {
    if (this.closed) return;
    this.source = source;
    this.showSnapshot();
    // Notes belong to the repository, not the commit: a refresh keeps them.
    const notes = new ProjectNotes(source.id);
    this.notes = notes;
    void notes.load().then(() => {
      if (this.closed) return;
      this.applyCorrections();
      this.redraw();
      if (this.view === 'notes') void this.checkAnchors();
    });
    // Opened from a review, the reader starts at what the review changes.
    if (this.review?.entry?.path) {
      void this.open(this.review.entry.path, this.review.entry);
      void this.discover().then(
        () => {
          if (!this.closed) this.autoIndex();
        },
        () => {},
      );
    } else if (this.review) void this.showReview();
    else this.start();
  }

  /** The document the reader was opened at; a folder or the repository opens at its README, else its first document. */
  protected start(): void {
    const source = this.source!;
    if (!source.start.folder) {
      void this.open(source.start.path);
      return;
    }
    void this.discover().then(
      (found) => {
        const folder = source.start.path;
        const inside = found.docs.find((doc) => !folder || doc.path.startsWith(`${folder}/`));
        const start = this.index!.documentAt(folder) ?? inside?.path ?? this.index!.documentAt('') ?? found.docs[0]?.path;
        if (start) void this.open(start);
        else
          this.message('No documents here', `Galley found no Markdown files in ${source.name} at ${shortSha(source.commit)}.`, [
            external(`Open on ${source.platform}`, source.url, 'mr-btn mr-outline'),
          ]);
      },
      (err) => {
        const { title, hint } = problem(err);
        this.message(title, hint, [button('Try again', 'retry-list')]);
      },
    );
  }

  showError(err: unknown): void {
    if (this.closed) return;
    const e = err instanceof ReaderError ? err : new ReaderError('Galley could not open this repository.', err instanceof Error ? err.message : String(err));
    const extra: Node[] = [];
    if (e.needsToken) {
      const p = h('p');
      p.append(
        external('Create a fine-grained token', 'https://github.com/settings/personal-access-tokens/new'),
        ' with read-only access to Contents, then click the Galley icon in your browser toolbar to save it.',
      );
      extra.push(p);
    }
    this.message(e.message, e.hint, extra);
  }

  close(action?: 'continue'): void {
    if (this.closed) return;
    if (this.review?.context && this.index) this.publishContext();
    this.closed = true;
    if (this.indexing) this.indexing.cancelled = true;
    if (this.config.run) this.config.run.cancelled = true;
    this.mapView?.destroy();
    this.reviewMap?.destroy();
    this.blobs.clear();
    this.notes?.flush();
    for (const type of ['keydown', 'keyup', 'keypress']) window.removeEventListener(type, this.shield, true);
    this.dark.removeEventListener('change', this.onSchemeChange);
    clearTimeout(this.toastTimer);
    this.host.remove();
    document.documentElement.style.overflow = this.prevOverflow;
    if (this.prevFocus instanceof HTMLElement) this.prevFocus.focus({ preventScroll: true });
    session.reader = null;
    this.onClose?.(action);
  }

  /** The repository listing, once per snapshot; a failed listing can be tried again. */
  protected discover(): Promise<RepoDiscovery> {
    const source = this.source!;
    this.discovery ??= source.discover().then(
      (found) => {
        if (this.source === source) {
          this.listing = found;
          for (const doc of [...found.docs, ...found.configs.files]) if (doc.blob !== undefined) this.blobOf.set(doc.path, doc.blob);
          this.index = new ProjectIndex(found.docs.map((doc) => doc.path));
          // Documents already read in this snapshot count for the map at once, and are remembered by their hash.
          for (const [path, pending] of this.cache) this.keep(path, pending);
          for (const [path, text] of this.read) this.index.add(this.indexed(path, text));
          this.buildOutline();
          this.updateBacklinks();
        }
        return found;
      },
      (err) => {
        this.discovery = null;
        throw err;
      },
    );
    return this.discovery;
  }

  /** One document at this snapshot's commit: one already read with the same content is not read again. */
  protected load(path: string): Promise<string> {
    let text = this.cache.get(path);
    if (!text) {
      const blob = this.blobOf.get(path);
      const kept = blob === undefined ? undefined : this.blobs.text(blob);
      text = kept === undefined ? this.source!.load(path) : Promise.resolve(kept);
      this.cache.set(path, text);
      text.catch(() => this.cache.delete(path));
      if (kept === undefined) this.keep(path, text);
    }
    return text;
  }

  /** Remember a document by its hash once it is read, and once the listing has said what the hash is. */
  protected keep(path: string, pending: Promise<string>): void {
    const blob = this.blobOf.get(path);
    if (blob !== undefined)
      void pending.then(
        (text) => this.blobs.put(blob, text),
        () => undefined,
      );
  }

  /** What the map learns from a document, reused when the same content was read at this path before. */
  protected indexed(path: string, text: string) {
    return this.blobs.indexed(this.blobOf.get(path), path, text);
  }

  protected showSnapshot(): void {
    const source = this.source!;
    const at = shortSha(source.commit);
    const where = source.ref ?? 'default branch';
    const refresh = this.q('[data-act="refresh"]');
    refresh.hidden = false;
    this.q('.mr-repo-commit-label').textContent = at;
    // A commit, or a review's base or head, never moves; a branch or tag can be checked again.
    const pinned = source.pinned;
    refresh.toggleAttribute('disabled', pinned);
    refresh.title = pinned
      ? `Reading commit ${source.commit}`
      : `Reading ${where} at commit ${source.commit}. Every document comes from this commit. Choose to check for a newer one.`;
    refresh.setAttribute('aria-label', pinned ? `Reading commit ${at}` : `Reading ${where} at ${at}. Check for a newer commit`);
    this.q('.mr-files-title').textContent = source.name;
    this.updateListMeta();
  }

  protected updateListMeta(): void {
    const source = this.source!;
    const count = this.listing ? ` · ${plural(this.listing.docs.length, 'document')}` : '';
    this.q('.mr-files-meta').textContent = `${source.ref ?? 'Default branch'} · ${shortSha(source.commit)}${count}`;
  }

  /** Check the branch or tag again. A new commit is a new snapshot: listing and map start over. */
  protected async refresh(): Promise<void> {
    const before = this.source!;
    const control = this.q<HTMLButtonElement>('[data-act="refresh"]');
    control.disabled = true;
    let next: RepositorySource;
    try {
      next = await before.refresh();
    } catch (err) {
      if (!this.closed) {
        control.disabled = false;
        this.toast(problem(err).title);
      }
      return;
    }
    if (this.closed || this.source !== before) return;
    control.disabled = false;
    if (next.commit === before.commit) {
      this.toast(`Up to date: ${before.ref ?? 'the default branch'} is still at ${shortSha(before.commit)}.`);
      return;
    }
    if (this.indexing) this.indexing.cancelled = true;
    this.indexing = null;
    if (this.config.run) this.config.run.cancelled = true;
    // What was read before, to say which links changed and which notes need another look.
    if (this.index?.docs.size)
      this.previous = {
        commit: before.commit,
        read: new Set(this.index.docs.keys()),
        edges: new Set(this.index.edges.map((edge) => edgeKey(edge.from, edge.to))),
      };
    this.configs.clear();
    this.config = { state: 'idle', read: 0, notes: [], run: null };
    this.entityFocus = null;
    // The map's camera, selection and places start over at a new commit; its middle stays if it is still there.
    this.mapView?.destroy();
    this.mapView = null;
    this.reviewMap?.destroy();
    this.reviewMap = null;
    this.source = next;
    this.discovery = null;
    this.listing = null;
    this.index = null;
    this.cache.clear();
    this.blobOf.clear();
    this.read.clear();
    this.unreadable.failed.clear();
    this.unreadable.skipped.clear();
    this.indexedOnce = false;
    const hadSequence = this.sequence.items.length > 0;
    this.sequence.clear();
    this.updateSequence();
    this.showSnapshot();
    this.toast(
      `Now reading ${shortSha(next.commit)}. It was ${shortSha(before.commit)}.${hadSequence ? ' Your reading sequence was cleared for the new commit.' : ''}`,
    );
    this.anchorStates = new Map();
    void this.checkAnchors();
    if (this.view !== 'read') {
      // The document is read again at the new commit when the reader goes back to it.
      this.rendered = null;
      this.q('.mr-doc').replaceChildren(this.skeleton());
      if (this.view === 'map') await this.showMap();
      else if (this.view === 'review') await this.showReview();
      else if (this.view === 'chapters') this.showSequence();
      else this.drawNotes();
    } else if (this.path) await this.open(this.path, { push: false });
    // Nothing was open, such as a repository without documents: start again at the new commit.
    else this.start();
  }
}
