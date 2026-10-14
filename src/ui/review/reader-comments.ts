import type { CommentTarget, CommentPlan, Thread } from '../../platforms/types.ts';
import { h } from '../components/dom.ts';
import { platformLink, type RenderedBlock } from '../rendering/render.ts';
import { paragraphTarget, selectionTarget } from '../rendering/reading.ts';
import {
  AIM_DELAY,
  type ChipTarget,
  type Draft,
  type Editor,
  FOCUS_LINE,
  type Hit,
  LANE_OFFSETS,
  SUBMIT_KEY,
  type View,
  hasDraft,
  placeName,
  problem,
  sameTarget,
  surfaceOf,
} from './reader-shared.ts';
import { ReaderEvents } from './reader-events.ts';

/** Selecting text, drafting, posting and replying to comments. */
export abstract class ReaderComments extends ReaderEvents {
  // ---------------------------------------------------------------- comments
  //
  // A comment starts from the text: select some words, point at a block and choose the control beside
  // it, tap a paragraph on a touch screen, or press R. Its editor opens where the thread will appear,
  // in the comments column or below the block on narrow screens, and keeps its draft until it is
  // posted or cancelled. Replies are written inside their thread.

  protected hitFor(view: View, block: RenderedBlock, el?: Element): Hit {
    const version = el?.closest<HTMLElement>('.mr-diagram-version') ?? null;
    const old = el?.closest('.mr-ghost-row, [data-mr-side="base"]');
    return { view, block, side: old || !block.head ? 'base' : 'head', el: version ?? block.el };
  }

  /** The innermost rendered block containing `node`. */
  protected blockAt(node: Element): Hit | null {
    for (let el: Element | null = node; el && !el.matches('.mr-document'); el = el.parentElement) {
      if (el.matches('.mr-thread, .mr-composer')) return null;
      const entry = this.blockOf.get(el);
      if (entry) return this.hitFor(entry.view, entry.block, node);
    }
    return null;
  }

  protected onHover(node: Element, e?: Event): void {
    const hit = this.blockAt(node);
    if (!hit || (hit.el === this.hover?.el && hit.side === this.hover.side)) return;
    // On the way to the comment control, trackPointer decides whether this block takes it.
    if (e instanceof MouseEvent && this.aiming(e.clientX, e.clientY)) return;
    this.hoverBlock(hit, e);
  }

  protected hoverBlock(hit: Hit, e?: Event): void {
    clearTimeout(this.aimTimer);
    if (this.hover) surfaceOf(this.hover.el).classList.remove('mr-hovered');
    this.hover = hit;
    this.aim = e instanceof MouseEvent ? { x: e.clientX, y: e.clientY } : null;
    surfaceOf(hit.el).classList.toggle('mr-hovered', hit.view.doc.kind === 'code');
    this.placeCommentButton();
    this.heatMark(hit.el);
  }

  /**
   * Heading for the comment control: inside the triangle from the last point on the hovered block to the
   * control's near edge, or level with the control past that edge. Menus use the same rule for submenus.
   */
  protected aiming(x: number, y: number): boolean {
    if (!this.aim || this.commentBtn.hidden) return false;
    const box = this.commentBtn.getBoundingClientRect();
    const edge = box.left >= this.aim.x ? box.left : box.right;
    const progress = (x - this.aim.x) / (edge - this.aim.x);
    if (!(progress > 0)) return false;
    if (progress >= 1) return y >= box.top - 8 && y <= box.bottom + 8;
    const top = this.aim.y + (box.top - 8 - this.aim.y) * progress;
    const bottom = this.aim.y + (box.bottom + 8 - this.aim.y) * progress;
    return y >= Math.min(top, bottom) && y <= Math.max(top, bottom);
  }

