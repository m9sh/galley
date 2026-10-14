import type { ReviewSource, Thread } from '../../platforms/types.ts';
import { h, glyph } from '../components/dom.ts';
import { icons } from '../components/icons.ts';
import { platformLink, renderSnippet } from '../rendering/render.ts';
import { filterDocument } from '../rendering/reading.ts';
import {
  CARD_GAP,
  FOCUS_LINE,
  RAIL_SPACE,
  type ReplyEditor,
  SUBMIT_KEY,
  type View,
  actionButton,
  blockAt,
  hasDraft,
  nextVisible,
  problem,
  relativeTime,
  session,
  surfaceOf,
} from './reader-shared.ts';
import { ReaderComments } from './reader-comments.ts';

export interface ReaderHandle {
  close(): void;
}

/** Open the reader over the current page. Accepts a promise so it can show loading and errors itself. */
export function openReader(source: ReviewSource | Promise<ReviewSource>, options: { start?: number; onClose?: () => void } = {}): ReaderHandle {
  session.reader?.close();
  const reader = new Reader(options.onClose);
  session.reader = reader;
  Promise.resolve(source).then(
    (s) => reader.setSource(s, options.start ?? 0),
    (err) => reader.showError(err),
  );
  return { close: () => reader.close() };
}
class Reader extends ReaderComments {
  // ---------------------------------------------------------------- threads

  /** Each thread has one reply box, which keeps its draft while the reader is open. */
  protected replyEditor(thread: Thread): ReplyEditor {
    const existing = this.replyEditors.get(thread);
    if (existing) return existing;
    const base = this.createEditor('mr-reply', `Reply to ${thread.comments[0].author}`, 'Write a reply…', 'Reply', () => void this.postReply(thread));
    const editor: ReplyEditor = Object.assign(base, { thread, to: 0, context: h('p', 'mr-reply-context') });
    editor.form.prepend(editor.context);
    editor.form.hidden = true;
    editor.ready = true;
    editor.cancel.addEventListener('click', () => this.closeReply(thread));
    editor.textarea.addEventListener('focus', () => {
      if (!editor.status.textContent) editor.status.textContent = `${SUBMIT_KEY} to reply`;
    });
    this.replyEditors.set(thread, editor);
    return editor;
  }

  /**
   * Reply to one comment, Reddit style: the box opens under it. Platform threads are flat, so an answer
   * to a reply goes to the same thread and names the person it answers.
   */
  protected openReply(thread: Thread, index: number): void {
    const card = this.cardOf(thread)!;
    const comment = thread.comments[index];
    const editor = this.replyEditor(thread);
    const author = comment.author;
    // Mentions use the username; a display name with spaces would mention nobody.
    const handle = comment.handle ?? author;
    const starter = thread.comments[0];
    const mention = index > 0 && author !== 'You' && handle !== (starter?.handle ?? starter?.author) && /^[\w.-]+$/.test(handle) ? `@${handle} ` : '';
    if (!hasDraft(editor)) editor.textarea.value = mention;
    editor.prefill = mention;
    editor.to = index;
    editor.context.textContent = `Replying to ${author}`;
    editor.form.setAttribute('aria-label', `Reply to ${author}`);
    editor.textarea.setAttribute('aria-label', `Reply to ${author}`);
    editor.form.hidden = false;
    card.querySelectorAll('.mr-thread-comment')[index]?.after(editor.form);
    this.fitEditor(editor);
    this.focusEditor(editor);
    const end = editor.textarea.value.length;
    editor.textarea.setSelectionRange(end, end);
  }

  protected closeReply(thread: Thread): void {
    const editor = this.replyEditors.get(thread);
    if (!editor || editor.busy) return;
    const focused = editor.form.contains(this.shadow.activeElement);
    editor.textarea.value = '';
    editor.status.textContent = '';
    editor.form.hidden = true;
    this.fitEditor(editor);
    if (focused) this.cardOf(thread)!.querySelectorAll<HTMLElement>('.mr-reply-to')[editor.to].focus({ preventScroll: true });
  }

