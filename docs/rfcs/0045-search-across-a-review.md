---
status: Proposed
created: 2026-10-10
authors: [m9sh]
discussion: https://github.com/m9sh/galley/issues/45
theme: Never lose the thread
phase: Exploratory follow-up; outside the three proposed core RFCs
progress: First version built for review; searches loaded content, including folded parts, without new reads; reader sessions not yet run
adrs: [2, 21]
---

# RFC 0045: Search across a review, including folded content

## Problem

Finding a symbol, test, phrase or discussion in a large MR can require opening many folded sections or leaving the reader. Ordinary browser find may not provide enough context about hidden content, versions or unavailable files.

## Proposal

Add a review-wide search that finds text in available file content, declaration/test names, loaded discussions and private notes. Results identify the file, relevant heading, source version and a compact excerpt.

Selecting a result reveals the necessary context and preserves a return path to the previous reading location. Include filters for changed content and content type, while clearly stating what the current search includes.

Start with a bounded, local search over content Galley already has. Additional provider reads should be an explicit expansion of search scope, respect the code-files preference and report progress, failures and limits.

## Proposed acceptance criteria

- [ ] Search can find content inside available folded sections without manually opening every section.
- [ ] Results distinguish old/new source versions and private/public content.
- [ ] Selecting a result reveals and focuses its actual context, with a route back.
- [ ] Navigation does not silently mark files Viewed or discard drafts.
- [ ] The UI states scope and distinguishes no matches from unsearched/unavailable content.
- [ ] Searching disabled code content does not silently enable Code files or fetch extra files.
- [ ] Large queries/results are bounded and cancellable so the reader remains responsive.
- [ ] Queries and results are processed locally and not sent to an external search service.
- [ ] Keyboard, mobile, hidden-content and partial-load cases are verified.

## Alternatives and tradeoffs

Browser find has low interaction cost but limited review-specific context. A full repository search offers more breadth while introducing permissions, fetching and indexing scope. A command menu could reuse result navigation later, but should not delay a useful text search.

## Open questions

- **Engineering, blocking:** Which content is available without extra reads, and how can search limits be reported accurately?
  - *Answered for the first version (2026-10-11):* every loaded document, including text Changed parts hides, files folded as skippable (loaded, not yet rendered: searched in their source lines) and files the reviewer folded; both versions of every block; loaded comments; unsent drafts; and the request description when shown. Code files are not loaded while Code files is off, so they are counted as not searched, with an explicit **Turn on Code files**. Files still loading and files that failed are counted too. The review reader has no private notes yet ([RFC 0037](0037-private-follow-ups.md)); unsent drafts are its private content.
- **Design:** Should private notes and discussions appear together with code by default?
  - *Decided (2026-10-11):* one list in reading order, each result labelled (**Document**, **Code**, **Test**, **Comment**, **Description**, **Your draft** with **Only you can see it**), with filter chips to narrow it.
- **Product:** Are exact text matches sufficient for the first version?
  - *Decided (2026-10-11):* yes: the exact phrase in any case, with any whitespace matching any whitespace, and no further options.
- **Engineering:** What indexing and cancellation strategy keeps large reviews responsive?
  - *First version:* no index. Each query walks the loaded content in reading order, pausing every few milliseconds; a newer query or closing the reader stops an older one. At most 200 results are listed and the total is reported. Large-review timings remain to be measured.
- **Design (2026-10-11):** the field lives in the top bar and opens with <kbd>/</kbd>; ⌘/Ctrl+F stays the browser's own find. Narrow phones open it from the document menu.

## Validation

Give reviewers lookup tasks spanning folded files, an old-version passage, a test and an existing discussion. Measure successful retrieval, time, lost reading position and mistaken interpretations of incomplete search. Include large and partially loaded MRs. Collect these observations through research sessions without product telemetry.

## Implementation quality

If accepted, preserve existing coverage gates and verify the relevant desktop, mobile and accessibility behavior. Validation findings should decide the final scope; these RFCs do not commit the core milestone to shipping every proposal.

## Related RFCs

- [RFC 0036](0036-review-chapters.md) — Review chapters with a clear starting point
- [RFC 0037](0037-private-follow-ups.md) — Private follow-ups for review questions
- [RFC 0042](0042-inspect-related-code.md) — Inspect related code without losing your place