  /** The change marker beside the text being pointed at comes to full strength. */
  protected heatMark(block: HTMLElement | null): void {
    const origin = this.el.article.getBoundingClientRect().top;
    const box = block ? surfaceOf(block).getBoundingClientRect() : null;
    for (const mark of this.el.gutter.children as HTMLCollectionOf<HTMLElement>) {
      const top = parseFloat(mark.style.top),
        bottom = top + parseFloat(mark.style.height);
      mark.classList.toggle('is-hot', Boolean(box && box.top - origin < bottom && box.bottom - origin > top));
    }
  }

  /** The control stays while the pointer crosses the margin towards it, and goes anywhere else. */
  protected trackPointer(e: PointerEvent): void {
    const node = e.composedPath()[0];
    if (e.pointerType === 'touch' || !(node instanceof Element)) return;
    if (node.closest('.mr-comment-btn')) {
      clearTimeout(this.aimTimer);
      return;
    }
    const over = this.blockAt(node);
    if (this.hover && over?.el === this.hover.el) {
      clearTimeout(this.aimTimer);
      this.aim = { x: e.clientX, y: e.clientY };
      return;
    }
    if (this.aiming(e.clientX, e.clientY)) {
      clearTimeout(this.aimTimer);
      if (over) this.aimTimer = window.setTimeout(() => this.hoverBlock(over), AIM_DELAY);
      return;
    }
    // On wide screens the comments column is a lane: pointing into it, level with any text, offers to
    // comment on that text. Between blocks the nearest text takes it; far from any, the control stays.
    const article = this.el.article.getBoundingClientRect();
    if (
      this.root.classList.contains('has-rail') &&
      e.clientX >= article.right &&
      !node.closest('.mr-thread, .mr-composer, .mr-topbar, .mr-settings, .mr-menu')
    ) {
      let hit: Hit | null = null;
      for (const offset of LANE_OFFSETS) {
        const probe = this.shadow.elementFromPoint((article.left + article.right) / 2, e.clientY + offset);
        hit = probe && this.blockAt(probe);
        if (hit) break;
      }
      if (hit && hit.el !== this.hover?.el) this.hoverBlock(hit, e);
      return;
    }
    if (!this.hover) return;
    const block = surfaceOf(this.hover.el).getBoundingClientRect();
    const control = this.commentBtn.hidden ? block : this.commentBtn.getBoundingClientRect();
    const reach = this.commentBtn.hidden ? article.right : control.right;
    // A one-line target can be shorter than its comment control. Include both in the bridge so the
    // control and the target highlight survive a diagonal move into the input invitation.
    const across =
      e.clientY >= Math.min(block.top, control.top) - 8 &&
      e.clientY <= Math.max(block.bottom, control.bottom) + 8 &&
      e.clientX >= block.left - 8 &&
      e.clientX <= reach + 8;
    if (!across || node.closest('.mr-thread, .mr-composer, .mr-topbar')) this.clearHover();
  }

  protected clearHover(): void {
    clearTimeout(this.aimTimer);
    if (!this.hover) return;
    surfaceOf(this.hover.el).classList.remove('mr-hovered');
    this.hover = null;
    this.commentBtn.hidden = true;
    this.heatMark(null);
  }

  /** Pointing at a card, or at the comment control, marks the text it belongs to. */
  protected linkCard(node: Element): void {
    const card = node.closest<HTMLElement>('.mr-thread, .mr-composer, .mr-comment-btn');
    const anchor = card === this.commentBtn ? this.hover?.el : card ? this.anchorOf(card) : undefined;
    const el = anchor ? surfaceOf(anchor) : null;
    if (el === this.linked) return;
    this.linked?.classList.remove('mr-linked');
    el?.classList.add('mr-linked');
    this.linked = el;
  }

  protected anchorOf(card: Element): HTMLElement | undefined {
    return this.threadEls.find((entry) => entry.card === card)?.anchor ?? this.drafts.find((draft) => draft.form === card)?.anchor;
  }