  protected async postReply(thread: Thread): Promise<void> {
    const editor = this.replyEditors.get(thread);
    if (!editor || editor.busy || !thread.reply || !hasDraft(editor)) return;
    const body = editor.textarea.value.trim();
    this.setBusy(editor, true);
    editor.status.textContent = 'Posting reply…';
    try {
      const result = await thread.reply(body);
      if (this.closed) return;
      thread.comments.push({ author: 'You', body, createdAt: new Date().toISOString(), url: result.url });
      this.setBusy(editor, false);
      const focused = editor.form.contains(this.shadow.activeElement);
      editor.textarea.value = '';
      editor.status.textContent = '';
      editor.form.hidden = true;
      this.fitEditor(editor);
      this.refreshCard(thread);
      // The conversation continues from the new reply.
      if (focused) [...this.cardOf(thread)!.querySelectorAll<HTMLElement>('.mr-reply-to')].at(-1)!.focus({ preventScroll: true });
      this.toast('Reply posted', result.url);
    } catch (err) {
      if (this.closed) return;
      editor.status.textContent = problem(err);
    } finally {
      this.setBusy(editor, false);
    }
  }

  /** A thread's card: anchored ones are kept for layout, file comments are already on the page. */
  protected cardOf(thread: Thread): HTMLElement | undefined {
    return (
      this.threadEls.find((entry) => this.threadByCard.get(entry.card) === thread)?.card ??
      [...this.root.querySelectorAll<HTMLElement>('.mr-thread')].find((card) => this.threadByCard.get(card) === thread)
    );
  }

  /** Redraw a thread in place, keeping its position and the cursor in its reply box. */
  protected refreshCard(thread: Thread): void {
    const old = this.cardOf(thread)!;
    const editor = this.replyEditors.get(thread);
    const focused = editor?.form.contains(this.shadow.activeElement);
    const card = this.threadCard(thread);
    card.classList.toggle('is-expanded', old.classList.contains('is-expanded'));
    card.style.top = old.style.top;
    card.hidden = old.hidden;
    old.replaceWith(card);
    const entry = this.threadEls.find((item) => item.card === old);
    if (entry) entry.card = card;
    if (this.active === old) this.active = card;
    if (focused) editor?.textarea.focus({ preventScroll: true });
    this.schedule(true);
  }

  protected async loadThreads(): Promise<void> {
    const load = this.source?.loadThreads;
    if (!load) return;
    try {
      const threads = await load();
      if (this.closed) return;
      this.threads.push(...threads);
    } catch {
      // Threads are context; a failure must not get in the way of reading.
      return;
    }
    this.views.forEach((view, index) => {
      if (view.rendered) this.attachThreads(view);
      // A folded file that turns out to have a discussion opens, so the discussion is not missed.
      else if (view.quiet && !view.open && this.threads.some((thread) => thread.doc === view.doc)) void this.openQuiet(index);
    });
    this.schedule(true);
    this.search.refresh();
  }

  /** Anchor this document's threads to the blocks holding their lines; the rest are file comments. */
  protected attachThreads(view: View): void {
    const r = view.rendered!;
    for (const entry of this.threadEls) if (entry.view === view) entry.card.remove();
    this.threadEls = this.threadEls.filter((entry) => entry.view !== view);
    view.section.querySelector('.mr-file-threads')?.remove();
    for (const block of r.blocks) delete block.el.dataset.mrThreads;
    const fileLevel: HTMLElement[] = [];
    for (const thread of this.threads) {
      if (thread.doc !== view.doc) continue;
      const card = this.threadCard(thread);
      const line = thread.line;
      // Old lines are the review's own; while only what changed since is shown, "old" is an earlier head, so they cannot be placed.
      const block = line === null || (thread.side === 'base' && this.sinceActive()) ? undefined : blockAt(r, thread.side, line);
      if (!block) {
        fileLevel.push(card);
        continue;
      }
      block.el.dataset.mrThreads = '';
      this.threadEls.push({ view, card, anchor: block.el });
    }
    if (fileLevel.length) {
      const box = h('section', 'mr-file-threads');
      box.setAttribute('aria-label', 'Comments on this file');
      box.append(h('p', 'mr-file-threads-title', `${fileLevel.length} comment${fileLevel.length === 1 ? '' : 's'} on this file`), ...fileLevel);
      view.section.querySelector('.mr-byline')?.after(box);
    }
    filterDocument(r, this.settings.scope === 'changed');
    this.schedule(true);
  }

