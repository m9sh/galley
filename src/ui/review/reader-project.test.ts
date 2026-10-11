import { expect, it, vi } from 'vitest';
import type { ReviewProject } from '../../platforms/types.ts';
import { guide, readerHarness, review } from '../../testing/reader.ts';
import { handbook, repository } from '../../testing/repo.ts';

const ui = readerHarness();
const repoShadow = () => document.querySelector('#galley-repo-reader')?.shadowRoot ?? null;

function project(): ReviewProject {
  return {
    base: { ref: 'main', commit: 'ba5e000000000000000000000000000000000000' },
    head: { ref: 'feature/guide', commit: 'bead000000000000000000000000000000000000' },
    open: vi.fn((revision: 'base' | 'head') =>
      repository(handbook, {
        commit: revision === 'head' ? 'bead000000000000000000000000000000000000' : 'ba5e000000000000000000000000000000000000',
        pinned: true,
      }),
    ),
  };
}

it('a review without its repository offers no project docs', async () => {
  await ui.open(review());
  expect(ui.q('[data-act="project"]').hidden).toBe(true);
  expect(ui.q('.mr-files-project')).toBe(null);
});

it('Project library opens the repository at the review’s head or base over the review, and closing it comes back to the review as it was', async () => {
  const behind = project();
  await ui.open(review({ project: behind }));
  const toggle = ui.q('[data-act="project"]');
  expect(toggle.hidden).toBe(false);
  expect(toggle.getAttribute('aria-label')).toBe('Project library');
  expect(ui.q('.mr-project-label').textContent).toBe('Library');
  ui.click('[data-act="project"]');
  expect(ui.q('.mr-project').hidden).toBe(false);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect([...ui.q('.mr-project').querySelectorAll('.mr-menu-item')].map((item) => item.textContent)).toStrictEqual([
    'As this change leaves themfeature/guide @ bead000',
    'Before this changemain @ ba5e000',
  ]);
  // Esc closes the menu first, like every menu.
  ui.key('Escape');
  expect(ui.q('.mr-project').hidden).toBe(true);
  expect(document.querySelector('#galley-reader')).not.toBe(null);

  ui.click('[data-act="project"]');
  ui.click('[data-act="project-open"][data-revision="head"]');
  expect(behind.open).toHaveBeenCalledWith('head');
  expect(ui.q('.mr-project').hidden).toBe(true);
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-review-context h1')?.textContent).toBe('This review'));
  expect(repoShadow()!.querySelector('.mr-review-context .mr-subtitle')!.textContent).toContain('at its head, feature/guide @ bead000 for “Update the guide”');
  expect([...repoShadow()!.querySelectorAll('.mr-review-chapter h2')].length).toBeGreaterThan(0);
  expect(repoShadow()!.querySelector('.mr-review-path')!.textContent).toContain('docs/guide.md');

  // Keys belong to the docs while they are open: Esc closes them, not the review.
  const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true });
  repoShadow()!.querySelector<HTMLElement>('.mr-root')!.dispatchEvent(esc);
  expect(document.querySelector('#galley-repo-reader')).toBe(null);
  expect(document.querySelector('#galley-reader')).not.toBe(null);
  expect(ui.shadow().activeElement).toBe(toggle);

  // The files menu offers the same choices, for phones with no room for the button.
  ui.click('[data-act="files"]');
  expect([...ui.q('.mr-files').querySelectorAll('[data-act="project-open"]')].map((item) => (item as HTMLElement).dataset.revision)).toStrictEqual([
    'head',
    'base',
  ]);
  expect(ui.q('.mr-files-project').textContent).toBe('Project library');
  ui.key('Escape');

  // The base is the other choice; closing the review closes the docs over it too.
  ui.click('[data-act="project"]');
  ui.click('[data-act="project-open"][data-revision="base"]');
  expect(behind.open).toHaveBeenLastCalledWith('base');
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-review-context .mr-subtitle')?.textContent).toContain('at its base, main @ ba5e000'));
  ui.close();
  expect(document.querySelector('#galley-repo-reader')).toBe(null);
});

