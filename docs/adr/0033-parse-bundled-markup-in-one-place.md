---
status: Accepted
date: 2026-10-14
deciders: [m9sh]
rfcs: []
tags: [security, rendering, firefox]
---

# ADR 0033: Parse bundled markup in one place, and keep Galley's own code free of Firefox validator warnings

## Context

[ADR 0006](0006-sanitise-all-rendered-html.md) made writing a string as HTML a lint error, with one exception: a static template of fixed markup, allowed with a `biome-ignore` comment that gives a reason. That exception had grown to 26 places, nearly all of them an icon or a template written with `innerHTML` or `insertAdjacentHTML`.

Mozilla's add-on validator warns on every such write, whatever the reason. The upload of 0.19.0 reported 40 warnings, 26 of them in Galley's own code ([issue 81](https://github.com/m9sh/galley/issues/81)). The reviewer notes said six, so the first thing a reviewer saw did not match them.

## Decision

Bundled markup is parsed by one helper, and the lint rule allows nothing else.

- **`markup(html)` and `glyph(svg)`** in `src/ui/components/dom.ts` parse a string with `DOMParser` in an inert document and move the nodes into the page. `glyph` is for the bundled icons and parses each one once, then copies it. They are the only code that parses a string as HTML.
- **No content reaches them.** Anything that comes from a document, a comment or a platform still goes through `sanitize()` or becomes text, as ADR 0006 says. The parity test checks that `glyph` and `markup` make the same nodes as `innerHTML` did for every bundled icon and both readers' templates.
- **The lint rule (`lint/no-unsanitized-html.grit`) now also fails on `parseFromString`,** and everywhere except `dom.ts` it fails on `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write` with no exception comment to write. One inert parse of highlighter output remains in `src/ui/rendering/code.ts`; it is never inserted, the lines are rebuilt from text and token classes, and it carries a suppression that says so.
- **Galley's own code adds no validator warning.** `npm run lint:firefox` (`scripts/firefox-lint.mjs`) runs Mozilla's `addons-linter` on `dist/firefox`, compares what it reports with `store/firefox-warnings.json`, and fails on a new warning, a changed count or any error. CI runs it after the build.
- **The 14 warnings that remain are in unmodified third-party code,** and the reviewer notes in `store/FIREFOX.md` explain each one: DOMPurify's fallback parser (1), highlight.js's `highlightElement`, which Galley never calls (1), and Mermaid with its dependencies inside the sandboxed frame (12).

### What is not changed

- Third-party code is not patched to hide a warning, and no bundle is made large enough that the validator skips it. The build already fails on a file over 5 MB so that every file stays scannable.
- Mermaid keeps seven `innerHTML` warnings that come from how it renders labels, so removing the last warnings would mean dropping diagrams on Firefox. That is a product decision, not a lint one.

## Consequences

- **Good:** Galley's own code has no validator warning, and the reviewer notes match what the validator reports.
- **Good:** nothing to suppress for bundled markup, so a suppression in the diff is a signal to look.
- **Good:** a new validator warning fails CI the day it appears.
- **Costs:** the rule cannot tell a static string from a dynamic one passed to `markup()`. That is a review item, and the parity test covers what exists now.
- **Costs:** an icon is parsed once with `DOMParser` instead of every time with `innerHTML`, and a template costs one parse when a reader opens. Neither is measurable in use.
- **Costs:** `addons-linter` is MPL-2.0, so it is run with `npx` at a pinned version, never installed or bundled. The pin has to follow the version addons.mozilla.org uses, and the recorded warnings change with it.

## Alternatives considered

- **Keep the suppressions and explain them:** the validator still warns, so the sheet is never clean and a reviewer has to read 26 reasons.
- **`Range.createContextualFragment` or `Element.setHTMLUnsafe`:** the validator flags both.
- **Build every icon from `createElementNS` calls:** no string parsing, but it turns the bundled icons into code and a larger diff for the same result.
- **Patch the libraries, or ship Mermaid as one file over 5 MB so it is not scanned:** the first changes code Galley says it ships unmodified, and the second hides the code from the scanner. Neither is honest to a reviewer.
- **Ship DOMPurify as a separate file Mozilla recognises by hash:** removes two of the 14, but needs changes to both manifests and to how content scripts are registered for self-hosted sites, in security-critical wiring.

## Enforcement

- `lint/no-unsanitized-html.grit`, run by `npm run lint` and CI, outside tests and `e2e/`.
- `src/ui/components/dom.test.ts`: the helpers' contract and the parity with `innerHTML`.
- `scripts/firefox-lint.mjs` and its tests, and the "Firefox add-on validator" step in CI.

## References

- [Issue 81](https://github.com/m9sh/galley/issues/81), the validator's report for 0.19.0.
- Mozilla's [add-on validator](https://github.com/mozilla/addons-linter) and its `no-unsanitized` rules.