  /** A draft's text and posting target survive switching between formatted notes and comments as written. */
  protected reanchorCodeComments(view: View): void {
    for (const draft of this.drafts) {
      if (draft.view !== view || !draft.anchor.closest('[data-mr-comment-view][hidden]')) continue;
      // A line the note leaves out, such as an opening /**, keeps the draft beside its note.
      draft.anchor =
        blockAt(view.rendered!, draft.target.side, draft.target.startLine)?.el ??
        draft.anchor.closest('.mr-source-comment')!.querySelector<HTMLElement>('[data-mr-comment-view]:not([hidden])')!;
      draft.range = undefined;
      draft.marks = [draft.anchor];
      draft.anchor.dataset.mrSpecContext = '';
    }
    this.attachThreads(view);
    this.refreshMarks();
  }

  protected threadCard(thread: Thread): HTMLElement {
    const own = this.ownThreads.has(thread);
    const card = h('aside', `mr-thread${own ? ' is-own' : ''}${thread.resolved ? ' is-resolved' : ''}`);
    this.threadByCard.set(card, thread);
    const first = thread.comments[0];
    card.setAttribute('aria-label', `Comment by ${first.author}${thread.line ? ` on ${thread.side === 'base' ? 'old' : 'new'} line ${thread.line}` : ''}`);
    const fold = thread.comments.length > 3;
    const editor = this.replyEditors.get(thread);
    thread.comments.forEach((comment, i) => {
      const item = h('div', `mr-thread-comment${i ? ' is-reply' : ''}${fold && i > 0 && i < thread.comments.length - 1 ? ' is-folded' : ''}`);
      const meta = h('div', 'mr-thread-meta');
      // A long name is cut short with an ellipsis; the whole name and username stay in its tooltip.
      const name = h('span', 'mr-thread-author', comment.author);
      name.title = comment.handle && comment.handle !== comment.author ? `${comment.author} (@${comment.handle})` : comment.author;
      meta.append(h('span', 'mr-avatar', comment.author.slice(0, 1).toUpperCase()), name);
      const time = h('time', 'mr-thread-time', relativeTime(comment.createdAt));
      time.dateTime = comment.createdAt;
      time.title = new Date(comment.createdAt).toLocaleString();
      meta.append(time);
      const body = h('div', 'mr-thread-body');
      body.append(renderSnippet(document, comment.body, location.origin, this.settings.images));
      item.append(meta, body);
      if (thread.reply) {
        const reply = actionButton('Reply', 'reply-to', 'mr-reply-to');
        reply.prepend(glyph(icons.reply));
        reply.dataset.comment = String(i);
        reply.setAttribute('aria-label', `Reply to ${comment.author}`);
        item.append(reply);
      }
      card.append(item);
      if (editor && !editor.form.hidden && editor.to === i) card.append(editor.form);
      if (fold && i === 0) {
        const more = actionButton(`${thread.comments.length - 2} more replies`, 'toggle-thread', 'mr-thread-more');
        more.dataset.label = more.textContent!;
        card.append(more);
      }
    });
    const foot = h('div', 'mr-thread-foot');
    if (thread.outdated) foot.append(h('span', 'mr-thread-tag', 'Outdated'));
    if (thread.resolved) foot.append(h('span', 'mr-thread-tag', 'Resolved'));
    const href = platformLink(thread.url, location.origin);
    if (href) {
      const link = h('a', 'mr-thread-link', 'View on platform');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      foot.append(link);
    }
    card.append(foot);
    return card;
  }

