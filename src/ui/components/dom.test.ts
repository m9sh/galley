import { expect, it } from 'vitest';
import { glyph, loadingLines, markup } from './dom.ts';
import { TEMPLATE as REPO_TEMPLATE } from '../library/repo-reader-shared.ts';
import { TEMPLATE as REVIEW_TEMPLATE } from '../review/reader-shared.ts';
import { icons } from './icons.ts';

const html = (node: Node) => {
  const holder = document.createElement('div');
  holder.append(node);
  return holder;
};

it('markup keeps the order and text of what it is given, with a leading style element in the body like any other node', () => {
  const holder = html(markup('<style>.a { color: red; }</style>\n<div class="wrap"><button class="launch">Read</button>  <span>two</span></div>'));
  expect([...holder.children].map((el) => el.tagName)).toStrictEqual(['STYLE', 'DIV']);
  expect(holder.querySelector('style')!.textContent).toBe('.a { color: red; }');
  expect(holder.querySelector('.wrap')!.textContent).toBe('Read  two');
  expect(holder.firstElementChild!.ownerDocument).toBe(document);
  expect(html(markup('')).childNodes).toHaveLength(0);
});

it('a bundled icon comes out as an svg in the svg namespace, and each use is a copy of its own', () => {
  const first = html(glyph(icons.chevronRight));
  const svg = first.querySelector('svg')!;
  expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
  expect(svg.querySelector('path, polyline, line, circle')).not.toBeNull();
  svg.setAttribute('data-changed', 'yes');
  svg.remove();
  const second = html(glyph(icons.chevronRight)).querySelector('svg')!;
  expect(second.hasAttribute('data-changed')).toBe(false);
  expect(second.outerHTML).toBe(html(markup(icons.chevronRight)).querySelector('svg')!.outerHTML);
});

it('the loading placeholder is a block of grey lines, a few of them short', () => {
  const lines = loadingLines();
  expect(lines.className).toBe('mr-skeleton');
  expect([...lines.children].map((line) => line.tagName)).toStrictEqual(Array(8).fill('I'));
  expect([...lines.children].map((line) => line.className)).toStrictEqual(['h', '', '', 's', '', '', '', 's']);
});

it('parses every bundled icon and both readers’ templates into exactly the nodes that innerHTML would have made', () => {
  const viaInnerHtml = (text: string) => {
    const holder = document.createElement('div');
    holder.innerHTML = text;
    return holder.innerHTML;
  };
  for (const [name, svg] of Object.entries(icons)) expect(html(glyph(svg)).innerHTML, name).toBe(viaInnerHtml(svg));
  for (const template of [REVIEW_TEMPLATE, REPO_TEMPLATE]) {
    const text = `<style>.x{}</style>${template}`;
    expect(html(markup(text)).innerHTML).toBe(viaInnerHtml(text));
  }
});