it('a library layout choice leaves the review layout, paragraph, folds, Viewed and comment draft intact', async () => {
  localStorage.setItem('galley:settings', JSON.stringify({ layout: 'review' }));
  await ui.open(review({ project: project() }));
  await ui.readyViewed();
  await ui.commentOn();
  ui.input('Check the rationale before posting');
  ui.q('.mr-root').scrollTop = 460;
  const before = {
    layout: ui.q('.mr-root').dataset.layout,
    viewed: ui.q('.mr-viewed').getAttribute('aria-pressed'),
    folds: [...ui.shadow().querySelectorAll('[data-act="fold"]')].map((el) => el.getAttribute('aria-checked')),
  };
  expect(before.layout).toBe('review');
  ui.click('[data-act="project"]');
  ui.click('[data-act="project-open"][data-revision="head"]');
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-review-context h1')?.textContent).toBe('This review'));
  const library = repoShadow()!;
  expect(library.querySelector<HTMLElement>('.mr-root')!.dataset.layout).toBe('focus');
  library.querySelector<HTMLElement>('[data-setting="layout"] [data-value="wide"]')!.click();
  expect(library.querySelector<HTMLElement>('.mr-root')!.dataset.layout).toBe('wide');
  expect(JSON.parse(localStorage.getItem('galley:settings')!).layout).toBe('review');
  library
    .querySelector<HTMLElement>('.mr-root')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }));
  expect(repoShadow()).toBeNull();
  expect(ui.q('.mr-root').dataset.layout).toBe(before.layout);
  expect(ui.q('.mr-root').scrollTop).toBe(460);
  expect(ui.q('.mr-viewed').getAttribute('aria-pressed')).toBe(before.viewed);
  expect([...ui.shadow().querySelectorAll('[data-act="fold"]')].map((el) => el.getAttribute('aria-checked'))).toEqual(before.folds);
  expect(ui.q<HTMLTextAreaElement>('.mr-composer textarea').value).toBe('Check the rationale before posting');
  expect(ui.shadow().activeElement).toBe(ui.q('[data-act="project"]'));
});

it('finds chapter context explicitly, adds a heading for this session and returns to the same paragraph, draft and context control', async () => {
  const behind = project();
  vi.mocked(behind.open).mockImplementation((revision) =>
    repository(
      { ...handbook, 'docs/context.md': '# Context\n\nRead [the guide](guide.md).\n\n## Choice\n\nChoose deliberately.' },
      { pinned: true, commit: behind[revision].commit },
    ),
  );
  await ui.open(review({ docs: [guide, { ...guide, path: 'README.md' }], project: behind }));
  await ui.readyViewed();
  await ui.commentOn();
  ui.input('Keep my question while reading');
  ui.q('.mr-root').scrollTop = 460;
  const viewed = ui.q('.mr-viewed').getAttribute('aria-pressed');
  ui.click('.mr-chapters-toggle');
  expect(behind.open).not.toHaveBeenCalled();
  expect(ui.q('[data-chapter="docs:docs"]').textContent).toContain('Changed files');
  ui.click('[data-chapter="docs:docs"] [data-context-key="find"]');
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-review-status .mr-map-status')?.textContent).toMatch(/^Built from all/));
  let library = repoShadow()!;
  library.querySelector<HTMLButtonElement>('[data-act="open"][data-path="docs/context.md"]')!.click();
  await vi.waitFor(() => expect(library.querySelector('.mr-lead')?.textContent).toBe('Context'));
  const form = library.querySelector<HTMLFormElement>('.mr-chapter-attachment form')!;
  form.querySelector<HTMLSelectElement>('[aria-label="Section to add"]')!.value = 'choice';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(form.querySelector('[role="status"]')!.textContent).toBe('Added to docs.');
  library.querySelector<HTMLButtonElement>('[data-view="review"]')!.click();
  expect(library.querySelector('.mr-review-attachment')!.textContent).toContain('Context — ChoiceAdded by you');
  library.querySelector<HTMLButtonElement>('.mr-repo-return [data-act="close"]')!.click();
  expect(repoShadow()).toBeNull();
  expect(ui.q('.mr-root').scrollTop).toBe(460);
  expect(ui.q<HTMLTextAreaElement>('.mr-composer textarea').value).toBe('Keep my question while reading');
  expect(ui.q('.mr-viewed').getAttribute('aria-pressed')).toBe(viewed);
  expect(ui.q('.mr-chapters').hidden).toBe(false);
  expect(ui.shadow().activeElement).toBe(ui.q('[data-chapter="docs:docs"] [data-context-key="find"]'));
  const context = ui.q('[data-chapter="docs:docs"] .mr-chapter-context');
  expect(context.textContent).toContain('Links to docs/guide.md');
  expect(context.textContent).toContain('“the guide” · line 3');
  ui.click('[data-chapter="docs:docs"] [data-context-key="attached:docs/context.md:choice"]');
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-lead')?.textContent).toBe('Context'));
  library = repoShadow()!;
  library.querySelector<HTMLButtonElement>('[data-act="continue-chapter"]')!.click();
  expect(repoShadow()).toBeNull();
  expect(ui.q('.mr-chapters').hidden).toBe(true);
  expect(ui.q<HTMLTextAreaElement>('.mr-composer textarea').value).toBe('Keep my question while reading');
  ui.click('.mr-chapters-toggle');
  ui.q('[aria-label="Remove Context — Choice from this chapter"]').click();
  expect(ui.q('.mr-chapter-context').textContent).not.toContain('Added by you');
  // If the linked document becomes unavailable, the old evidence control disappears;
  // returning still restores a reachable control in the same chapter.
  const unavailable = repository({ ...handbook, 'docs/context.md': '# Context' }, { pinned: true });
  vi.mocked(unavailable.load).mockImplementation(async (path) => {
    if (path === 'docs/context.md') throw new Error('temporarily offline');
    return handbook[path];
  });
  vi.mocked(behind.open).mockReturnValueOnce(unavailable);
  ui.click('[data-chapter="docs:docs"] [data-context-key="docs/guide.md:docs/context.md:3"]');
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-doc .mr-message p')?.textContent).toBe('temporarily offline'));
  repoShadow()!.querySelector<HTMLButtonElement>('[data-view="review"]')!.click();
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-review-status')?.textContent).toContain('1 document could not be read'));
  repoShadow()!.querySelector<HTMLButtonElement>('.mr-repo-return [data-act="close"]')!.click();
  expect(ui.shadow().activeElement).toBe(ui.q('[data-chapter="docs:docs"] [data-context-key="find"]'));
  const picker = ui.q<HTMLSelectElement>('[data-chapter="docs:docs"] [aria-label="Project context revision"]');
  picker.value = 'base';
  picker.dispatchEvent(new Event('change'));
  expect(ui.shadow().activeElement).toBe(ui.q('[data-chapter="docs:docs"] [aria-label="Project context revision"]'));
  expect(ui.q('[data-chapter="docs:docs"] .mr-chapter-context').textContent).toContain('No project context read yet');
  ui.click('[data-chapter="docs:docs"] [data-context-key="find"]');
  expect(behind.open).toHaveBeenLastCalledWith('base');
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-review-status .mr-map-status')?.textContent).toMatch(/^Built from all/));
  repoShadow()!.querySelector<HTMLButtonElement>('[data-act="continue-chapter"]')!.click();
  ui.click('.mr-chapters-toggle');
  ui.click('[data-chapter="docs:"] [data-context-key="find"]');
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-review-status .mr-map-status')?.textContent).toMatch(/^Built from all/));
  repoShadow()!.querySelector<HTMLButtonElement>('[data-act="continue-chapter"]')!.click();
  expect(ui.q('.mr-chapters').hidden).toBe(true);
  ui.click('.mr-chapters-toggle');
  ui.click('[data-chapter="docs:"] [data-context-key="find"]');
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-review-status .mr-map-status')?.textContent).toMatch(/^Built from all/));
  ui.close();
  expect(repoShadow()).toBeNull();
});

