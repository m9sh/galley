import { afterEach, expect, it, vi } from 'vitest';
import { SHEET_IN, SHEET_OUT, slideWith } from './motion.ts';

afterEach(() => {
  document.body.replaceChildren();
});

/** A part that a change moves from one place to another. */
function part(before: number, after: number) {
  const el = document.createElement('div');
  let moved = false;
  el.getBoundingClientRect = () => new DOMRect(moved ? after : before, 0, 100, 20);
  el.animate = vi.fn() as typeof el.animate;
  document.body.append(el);
  return { el, move: () => (moved = true) };
}

it('slides each part from where it was to where the change put it, in step with a sheet opening or closing', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const column = part(320, 160);
  const still = part(12, 12.4);
  slideWith([column.el, still.el], () => {
    column.move();
    still.move();
    return true;
  });
  expect(column.el.animate).toHaveBeenCalledWith([{ transform: 'translateX(160px)' }, { transform: 'translateX(0)' }], SHEET_IN);
  // Less than a pixel is not worth moving.
  expect(still.el.animate).not.toHaveBeenCalled();
  const back = part(160, 320);
  slideWith([back.el], () => {
    back.move();
    return false;
  });
  expect(back.el.animate).toHaveBeenCalledWith([{ transform: 'translateX(-160px)' }, { transform: 'translateX(0)' }], SHEET_OUT);
});

it('moves nothing with reduced motion, though the change still happens', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
  const column = part(320, 160);
  const change = vi.fn(() => {
    column.move();
    return true;
  });
  slideWith([column.el], change);
  expect(change).toHaveBeenCalledOnce();
  expect(column.el.animate).not.toHaveBeenCalled();
});
