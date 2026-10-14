import type { DocContents, DocRef, SinceFile } from '../../platforms/types.ts';
import { chip, h } from '../components/dom.ts';
import { MoveFinder } from './moves.ts';
import { baselineFor, loadRevisions, markReviewed, rememberSeen, unmarkReviewed } from './revisions.ts';
import { type RevisionState, type Shown, type View, actionButton, problem, shortCommit } from './reader-shared.ts';
import { ReaderDocuments } from './reader-documents.ts';

/**
 * What changed since the reviewer last looked (RFC 0039, ADR 0034): the bar above the documents, reading only what changed
 * since, the mark that a version is reviewed, and the chips that say which files changed.
 */
export abstract class ReaderSince extends ReaderDocuments {
  /** Remember this open, then ask the platform what changed since the earlier head the reviewer would expect. */
  protected async initRevisions(): Promise<void> {
    const { diffUrl, history } = this.source!;
    await rememberSeen(diffUrl, history!.head);
    const stored = await loadRevisions(diffUrl);
    if (this.closed) return;
    const state: RevisionState = {
      head: history!.head,
      stored,
      baseline: baselineFor(stored, history!.head),
      outcome: null,
      active: false,
      bar: h('section', 'mr-since'),
      foot: h('section', 'mr-reviewed'),
    };
    state.bar.setAttribute('aria-label', 'Changes since you last looked');
    state.foot.setAttribute('aria-label', 'Mark this version as reviewed');
    this.revisions = state;
    this.el.doc.before(state.bar);
    this.el.doc.after(state.foot);
    // The mark below the documents does not wait for the platform.
    this.drawRevisions();
    await this.compare();
  }

  /** Ask the platform how the review stands against the baseline, and show what it says. */
  protected async compare(): Promise<void> {
    const state = this.revisions!;
    const baseline = state.baseline;
    state.outcome = null;
    if (baseline) {
      try {
        state.outcome = await this.source!.history!.since(baseline.commit);
      } catch (err) {
        state.outcome = { state: 'failed', message: problem(err) };
      }
    }
    // Marked as reviewed, or compared again, while the platform was answering.
    if (this.closed || state.baseline !== baseline) return;
    this.drawRevisions();
    this.refreshUpdated();
  }

  /** The file that changed since the baseline, if this document did. */
  protected changedSince(doc: DocRef): SinceFile | undefined {
    const outcome = this.revisions?.outcome;
    return outcome?.state === 'changes' ? outcome.files.find((file) => file.path === doc.path) : undefined;
  }

  protected sinceActive(): boolean {
    return Boolean(this.revisions?.active);
  }

  /** While only what changed is shown, the documents that did not change are out of the way. */
  protected leftOut(doc: DocRef): boolean {
    return this.sinceActive() && !this.changedSince(doc);
  }

  /** The short id of the head the document changed since, or null. */
  protected updatedSince(doc: DocRef): string | null {
    const baseline = this.revisions?.baseline;
    return baseline && !this.sinceActive() && this.changedSince(doc) ? shortCommit(baseline.commit) : null;
  }

  /** The document as the reader draws it: the review's own, or against its earlier version while only what changed since is shown. */
  protected async shown(view: View, contents: DocContents): Promise<Shown> {
    const outcome = this.revisions?.outcome;
    const file = this.changedSince(view.doc);
    if (!this.sinceActive() || outcome?.state !== 'changes' || !file) return { doc: view.doc, contents };
    let read = this.earlier.get(view.doc);
    if (!read) {
      read = outcome.read(view.doc);
      this.earlier.set(view.doc, read);
      read.catch(() => this.earlier.delete(view.doc));
    }
    return { doc: { ...view.doc, oldPath: file.oldPath, status: file.status }, contents: { base: await read, head: contents.head } };
  }

  /** Show only what changed since the baseline, or the whole review again. Returns whether it did: unsent comments stay where they are written. */
  protected setSinceMode(active: boolean): boolean {
    const state = this.revisions!;
    if (state.active === active) return true;
    if (this.drafts.length) {
      this.toast('Post or discard your new comments first, then change the view.');
      return false;
    }
    state.active = active;
    this.closeMenus();
    // Moves are found between the files as drawn, so a new drawing starts a new search.
    this.moves = new MoveFinder();
    for (const view of this.views) {
      view.section.hidden = this.leftOut(view.doc) || (view.doc.kind === 'code' && !this.settings.codeFiles);
      view.rendered = null;
      view.quiet = undefined;
      view.folded = false;
      view.failed = false;
      view.section.classList.remove('is-quiet', 'is-folded');
      view.section.replaceChildren(this.skeleton());
    }
    this.drawRevisions();
    this.refreshUpdated();
    this.root.scrollTo({ top: 0 });
    void this.loadAll(0);
    return true;
  }

  protected toggleSince(): void {
    const state = this.revisions;
    if (state?.outcome?.state !== 'changes' || (!state.active && !this.changedCount())) return;
    this.setSinceMode(!state.active);
  }