  /**
   * Wide screens: cards in the comments column, level with their text (for a source file, the column
   * starts where its code ends). Narrow screens: below the text they belong to.
   */
  protected layoutThreads(): void {
    const article = this.el.article.getBoundingClientRect();
    // Focus keeps every conversation below its text, whatever the width.
    const wide = this.settings.layout !== 'focus' && this.root.clientWidth >= 1280 && this.root.clientWidth - article.right >= RAIL_SPACE;
    this.root.classList.toggle('has-rail', wide);
    const entries = [
      ...this.threadEls.map(({ view, card, anchor }) => ({ card, anchor, code: view.doc.kind === 'code' })),
      ...this.drafts.map((draft) => ({ card: draft.form as HTMLElement, anchor: draft.anchor, code: draft.view.doc.kind === 'code' })),
    ];
    const last = new Map<Element, Element>();
    for (const { card, anchor, code } of entries) {
      card.classList.toggle('is-code-card', wide && code);
      if (wide) {
        if (card.parentElement !== this.rail) this.rail.append(card);
      } else {
        card.style.top = '';
        // Below the block and the cards already there, in order. A list item keeps its cards inside it.
        const item = anchor.matches('.mr-tight') ? anchor.closest('li') : null;
        const host = item ?? anchor;
        const before = last.get(host) ?? (item && [...item.children].filter((child) => !child.matches('.mr-thread, .mr-composer')).at(-1)) ?? anchor;
        if (before.nextElementSibling !== card) before.after(card);
        last.set(host, card);
      }
      card.hidden = !anchor.isConnected || Boolean(anchor.closest('[hidden]')) || !anchor.getClientRects().length;
    }
    if (!wide) return;
    const placed = entries
      .filter((entry) => !entry.card.hidden)
      .map((entry, order) => ({
        card: entry.card,
        top: surfaceOf(entry.anchor).getBoundingClientRect().top - article.top,
        height: entry.card.offsetHeight,
        order,
      }))
      .sort((a, b) => a.top - b.top || a.order - b.order);
    // Cards never overlap. The one in use stays level with its text; the others make room around it.
    const tops = placed.map((item) => item.top);
    const pivot = placed.findIndex((item) => item.card === this.active);
    for (let i = Math.max(pivot, 0) + 1; i < placed.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + placed[i - 1].height + CARD_GAP);
    for (let i = pivot - 1; i >= 0; i--) tops[i] = Math.min(tops[i], tops[i + 1] - placed[i].height - CARD_GAP);
    if (tops[0] < 0) {
      for (let i = 0; i < placed.length; i++) tops[i] = Math.max(placed[i].top, i ? tops[i - 1] + placed[i - 1].height + CARD_GAP : 0);
    }
    placed.forEach((item, i) => {
      item.card.style.top = `${tops[i]}px`;
    });
  }

  // ---------------------------------------------------------------- frame updates