  /** The card in use is the one the comments column is arranged around. */
  protected onFocusIn(node: Element): void {
    const card = node.closest<HTMLElement>('.mr-thread, .mr-composer');
    if (!card || card === this.active) return;
    this.active = card;
    this.schedule(true);
  }

  /** Beside the hovered block: a placeholder in the comments column, or a small button in the margin. */
  protected placeCommentButton(): void {
    const button = this.commentBtn;
    const hover = this.hover;
    const el = hover?.el;
    // A block that is already being commented on has its editor beside it.
    button.hidden =
      !el?.isConnected || Boolean(el.closest('[hidden]')) || !el.getClientRects().length || this.drafts.some((draft) => !draft.range && draft.anchor === el);
    if (button.hidden || !hover || !el) return;
    const article = this.el.article.getBoundingClientRect();
    const first = el.getClientRects()[0];
    const line = parseFloat(getComputedStyle(el).lineHeight) || first.height;
    const middle = first.top - article.top + Math.min(line, first.height) / 2;
    // Wide screens: in the comments column, which starts where a source file's code ends. Otherwise
    // just past the text or the code.
    const lane = this.root.classList.contains('has-rail');
    const column = (!lane && el.closest('.mr-code-lines')) || this.el.article;
    const right = column.getBoundingClientRect().right;
    button.classList.toggle('is-lane', lane);
    button.classList.toggle('is-beside-code', lane && hover.view.doc.kind === 'code');
    button.classList.remove('is-gap');
    button.classList.toggle('is-compact', !lane && this.root.clientWidth - right < 140);
    // A hit always carries the side its block has.
    const unit = (hover.side === 'base' ? hover.block.base : hover.block.head)!;
    const label = `Comment on ${placeName(hover.side, unit.lines[0] + 1, unit.lines[1])}`;
    button.setAttribute('aria-label', label);
    button.title = `${label} (R)`;
    button.querySelector('.mr-comment-btn-label')!.textContent = lane ? 'Add a comment…' : 'Comment';
    if (!lane) {
      button.hidden = this.root.clientWidth - right < 60;
      button.style.left = `${right - article.left + 14}px`;
      button.style.top = `${middle}px`;
      return;
    }
    button.style.left = '';
    // In the comments column: level with the block, or just below the conversation already beside it.
    const height = button.offsetHeight || 40;
    let top = middle - height / 2;
    const cards = [...(this.rail.children as HTMLCollectionOf<HTMLElement>)].filter((card) => !card.hidden).sort((a, b) => a.offsetTop - b.offsetTop);
    for (const card of cards) {
      if (top < card.offsetTop + card.offsetHeight + 8 && top + height > card.offsetTop - 8) top = card.offsetTop + card.offsetHeight + 8;
    }
    // Code keeps the full invitation below any existing discussion. Its line stays highlighted and
    // the pointer bridge reaches the control even when the discussion pushes it down.
    const gap = hover.view.doc.kind !== 'code' && top > surfaceOf(el).getBoundingClientRect().bottom - article.top;
    button.classList.toggle('is-gap', gap);
    button.style.top = `${gap ? middle : top}px`;
  }

  protected commentOn(hit: Hit): void {
    this.startComment(paragraphTarget(hit.view.doc, hit.block, hit.side)!, [hit.el]);
  }

  /** R: the selected words if there are any, otherwise the block nearest the reading line. */
  protected commentHere(): void {
    if (this.shadowSelection()?.isCollapsed === false) {
      this.captureSelection();
      if (this.chipTarget?.range) this.startComment(this.chipTarget.target, this.chipTarget.elements, this.chipTarget.range);
      return;
    }
    const line = this.root.clientHeight * FOCUS_LINE;
    let best: Hit | null = null;
    let distance = Infinity;
    for (const view of this.views) {
      for (const block of view.rendered?.blocks ?? []) {
        if (!block.el.getClientRects().length || block.el.closest('[hidden]')) continue;
        const rect = block.el.getBoundingClientRect();
        if (rect.bottom < 60 || rect.top > this.root.clientHeight) continue;
        const d = rect.top <= line && rect.bottom >= line ? 0 : Math.min(Math.abs(rect.top - line), Math.abs(rect.bottom - line));
        if (d < distance) {
          best = this.hitFor(view, block);
          distance = d;
        }
      }
    }
    if (best) this.commentOn(best);
  }