  protected async markReviewedNow(): Promise<void> {
    const state = this.revisions!;
    if (!this.setSinceMode(false)) return;
    await markReviewed(this.source!.diffUrl, state.head);
    state.stored = await loadRevisions(this.source!.diffUrl);
    state.baseline = baselineFor(state.stored, state.head);
    state.outcome = null;
    this.drawRevisions();
    this.refreshUpdated();
    this.toast('Marked as reviewed. Next time, Galley shows what changes after this version.');
  }

  protected async unmarkReviewedNow(): Promise<void> {
    const state = this.revisions!;
    await unmarkReviewed(this.source!.diffUrl);
    state.stored = await loadRevisions(this.source!.diffUrl);
    state.baseline = baselineFor(state.stored, state.head);
    state.outcome = null;
    this.drawRevisions();
    await this.compare();
  }

  /** The documents and code files the reader shows, which changed since the baseline, and how many it shows. */
  protected changedCount(): number {
    return this.shownViews().filter((view) => this.changedSince(view.doc)).length;
  }

  protected shownViews(): View[] {
    return this.views.filter((view) => view.doc.kind !== 'code' || this.settings.codeFiles);
  }

  /** The chip on a file's byline that says it changed since the baseline, drawn when the platform has answered and the file has loaded. */
  protected markUpdated(view: View): void {
    const meta = view.section.querySelector('.mr-file-meta');
    meta?.querySelector('.is-updated')?.remove();
    const since = this.updatedSince(view.doc);
    if (meta && since) meta.append(chip('updated', `Updated since ${since}`));
  }

  /** Every file's chip and the files menu, after the platform's answer or a change of view. */
  protected refreshUpdated(): void {
    for (const view of this.views) this.markUpdated(view);
    this.updateFileButton();
  }

  /** The bar above the documents and the mark below them, from what the reader knows now. */
  protected drawRevisions(): void {
    const state = this.revisions!;
    const { baseline, outcome } = state;
    const since = baseline?.kind === 'reviewed' ? 'you marked this reviewed' : 'you last opened this';
    const commit = baseline ? shortCommit(baseline.commit) : '';
    const changed = this.changedCount();
    const total = this.shownViews().length;
    let title = '';
    let meta = '';
    const actions: HTMLButtonElement[] = [];
    if (outcome?.state === 'changes') {
      if (state.active) {
        title = `Showing what changed since ${commit}`;
        meta = `${changed} of ${total} files, ${commit} → ${shortCommit(state.head)}. To comment on removed text, show the whole review.`;
      } else {
        title = `New changes since ${since}`;
        meta = changed
          ? `${changed} of ${total} files changed since ${commit}.`
          : outcome.files.length
            ? 'None of the files Galley shows changed. Other files did.'
            : `The files are the same as at ${commit}.`;
      }
      if (changed || state.active) actions.push(this.sinceToggle(state.active));
    } else if (outcome?.state === 'rewritten') {
      title = `The branch was rewritten since ${since}`;
      meta = 'Galley cannot tell which parts are new, so the whole review is shown.';
    } else if (outcome?.state === 'unavailable') {
      title = 'The earlier version is no longer available';
      meta = `It was at ${commit}. The whole review is shown.`;
    } else if (outcome?.state === 'incomplete') {
      title = 'Too many files changed to compare';
      meta = `Galley cannot list every file that changed since ${commit}, so the whole review is shown.`;
    } else if (outcome?.state === 'failed') {
      title = 'Could not compare with the earlier version';
      meta = outcome.message;
      actions.push(actionButton('Try again', 'retry-since', 'mr-outline'));
    }
    state.bar.hidden = !title;
    state.bar.classList.toggle('is-active', state.active);
    if (title) {
      const text = h('div', 'mr-since-text');
      text.append(h('p', 'mr-since-title', title), h('p', 'mr-since-meta', meta));
      actions.push(actionButton('Mark as reviewed', 'mark-reviewed', 'mr-outline'));
      const buttons = h('div', 'mr-since-actions');
      buttons.append(...actions);
      state.bar.replaceChildren(text, buttons);
    } else state.bar.replaceChildren();

    const marked = state.stored.reviewed === state.head;
    const note = h(
      'p',
      'mr-reviewed-text',
      marked ? `Marked as reviewed at ${shortCommit(state.head)}.` : 'Mark this version as reviewed to see what changes after it.',
    );
    const caption = h('p', 'mr-reviewed-note', 'Saved on this device only. It does not approve the review or mark files Viewed.');
    const words = h('div', 'mr-reviewed-words');
    words.append(note, caption);
    state.foot.replaceChildren(
      words,
      marked ? actionButton('Unmark', 'unmark-reviewed', 'mr-outline') : actionButton('Mark as reviewed', 'mark-reviewed', 'mr-outline'),
    );
  }

  private sinceToggle(active: boolean): HTMLButtonElement {
    const toggle = actionButton(active ? 'Show the whole review' : 'Show only what changed', 'since', active ? 'mr-outline' : 'mr-primary');
    toggle.title = `${toggle.textContent} (U)`;
    return toggle;
  }
}
