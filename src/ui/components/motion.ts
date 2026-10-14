/**
 * Sheets that push content aside (ADR 0030 for the map, the same pattern elsewhere) move it with them. The
 * layout changes once; then each part of the page slides from where it was to where the change put it, in
 * step with the sheet, using only transforms, so long documents never lay out again on every frame.
 */

/** The sheet's own slide in and out (reader.css, `.mr-sheet`, uses the same timing). */
export const SHEET_IN: KeyframeAnimationOptions = { duration: 280, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };
export const SHEET_OUT: KeyframeAnimationOptions = { duration: 220, easing: 'ease-in' };

/**
 * Run `change`, which narrows or widens the page and says whether a sheet opened, then slide `parts` from their
 * old places to their new ones. Nothing moves with reduced motion.
 */
export function slideWith(parts: Iterable<HTMLElement>, change: () => boolean): void {
  const moving = [...parts].map((part) => ({ part, left: part.getBoundingClientRect().left }));
  const opened = change();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const { part, left } of moving) {
    const by = left - part.getBoundingClientRect().left;
    if (Math.abs(by) >= 1) part.animate([{ transform: `translateX(${by}px)` }, { transform: 'translateX(0)' }], opened ? SHEET_IN : SHEET_OUT);
  }
}