  protected schedule(layout: boolean): void {
    if (this.closed) return;
    this.needLayout ||= layout;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.needLayout) {
        if (this.settings.layout === 'fit') this.applyFit();
        this.layoutGutter();
        this.layoutThreads();
        // The comment control is positioned within the article, so only layout can move it.
        this.placeCommentButton();
      }
      this.needLayout = false;
      this.onScroll();
    });
  }

  protected onScroll(): void {
    const root = this.root;
    const top = root.scrollTop;
    const max = root.scrollHeight - root.clientHeight;
    this.el.progress.style.transform = `scaleX(${max > 0 ? Math.min(1, top / max) : 0})`;
    // Source files use the contents column, so the contents give way while one passes beneath them.
    const contents = this.el.toc.firstElementChild;
    if (contents) {
      const box = contents.getBoundingClientRect();
      const beneath = (rect: DOMRect) => rect.top < box.bottom + 32 && rect.bottom > box.top - 32;
      // In the Files layout code starts beside the list, so nothing passes beneath it.
      this.el.toc.classList.toggle(
        'is-covered',
        this.settings.layout !== 'files' &&
          this.views.some((view) => {
            if (view.section.hidden) return false;
            if (view.doc.kind === 'code') return beneath(view.section.getBoundingClientRect());
            // So do code blocks that run wider than the text, into the contents column.
            return [...view.section.querySelectorAll<HTMLElement>('.mr-content > pre')].some((pre) => {
              const rect = pre.getBoundingClientRect();
              return rect.left < box.right + 16 && beneath(rect);
            });
          }),
      );
    }
    this.el.topbar.classList.toggle('is-scrolled', top > 2);
    // Reading on from the top answers the offer to continue elsewhere.
    if (top > this.root.clientHeight) this.el.resume.hidden = true;
    let currentDoc = this.index;
    this.views.forEach((view, i) => {
      if (!view.section.hidden && view.section.getBoundingClientRect().top <= 150) currentDoc = i;
    });
    if (currentDoc !== this.index) {
      this.index = currentDoc;
      this.rendered = this.views[currentDoc].rendered;
      this.updateFileButton();
      this.buildToc(this.rendered);
    }
    if (this.chipTarget?.range) this.placeChip(this.chipTarget.range.getBoundingClientRect());

    let activeHeading = -1;
    this.headings.forEach((hd, i) => {
      if (hd.el.getBoundingClientRect().top < 140) activeHeading = i;
    });
    for (const [i, hd] of this.headings.entries()) hd.link.classList.toggle('is-active', i === activeHeading);

    const list = this.visibleChanges();
    if (!list.length) {
      this.el.pill.hidden = true;
      return;
    }
    this.el.pill.hidden = false;
    const line = root.clientHeight * FOCUS_LINE + 8;
    let current = -1;
    list.forEach((el, i) => {
      if (el.getBoundingClientRect().top <= line) current = i;
    });
    this.el.pillLabel.textContent = current === -1 ? `${list.length} change${list.length === 1 ? '' : 's'}` : `Change ${current + 1} of ${list.length}`;
  }

  /** Draw the change bars in the left margin, merging adjacent blocks of the same kind. */
  protected layoutGutter(): void {
    const gutter = this.el.gutter;
    gutter.replaceChildren();
    this.markTargets = [];
    const origin = this.el.article.getBoundingClientRect().top;
    const spans: Array<{ top: number; bottom: number; kind: string; target: HTMLElement; point: boolean }> = [];
    for (const el of this.el.doc.querySelectorAll<HTMLElement>('[data-mr-change]')) {
      const content = el.closest('.mr-content')!;
      // Code shows its changes line by line, in the block itself, so it needs no bar beside it.
      if (el.closest('[hidden], .is-code') || el.matches('pre')) continue;
      const kind = el.dataset.mrChange!;
      let point = false;
      let rect = el.getBoundingClientRect();
      if (!el.getClientRects().length) {
        const next = nextVisible(el, content);
        if (!next) continue;
        rect = next.getBoundingClientRect();
        point = true;
      }
      const top = point ? rect.top - origin - 10 : rect.top - origin;
      const bottom = point ? top + 7 : rect.bottom - origin;
      const last = spans[spans.length - 1];
      if (last && !point && !last.point && last.kind === kind && top - last.bottom < 16) {
        last.bottom = Math.max(last.bottom, bottom);
        continue;
      }
      spans.push({ top, bottom, kind, target: el, point });
    }
    const label: Record<string, string> = { added: 'Added', modified: 'Edited', removed: 'Removed' };
    spans.forEach((s, i) => {
      const mark = h('div', `mr-mark is-${s.kind}${s.point ? ' is-point' : ''}`);
      mark.style.top = `${s.top}px`;
      mark.style.height = `${Math.max(4, s.bottom - s.top)}px`;
      mark.dataset.label = label[s.kind];
      mark.dataset.act = 'mark';
      mark.dataset.i = String(i);
      this.markTargets.push(s.point ? (nextVisible(s.target, s.target.closest('.mr-content')!) as HTMLElement) : s.target);
      gutter.append(mark);
    });
  }
}
