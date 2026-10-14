import { expect, it, vi } from 'vitest';
import { readerHarness, review } from '../../testing/reader.ts';

// Drawing diagrams happens in a sandboxed frame (diagrams.ts); here the drawing is instant, so the
// reader's reaction to "a diagram changed size" can be seen without one.
const drawn = vi.hoisted(() => ({ renderDiagrams: vi.fn() }));
vi.mock('../rendering/diagrams.ts', async (original) => ({
  ...(await original<typeof import('../rendering/diagrams.ts')>()),
  renderDiagrams: drawn.renderDiagrams,
}));

const ui = readerHarness();

it('makes room again whenever a diagram finishes drawing, when the document is shown and when the palette changes', async () => {
  drawn.renderDiagrams.mockImplementation((_diagrams: unknown, _dark: boolean, changed: () => void) => changed());
  const frame = vi.spyOn(globalThis, 'requestAnimationFrame');
  await ui.open(review());
  ui.flushFrame();
  const shown = drawn.renderDiagrams.mock.calls.length;
  expect(shown).toBeGreaterThan(0);
  frame.mockClear();
  ui.click('[data-act="settings"]');
  ui.click('[data-setting="theme"] [data-value="paper"]');
  expect(drawn.renderDiagrams.mock.calls.length).toBeGreaterThan(shown);
  expect(frame).toHaveBeenCalled();
});

it('an edited flowchart shows its changes, and its two whole versions on request', async () => {
  const fence = (flow: string) => `# Guide\n\n\`\`\`mermaid\nflowchart LR\n ${flow}\n\`\`\`\n`;
  await ui.open(review({ load: async () => ({ base: fence('A --> B'), head: fence('A --> C') }) }));
  const figure = ui.q('.mr-diagram.has-changes');
  const sides = ui.q<HTMLButtonElement>('.mr-diagram-sides');
  sides.click();
  expect(figure.classList).toContain('is-sides');
  expect([sides.getAttribute('aria-expanded'), sides.textContent]).toStrictEqual(['true', 'Hide before and after']);
  sides.click();
  expect(figure.classList).not.toContain('is-sides');
  expect([sides.getAttribute('aria-expanded'), sides.textContent]).toStrictEqual(['false', 'Show before and after']);
});