it('can attach a whole document without a title, and keeps that choice out of other chapters', async () => {
  const behind = project();
  vi.mocked(behind.open).mockImplementation(() => repository({ ...handbook, 'CONTEXT.md': 'Only a paragraph.' }, { pinned: true }));
  await ui.open(review({ project: behind }));
  ui.click('[data-act="project"]');
  ui.click('[data-act="project-open"][data-revision="head"]');
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-review-status .mr-map-status')?.textContent).toMatch(/^Built from all/));
  repoShadow()!.querySelector<HTMLButtonElement>('[data-view="read"]')!.click();
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-lead')?.textContent).toBe('Handbook'));
  repoShadow()!.querySelector<HTMLButtonElement>('[data-act="docs"]')!.click();
  repoShadow()!.querySelector<HTMLButtonElement>('[data-act="open"][data-path="CONTEXT.md"]')!.click();
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-doc .mr-title')?.textContent).toBe('CONTEXT'));
  repoShadow()!
    .querySelector<HTMLFormElement>('.mr-chapter-attachment form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  repoShadow()!.querySelector<HTMLButtonElement>('[data-view="review"]')!.click();
  expect(repoShadow()!.querySelector('.mr-review-attachment')!.textContent).toContain('CONTEXTAdded by you');
  repoShadow()!.querySelector<HTMLButtonElement>('.mr-repo-return [data-act="close"]')!.click();
  ui.click('.mr-chapters-toggle');
  expect(ui.q('.mr-chapters').hidden).toBe(false);
  expect(ui.q('[data-context-key="attached:CONTEXT.md:"]').textContent).toBe('CONTEXT');
});