  protected shadowSelection(): Selection | null {
    return (this.shadow as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.() ?? document.getSelection();
  }

  /** Selected text gets a small Comment chip; nothing opens until it is chosen. */
  protected captureSelection(event?: MouseEvent): void {
    const origin = event?.target as Element | undefined;
    if (origin && (!origin.closest('.mr-content') || origin.closest('.mr-composer, .mr-thread, .mr-select-chip'))) return;
    const selection = this.shadowSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const view = this.views.find((v) => v.section.contains(range.startContainer) && v.section.contains(range.endContainer));
    const inCard = () =>
      [range.startContainer, range.endContainer].some((node) => (node instanceof Element ? node : node.parentElement!).closest('.mr-composer, .mr-thread'));
    if (!view?.rendered || inCard()) {
      this.hideChip();
      return;
    }
    const rect = [...range.getClientRects()].filter((r) => r.width && r.height).at(-1) ?? range.getBoundingClientRect();
    const target = selectionTarget(view.doc, view.rendered.blocks, range);
    if (!target) {
      this.showChip(rect, null, 'Select text within one file and one version (old or new) to comment');
      return;
    }
    const elements = view.rendered.blocks.filter((block) => range.intersectsNode(block.el)).map((block) => block.el);
    this.showChip(rect, { target, elements, range: range.cloneRange() });
  }

  /** On touch screens a tap on a paragraph offers the chip for that paragraph. */
  protected onTap(e: PointerEvent, node: Element): void {
    if (node.closest('a, button, summary, input, textarea, .mr-thread, .mr-composer') || !this.shadowSelection()?.isCollapsed) return;
    const hit = this.blockAt(node);
    const target = hit && paragraphTarget(hit.view.doc, hit.block, hit.side);
    if (!hit || !target) {
      this.hideChip();
      return;
    }
    this.showChip(new DOMRect(e.clientX, e.clientY, 0, 0), { target, elements: [hit.el] });
  }

  protected showChip(rect: DOMRect, target: ChipTarget | null, problem?: string): void {
    const chip = this.el.chip as HTMLButtonElement;
    this.chipTarget = target;
    chip.disabled = !target;
    chip.title = problem ?? 'Comment on this text (R)';
    chip.hidden = false;
    this.placeChip(rect);
  }

  protected placeChip(rect: DOMRect): void {
    const chip = this.el.chip;
    const width = chip.offsetWidth || 110;
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, this.root.clientWidth - width - 8));
    const above = rect.top - 52;
    chip.style.left = `${left}px`;
    chip.style.top = `${above > 60 ? above : rect.bottom + 10}px`;
  }

  protected hideChip(): void {
    this.el.chip.hidden = true;
    this.chipTarget = null;
  }

  /** Open an editor for a new comment beside its text. Choosing the same text again returns to it. */
  protected startComment(target: CommentTarget, elements: HTMLElement[], range?: Range): void {
    this.hideChip();
    this.el.toast.hidden = true;
    const view = this.views.find((v) => v.doc === target.doc)!;
    const anchor = elements.at(-1)!;
    const existing = this.drafts.find((draft) => sameTarget(draft.target, target));
    if (existing) {
      this.focusEditor(existing);
      return;
    }
    // Untouched editors elsewhere make way; drafts with text stay where they were written.
    for (const draft of this.drafts.filter((item) => !item.busy && !hasDraft(item))) this.closeDraft(draft);
    const place = placeName(target.side, target.startLine, target.endLine);
    const path = target.side === 'base' ? target.doc.oldPath : target.doc.path;
    const editor = this.createEditor(
      'mr-composer',
      `New comment on ${path}, ${place}`,
      'Add a comment…',
      'Comment',
      (built) => void this.postDraft(built as Draft),
    );
    const draft: Draft = Object.assign(editor, { target, view, anchor, range, marks: [...new Set(elements.map(surfaceOf))], plan: null as CommentPlan | null });
    draft.form.prepend(h('p', 'mr-comment-target', `Comment on ${place}`));
    if (range) draft.form.insertBefore(h('blockquote', `mr-comment-quote${target.doc.kind === 'code' ? ' is-code' : ''}`, target.quote), draft.textarea);
    draft.cancel.addEventListener('click', () => this.closeDraft(draft));
    draft.form.addEventListener('focusout', () =>
      setTimeout(() => {
        // Clicking away from an empty editor removes it, as long as the reader still has focus.
        if (this.drafts.includes(draft) && !draft.busy && !hasDraft(draft) && !draft.form.contains(this.shadow.activeElement) && document.hasFocus())
          this.closeDraft(draft);
      }, 0),
    );
    this.drafts.push(draft);
    this.active = draft.form;
    this.refreshMarks();
    this.layoutThreads();
    this.focusEditor(draft);
    this.prepareDraft(draft);
  }

  protected prepareDraft(draft: Draft): void {
    const prepare = this.source?.prepareComment;
    if (!prepare) {
      draft.status.textContent = 'Commenting is unavailable in this review. Open it on GitHub or GitLab to comment.';
      return;
    }
    draft.status.textContent = 'Checking where to post your comment…';
    void prepare(draft.target).then(
      (plan) => {
        if (this.closed || !this.drafts.includes(draft)) return;
        draft.plan = plan;
        draft.ready = true;
        draft.status.textContent = `${plan.label} · ${SUBMIT_KEY}`;
        this.updateEditor(draft);
      },
      (err) => {
        if (!this.closed && this.drafts.includes(draft)) draft.status.textContent = problem(err);
      },
    );
  }

  protected async postDraft(draft: Draft): Promise<void> {
    const body = draft.textarea.value;
    if (!draft.plan || !body.trim() || draft.busy) return;
    this.setBusy(draft, true);
    draft.status.textContent = 'Posting…';
    try {
      const result = await draft.plan.post(body);
      if (this.closed) return;
      const { target } = draft;
      const thread: Thread = {
        doc: target.doc,
        side: target.side,
        line: target.endLine,
        url: result.url,
        comments: [{ author: 'You', body, createdAt: new Date().toISOString(), url: result.url }],
        reply: result.reply,
      };
      this.ownThreads.add(thread);
      this.threads.push(thread);
      // The thread takes the editor's place, in the same frame.
      this.setBusy(draft, false);
      this.closeDraft(draft);
      this.attachThreads(draft.view);
      const card = this.cardOf(thread)!;
      this.active = card;
      card.classList.add('is-new');
      this.layoutThreads();
      this.toast('Comment posted', result.url);
    } catch (err) {
      if (this.closed) return;
      draft.status.textContent = problem(err);
    } finally {
      if (this.drafts.includes(draft)) this.setBusy(draft, false);
    }
  }

  protected closeDraft(draft: Draft): void {
    if (draft.busy || !this.drafts.includes(draft)) return;
    const focused = draft.form.contains(this.shadow.activeElement);
    this.drafts = this.drafts.filter((item) => item !== draft);
    this.resize.unobserve(draft.form);
    draft.form.remove();
    if (this.active === draft.form) this.active = null;
    this.refreshMarks();
    // Removing the focused editor would drop focus to the page and silence the reader's shortcuts.
    if (focused) this.root.focus({ preventScroll: true });
    this.placeCommentButton();
    this.schedule(true);
  }

  /** The words, or blocks, of every open editor stay marked while it is written. */
  protected refreshMarks(): void {
    for (const el of this.root.querySelectorAll('.mr-targeted')) el.classList.remove('mr-targeted');
    const highlights = typeof Highlight === 'function' && CSS.highlights;
    const ranges: Range[] = [];
    for (const draft of this.drafts) {
      if (draft.range && highlights) ranges.push(draft.range);
      else for (const el of draft.marks) el.classList.add('mr-targeted');
    }
    if (ranges.length) CSS.highlights.set('galley-quote', new Highlight(...ranges));
    else CSS.highlights?.delete('galley-quote');
  }

  /** `send` posts what the editor holds; the editor it is given is the one being built, later extended into a Draft or ReplyEditor. */
  protected createEditor(className: string, label: string, placeholder: string, action: string, send: (editor: Editor) => void): Editor {
    const form = h('form', className);
    form.setAttribute('aria-label', label);
    const textarea = h('textarea');
    textarea.rows = 1;
    textarea.placeholder = placeholder;
    textarea.setAttribute('aria-label', label);
    const status = h('p', 'mr-comment-status');
    status.id = `mr-comment-status-${++this.editorCount}`;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    textarea.setAttribute('aria-describedby', status.id);
    const cancel = h('button', 'mr-btn mr-cancel', 'Cancel');
    cancel.type = 'button';
    const submit = h('button', 'mr-btn mr-primary mr-submit', action);
    submit.type = 'submit';
    submit.disabled = true;
    const actions = h('div', 'mr-compose-actions');
    actions.append(status, cancel, submit);
    form.append(textarea, actions);
    const editor: Editor = { form, textarea, status, cancel, submit, ready: false, busy: false, prefill: '', send: () => send(editor) };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      editor.send();
    });
    // The card is the field: a click on its padding puts the cursor in the text.
    form.addEventListener('click', (e) => {
      if (e.target === form) textarea.focus();
    });
    textarea.addEventListener('input', () => this.fitEditor(editor));
    this.editorOf.set(form, editor);
    this.resize.observe(form);
    return editor;
  }

  /** Grow with the text, and offer to post only what can be posted. */
  protected fitEditor(editor: Editor): void {
    const { form, textarea } = editor;
    form.classList.toggle('has-text', Boolean(textarea.value.trim()));
    textarea.style.height = 'auto';
    if (textarea.value) textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`;
    this.updateEditor(editor);
    this.schedule(true);
  }

  protected updateEditor(editor: Editor): void {
    editor.submit.disabled = editor.busy || !editor.ready || !editor.textarea.value.trim();
  }

  /** A write in progress keeps its editor, its text and the cursor exactly where they are. */
  protected setBusy(editor: Editor, busy: boolean): void {
    editor.busy = busy;
    editor.textarea.readOnly = busy;
    editor.cancel.disabled = busy;
    editor.form.setAttribute('aria-busy', String(busy));
    this.updateEditor(editor);
  }

  protected editorAt(node: EventTarget | null): Editor | undefined {
    const form = node instanceof Element ? node.closest('form') : null;
    return form ? this.editorOf.get(form) : undefined;
  }

  /** Bring an editor into view, arrange the comments column around it and put the cursor in it. */
  protected focusEditor(editor: Editor): void {
    // Lay out now, for the current width, so the editor is where it belongs before it takes focus.
    this.active = editor.form.closest<HTMLElement>('.mr-thread') ?? editor.form;
    this.layoutThreads();
    const rect = editor.form.getBoundingClientRect();
    if (rect.top < 64 || rect.bottom > this.root.clientHeight - 16) this.scrollToEl(editor.form, 0.3, false);
    editor.textarea.focus({ preventScroll: true });
  }

  protected toast(text: string, url?: string): void {
    const toast = this.el.toast;
    toast.replaceChildren(text);
    const href = url && platformLink(url, location.origin);
    if (href) {
      const link = h('a', '', 'View on platform');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      toast.append(' · ', link);
    }
    toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 6000);
  }
}
