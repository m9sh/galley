# Project library: reading layouts and chapter context

Implementation plan for [task #60](https://github.com/m9sh/galley/issues/60). This is a phased task, not an RFC. The layout foundation shipped in MR #61. Chapter context shipped in MR #64. The final implementation adds standalone session chapters and list polish; voluntary reader validation remains open.

## Current journey

| Surface | Responsibility | Existing owner |
| --- | --- | --- |
| Chapters | Explainable groups and a reading order through changed files | `core/chapters.ts`, `ui/review/chapters.ts`, `Reader` |
| Review article | Changed file, its contents, folds, Viewed and discussion | `Reader` |
| Project library in the review | **Library** in the review's sheet, beside **Chapters**: search, the docs linked to the review, every document; each opens on top of the list, a document it links to taking its place, with **Back** and <kbd>Esc</kbd>; the expand button (**Open the full library**) opens the repository reader over the review | `ReviewLibrary` (`review/review-library.ts`), `Reader.openProject()` |
| This review | The Documents map around the review: its changed files in the middle by chapter, what links to them and what they link to, with each link's evidence | `map-view.ts` (`DocumentMap` with `review` state), `reviewMap()` and `MapPlacement.around()` in `core/project-map.ts`, `RepoReader` |
| Library browser | Find a document at the selected commit | `RepoReader` and its `ProjectIndex` |
| Contents | Headings of the current article; visible beside Balanced / Wide text on desktop | Each reader's `buildToc()` |
| Project map | The library's front: connections backed by explicit document links, plus their evidence; the document opened at is previewed in the side sheet, **Read** opens it and **Back to map** returns | `ProjectIndex`, `map-view.ts`, `repo-reader-map.ts` |
| Chapters and Notes | The reader's own reading order and notes, in the same side sheet beside the map or the document | `repo-reader-panels.ts`, `reading-sequence.ts`, `repo-views.ts` |

The review sends chapter IDs, titles and changed paths into This review. Each chapter shows **Changed files**, then **Docs that link here**, each opening on top of the chapter in the review's sheet. **Find linked docs**, in a chapter's **Docs that link here**, reads the repository at the review's head for them (`ReviewDocs` in `core/review-context.ts`); merely opening Chapters requests no repository content. The existing bounded index supplies the same explicit Markdown-link evidence to This review, Project map and chapter context. Its read count, listing limits, failed reads and oversized documents remain visible. No connection is inferred from folder proximity.

## Foundation components

`ui/components/layout-controls.ts` owns the fixed layout-picker markup, names and captions. Both readers compose it into the existing `settingsSheet()`. Review choices remain Balanced, Files, Review, Wide text, Focus and Fit to screen; the library offers Focus, Balanced and Wide text, with previews that do not suggest a discussion column.

`LibraryLayout` owns the library session's supported choice and cycling order. It starts in Focus, survives document navigation and refresh, and ends when the overlay closes. It does not write settings. Component tests cover the two picker contexts and the session model; integration tests exercise selection, navigation, late preference loads, keyboard cycling and the return to a review.

The shared `applyReadingControls()` in `settings-sheet.ts` applies selected control states. The library supplies its session layout over the shared preferences when applying those controls. Typography, appearance and density keep their existing shared persistence.

## State contract

| State | Owner and lifetime | Crossing between review and library |
| --- | --- | --- |
| Review file, paragraph, folds and active chapter | Background `Reader`, for the review session | The overlay stays mounted; opening and closing the library does not replace it |
| Comment and reply drafts | Background `Reader` composers | Stay in that reader; context reading never submits or converts them into notes |
| Viewed | Review's existing progress model | Library reads and layout changes never mark files Viewed |
| Review layout | Persisted `Settings.layout` | The library does not update it |
| Library layout | `LibraryLayout`, one open library session | Starts in Focus; saved review preferences and later preference reads cannot overwrite it |
| Library document and back stack | `RepoReader` history: path, first visible block and offset | Link navigation and Back/Forward restore the paragraph; a layout reflow restores the first visible block |
| Revision | Commit-pinned `RepositorySource`; head/base selected before opening | Existing This review identifies the revision; all reads use its commit |
| Focus and Escape | Existing layer ownership and return callback | Settings close first; closing the library returns focus to the review's opening control |
| Document/heading attachment | `ChapterContext`, owned by the background review, keyed by chapter ID and base/head | Stores path, heading, label and actual commit in memory only; survives closing the library, not closing the review; shown as Added by you |

There is no new storage key or saved repository content. The library's layout choice is independent of content visibility: it does not change Marked / Clean, Changed parts / Whole files, indexing completeness or review progress.

## Reading geometry

Focus is a centred article with a 680px maximum measure and navigation available from the document name. Balanced uses the same measure with Contents beside it on wide screens. Wide text has a 920px maximum, constrained by equal space for the contents rail on both sides. No library layout reserves an empty comments column. Below 1,280px, all three keep one reading column.

Existing palettes, typography, optional glow and Comfortable / Compact density continue to apply. Maps and notes retain their separate on-demand views.

## Context components and return contract

`core/review-context.ts` owns the shared related-document query and `ChapterContext` session model. Automatic evidence remains keyed to the changed path, so moving a file to another chapter moves its evidence with it. Explicit attachments belong to stable chapter IDs and a revision; renaming or moving a chapter retains them. A base attachment is never silently used at head. Chapter edits and attachments are separate from persistent Project notes.

`ui/components/chapter-context.ts` renders the revision picker, exact link evidence and the reader's attachments. `ui/components/chapter-attachment.ts` supplies the native disclosure and form shared with the library article: select a chapter, choose Whole document or a real heading, and Add for this session. Attachments are shown before automatic evidence; Remove affects only that session choice. This review shows the same attachments. They do not create documented edges in Project map.

Opening an evidence item keeps its source line; opening an attachment keeps its heading. A missing document retains the return path and platform link. A missing heading says it was not found and shows the beginning. The library's quiet return row names the chapter and provides Return to review and Continue chapter. Return and Escape rebuild the chapter map and focus the exact context control. Continue closes the library and resumes the current paragraph if already in that chapter, or starts its first unviewed readable file otherwise. It is disabled for empty or platform-only chapters. Neither operation submits a draft, unfolds a file or marks one Viewed.

## Standalone reading chapter

A standalone library offers **Chapters** in its top bar (<kbd>C</kbd>) without requiring setup before reading. It opens in the side sheet beside the map or the document, under a **Chapters** | **Notes** switch, as Chapters and Library sit beside a review. One **Your reading sequence** chapter reuses the review's numbered path and route presentation. Readers add whole documents or indexed headings from the ordinary library browser, or use the shared **Add to chapter** form in the article. The chapter also offers explicit Markdown links from the current article, with their source line. It never infers connections from folders or adds a second automatic grouping system.

**Earlier**, **Later** and **Remove** edit the order. Choosing a stop closes the sheet and reads it; the route shows the selected step, with **Previous** and **Next**, rather than completion or Viewed counts. **All documents** leaves the plain outline available. The sequence owns only path, heading and label in memory; history keeps heading identity and the paragraph bookmark. Missing documents/headings use the existing errors and keep the route, platform link and Back. A successful refresh to a different commit clears the choices and explains why. Closing the library ends the sequence. A library opened over a review uses the review chapters instead.

Navigation titles use compact line spacing within an item, with 10px gaps between document rows. Paths and type metadata sit below the title; long paths wrap, and Add has its own 44px target. Chapter controls and source evidence have 44px targets too.

## Remaining validation

The [reader-session protocol](project-library-validation.md) provides the tasks and recording sheet for 5–8 voluntary readers. Naming and comfort remain hypotheses until those sessions take place; no telemetry is introduced.

## Representative captures

The same architecture article at 1,440px: [before](library-before.png), [Focus](library-focus.png), and the extracted [layout picker](library-layouts.png). The [390px capture](library-phone.png) uses dark appearance, Compact density and 22px text. Browser checks exercise all three layouts at 1,440, 1,280, 390 and 320px in light/Comfortable/20px and dark/Compact/22px.

The joined chapter journey has matching 1,440px [before](chapter-context-before.png) and [after](chapter-context-after.png) captures, plus [320px chapter context](chapter-context-phone.png) and [390px supporting reading](chapter-context-reading.png). Its browser checks cover 1,440, 1,280, 390 and 320px, light/dark appearance, Comfortable/Compact density and 17/24px text, including source evidence, heading attachments, focus and state restoration. These captures validate the implemented journey. At phone widths, view choices move into the document menu, leaving the top bar for a readable document name. The byline gives paths and actions separate rows. Standalone sequences now have automated and rendered checks. Voluntary reader sessions remain outstanding.


The final delivery includes matching library-list captures at 1,440px ([before](library-list-before-desktop.png), [after](library-list-after-desktop.png), light / Comfortable / 17px) and 320px ([before](library-list-before-phone.png), [after](library-list-after-phone.png), dark / Compact / 24px). Standalone chapter screens: [desktop](library-chapter-desktop.png), [390px](library-chapter-phone.png), [320px](library-chapter-narrow.png), and [article with diagram](library-chapter-article.png). The [320px table](library-table-phone.png) retains a single-line title even with 24px text. Review discussion is captured at [desktop](library-review-discussion-desktop.png) and [320px](library-review-discussion-phone.png). These are rendered checks, not reader research.
