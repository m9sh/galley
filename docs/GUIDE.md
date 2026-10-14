# Galley user guide

Learn how to read changes in context, discuss them with your team and adjust Galley to suit you. This guide covers the reader, settings and GitHub and GitLab setup.

- [Opening a review](#opening-a-review)
- [The reader](#the-reader)
- [Search the review](#search-the-review)
- [Settings](#settings)
- [Documents](#documents)
- [Code](#code)
- [Diagrams](#diagrams)
- [Comments and replies](#comments-and-replies)
- [Viewed progress](#viewed-progress)
- [Project library and the project map](#project-library-and-the-project-map)
- [GitLab](#gitlab-gitlabcom-and-self-managed)
- [GitHub](#github-githubcom-and-enterprise-server)
- [The demo](#the-demo)

## Opening a review

Open a pull or merge request and press **Read** in the bottom-right corner. The number on the button counts the changed documents (Markdown files), or the supported source files when a request changes no documents. Every changed document then appears in one continuous stream, with a small divider between files. A new or deleted file says so in its byline.

You can also open Galley's toolbar popup and choose **Read this review**, or press <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>R</kbd>. On repository pages, the popup offers **Read the project** instead. The browser's extension shortcut settings let you change **Read this page in Galley**; the suggested shortcut may already be taken by another extension.

Prefer opening from the toolbar? Choose **Settings…** in the popup and turn off **Read button on the page**. This hides both page buttons and stops the requests used to count a review's files. Files are fetched only when you ask to open the reader. Turning it off keeps an open reader and its drafts in place; opening again focuses that reader.

Optionally, the request's own title and description come first (**Settings → Review → Title & description**), and changed source and configuration files follow the documents (**Settings → Review → Code files**). Both are off by default and remembered for future reviews. Code contents are fetched only when code files are on.

## The reader

- **The top bar** names the current file (a status dot, its name and position), steps through changes, holds a **Viewed** toggle and opens the settings. Choosing the file name opens the document menu: every changed file with its folder, status and viewed progress, under the request title.
- **Wide screens** set the text the way a reading site does: centred at a comfortable line length, the contents in the margin to its left and the comments column in the margin to its right. The text moves left only when the comments would otherwise get too narrow. Below 1280 pixels everything reads in one column, with comments under the paragraphs they discuss.
- **The margin** carries thin change bars beside changed Markdown blocks: one colour each for added, edited and removed.
- **Unchanged content** folds. By default you see the changed parts and the headings above them; each folded stretch has one **N unchanged blocks** toggle, even when it crosses lists or quotes. Press <kbd>A</kbd> (or **Settings → Review → Context → Whole files**) to read everything.
- **Files follow one another** on one page. Each opens with its place in the review, such as **File 3 of 8**, under a hairline that ends the file before it.
- **Pick up where you left off.** Galley remembers which file you were reading and how far into it, for your 50 most recent reviews, in this browser (as fingerprints: no addresses or paths are stored). Open a review again and **Continue** takes you back there; scroll on, or choose ×, to start from the top.

## Search the review

Find a phrase anywhere in the review, including the parts Galley folds away: unchanged text hidden by **Changed parts**, folded files, files you folded yourself, the old version of edited text, comments and your unsent drafts. Press <kbd>/</kbd> or choose the search icon in the top bar (on a narrow phone, **Search this review** in the document menu).

- **What it matches.** The exact phrase, in any case. Spaces in your search match any spacing in the text, so a phrase still matches where a line wraps.
- **The results** are listed in reading order, grouped by file. Each says what it is (**Document**, **Code**, **Test**, **Comment**, **Description** or **Your draft**, which only you can see), where it is (the heading above it, or the line), and **Old version** or **New version** when only one version has it. Text both versions share is listed once. Use the chips to show only **Documents**, **Code**, **Comments** or **Your drafts**, and **Changed parts only** to leave out unchanged text.
- **Choose a result** with the arrow keys and <kbd>Enter</kbd>, or by pointing. Galley opens what folds it, marks the words and moves focus there. Showing a result never marks a file **Viewed** or touches a draft. Old text in **Clean** mode turns change marks on, and says so.
- **The results bar** at the bottom says where you are in the results, steps to the next and previous one, and **Back to where you were** returns to the place you were reading before you searched. <kbd>Esc</kbd> closes the search, then the bar.
- **What is not searched is said.** Code files are not loaded while **Code files** is off, so the search says how many it left out, with **Turn on Code files**. It also says how many files are still loading or could not be loaded. Search runs in your browser on what Galley has already loaded; it never sends your search anywhere or loads anything you did not ask for.

## Settings

Press <kbd>,</kbd> or the sliders in the top bar. The settings open as a sheet (a bottom sheet on phones) with four tabs.

**Settings…** in the toolbar popup opens the extension's separate settings page, where **Opening the reader** holds **Read button on the page**. The page button starts on; reading preferences and the opening choice are saved together in this browser.

| Tab | What it holds |
| --- | --- |
| **Reading** | Appearance (System, Light, Dark); Top glow, a soft wash of color that can be turned off; nineteen palettes in a carousel: Paper, E-ink, Cream, Sepia, Night, Blush, Sage, Seafoam, Slate, Nord, Dusk, Contrast, Ocean, Clay, Orchid, Graphite, Hackerman, Aurora and Sunset; the typeface (Galley's Newsreader and DM Sans pairing, Newsreader, DM Sans, Georgia, your system font or monospace); text size from 17 to 24 pixels, with a live preview. |
| **Layout** | **Balanced** (the text centred, contents and comments in its margins), **Files** (every file of the review in the left margin, the current one open to its headings, for large reviews), **Review** (a comments column as wide as the text, with larger comment text), **Wide text** (longer lines for tables, code and diagrams), **Focus** (the text alone, comments below it) and **Fit to screen** (everything grows with the window); then **Comfortable** or **Compact** density. |
| **Review** | Change marks (**Marked** or **Clean**), Context (**Changed parts** or **Whole files**), Title & description, Code files, + and − signs, Fold files you can skip, File order (**Suggested** or **As listed**), Test files (**Test plan** or **Whole file**), Code comments (**Formatted** or **Source**), and External images (**Ask** or **Load**). |
| **Keys** | Every keyboard shortcut. |

Every palette has a light and a dark appearance. Comment cards and formatted notes use quiet shaded surfaces. Dark mode keeps the page, code, cards and controls distinct without washing every layer in the accent colour. Borders identify editable fields; accents identify focus and selection, while green, amber and rose identify changes. Text and syntax colours are checked against their reading and diff backgrounds in every palette, light and dark. Fonts ship with the extension; nothing loads from a font service.

## Documents

Both versions of each document are parsed as GitHub-flavoured Markdown: tables, task lists, footnotes, alerts (`> [!NOTE]`) and front matter, which appears as a small metadata card.

- **Word edits** appear inside the sentence: inserted words tinted, removed words struck through. Changes to paragraph wrapping are not marked as text edits. A paragraph rewritten by more than 60% shows as the old version removed and the new one added.
- **New and removed blocks** stay in place: removed paragraphs, list items and table rows appear where they used to be.
- **Tables** are compared row by row, then cell by cell.
- **Links and images** whose text stays the same but whose destination changed are named in the text.
- **Changes that render nowhere** (HTML comments, link definitions) are counted in the byline and linked to the platform diff, so you can inspect changes that do not appear in the rendered document.
- **Emoji shortcodes** such as `:tada:` show as the emoji, as they do on GitHub and GitLab, in documents and comments alike. Emoticons such as `:)` and anything in code stay as written.
- **Clean mode** (<kbd>C</kbd>) hides the marks and reads the new version as it will be published, with quiet bars left in the margin.
- **Images** hosted on the review site load normally. Images hosted elsewhere wait behind a **Load** button, so a pull request cannot track who reads it; **External images: Load** changes that. If the platform blocks a loaded badge or image, the extension displays it in an isolated image frame.

## Code

Code blocks in documents and source files are shown one line per block. Long lines wrap under their own indentation instead of disappearing past the edge, so nothing needs sideways scrolling. On wide screens source files run to 120 characters, and code blocks grow to their longest line, up to the same width.

- Source files keep their old and new line numbers and their `+` / `−` signs, with two context lines around each change and controls to reveal the rest. To read code without the signs, turn off **Settings → Review → + and − signs**; the tints and edges still show what changed.
- Changed lines get a faint tint and a coloured edge rather than a full fill. A file that is entirely new or deleted says so once, in its byline.
- Syntax colours come from highlight.js, bundled with the extension and run in a sandboxed frame only when code is on screen, so a pathological file cannot freeze the page. Both versions are highlighted as a whole, so strings and comments that span lines colour correctly.
- Binary files and unknown file types are left out. Source files over 500,000 characters show a link to the platform diff instead.

### Test files

With **Code files** enabled, JavaScript and TypeScript tests open as a test plan. It starts with a summary ("5 tests in 2 suites"), counts of tests added, edited, removed, unchanged and still **To do**, and **Browse tests**, an expandable list of every test under its suite: choose one to open it and jump there. **Added**, **Edited**, **Removed** and **Unchanged** describe changes to the source; Galley does not run tests or report their results.

Below the summary, suites are headings and each test is a card named after it, with its status, its flags (**Parameterized**, **Skipped**, **Only**, **To do**) and its lines. Changed tests open with their code in view. Unchanged imports start as one expandable **Imports & setup** row; changed imports stay open. The source stays available throughout, whatever the **Context** setting. Choose a test's name to fold its code away.

The heading already says what a declaration says, so lines that only repeat it are left out: the `it(…)` or `describe(…)` line, its closing `});`, a bare `it.todo(…)`. That holds for a renamed test too, whose heading shows the old and new words. A declaration line that says more, such as `async`, a timeout or a parameter table, stays, and so does any line with a discussion on it. Everything else is exactly the source: both diff versions, syntax colours, line numbers and comment targets. Dynamic names remain source expressions.

Choose **Whole file (raw)** above a test file to see every source line, including imports, setup, unchanged code and comments exactly as written. The switch stays visible so you can return to **Test plan**. The same choice is available under **Settings → Review → Test files → Whole file**, applies to every test file and is remembered.

Galley recognizes `.test` / `.spec` JavaScript and TypeScript filenames and files in `test`, `tests`, `spec`, `specs` or `__tests__` directories, including JSX/TSX. Common Jest, Vitest, Mocha and Playwright declarations are supported. Unsupported syntax, files without recognizable cases and parser failures keep the source view. To keep the reader responsive, the specification view is limited to 200,000 source characters, 10,000 diff rows and 500 declarations. The parser is bundled and runs in a sandboxed frame; test code is never executed.

### Code comments

Comments in source files read as formatted notes, set in the reading type beside the code they describe: Markdown inside them shows as emphasis, lists, links and code, and each note is labelled with its lines ("Doc comment · lines 1–11"). When a comment changed, its note shows the words that changed. A comment you post on a note lands on the matching source lines.

To see comments exactly as written, choose **Settings → Review → Code comments → Source**. Drafts stay open when you switch. Notes follow **External images** like any document, and very large files (over 200,000 characters, 10,000 rows or 500 comments) keep their comments as written.

Hover a code line or a paragraph in a formatted comment to highlight its source target and show **Add a comment…**. On wide screens this stays a full box, even beside an existing discussion, and remains available as you move into it. Choosing it opens the editor and keeps the source target highlighted while you write.

## Large reviews

Big requests are often big because of files nobody reads line by line, and code that only moved. Galley says which is which, so the reading goes to the rest.

### Folded files

These files fold to one line each, saying what the file is, why it is folded and how many lines changed:

- lockfiles, such as `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `Gemfile.lock` and `go.sum`;
- minified files (`.min.js`, `.min.css`) and build output in a `dist` folder;
- vendored code in `vendor`, `node_modules`, `third_party` or `bower_components`;
- generated files, named like `.pb.go`, `_pb2.py` or `.generated.ts`, kept in a `generated` or `__generated__` folder, or marked `@generated` or `DO NOT EDIT` in their first five lines;
- test snapshots (`.snap` files and `__snapshots__` folders) and SVG images;
- edits that only change spaces, tabs or line breaks, except in languages where indentation is meaning, such as Python, YAML and Makefiles;
- renamed files whose text did not change.

Choose **Show changes** to read one. The document menu tags folded files and counts them. A file with a discussion on it is never folded, even when the discussion loads after the file. To read every file in full, turn off **Settings → Review → Fold files you can skip**.

### Reading order

With **Settings → Review → File order → Suggested**, the default, a review reads in the order you would explain it: documents first, then the code, each file followed by its tests, and last the files most reviewers skip. Tests are matched to their code by name and folder: `quota.test.ts`, `quota_test.go`, `test_quota.py` and `QuotaTest.java` follow `quota`, and so does a `quota` file in `__tests__`. **As listed** keeps the platform's order.

### Review chapters

Choose **Chapters** in the top bar, or press <kbd>M</kbd>, for a suggested path through the review. The sheet slides in from the right; on a wide screen the review narrows to make room and stays in reach beside it, and on a phone the sheet rises from the bottom over the review. Chapters use the first two folder levels, keep documents separate from code, and put tests beside their source using the same name and nearest-folder matches as suggested reading order. Each chapter says why its files are together; these are folder names, not guesses about the author's intent. Supporting files have their own chapter.

The sheet lists the chapters in order, numbered, with their first files and how many of them you have viewed; once every file in a chapter is viewed, a check replaces its number. Choose a chapter and it opens on top of the list: why its files are together, **Read chapter**, its changed files and the docs that link to them. Whatever you open from a sheet opens on top of it, and the sheets beneath wait at its edge. **Back** or <kbd>Esc</kbd> goes back one sheet at a time, then <kbd>Esc</kbd> closes the sheet; **Chapters** and <kbd>M</kbd> close it too, and open it again at the list. With a keyboard, <kbd>↑</kbd> and <kbd>↓</kbd> move through a list and <kbd>↵</kbd> opens what you are on; in a chapter, <kbd>←</kbd> and <kbd>→</kbd>, like the arrows beside **Close**, go to the chapter before and after it. The keys that work in a sheet are shown at its foot. Every page's details open in this same sheet: the map's chosen document and a document in **This review** too.

**Start here** goes to the first unviewed readable file. After you mark files Viewed, it becomes **Continue here**. Reviews with six or more files also show a quiet chapter route and **Next chapter**. Choosing a folded file keeps it folded; choosing code while Code files is off turns that setting on. Progress counts explicit Viewed actions, never scrolling.

Chapters account for every file, including folded files, failed loads and code currently turned off. Unsupported formats appear under **Other changed files**, with a link to the platform diff. **All files** lists every file, chapter by chapter, and the original file menu remains available. **Edit** renames chapters, says what to look at in each, changes their order, moves files between them and adds new ones, for this session; **Reset chapters** restores the suggestion. A single-file review needs no chapter setup; when its Project library is available, Chapters also provides a place for supporting context.

Chapters and the Project library share the sheet, so the context of a change is read beside it and you never leave the review. In a chapter, choose **Find linked docs** and it lists the docs in the repository, as this change leaves it, that link to the chapter's files, flagged **Changed in this review** or **Worth checking**. Galley reads the repository only when you ask, a batch at a time (**Read more**), and says how much it read and what it could not.

Choose a doc and it opens on top of the chapter: first the links that tie it to the review, each with its source line, then the document itself. Choose a link to see its paragraph. A link to another doc opens that doc on top in turn, so <kbd>Esc</kbd> goes back through the docs you came from, then to the chapter. **Library**, in the switch at the top of the sheet, lists the docs that link to this review, then every document by folder, with **Search the docs** (<kbd>/</kbd>); choosing it reads the repository too. The expand button beside **Close** opens the whole library over the review, with its map and notes, at the document you are reading.

While reading a supporting article, **Add to chapter** lets you attach the whole document or a heading for this session. It is labelled **Added by you**, is listed under its chapter in **This review**'s **List**, and can be removed in Chapters. Attachments are lost when the review closes. These are reading aids, not saved Project notes or architectural claims.

**Return to review**, at the start of the library's top bar, and <kbd>Esc</kbd> return to the sheet, which waits open behind the library, and to the control that opened it, keeping your paragraph, drafts, folds and Viewed state. Opened at a document from a chapter, the library says which one, above the document and in **This review**, with **Continue chapter**: it returns directly to the current paragraph, or starts that chapter if you were elsewhere. It is disabled for chapters with no readable changed files. Reading project context never marks a file Viewed.

Choose **Edit chapters** to rename a chapter, add an optional introduction, move it earlier or later, or move a file to another chapter. **New chapter** creates a place for your own concern. These changes stay in the open session. Reordering keeps your reading position, Viewed state, folds and comment drafts. **Reset chapters** restores suggestions; choosing **Suggested** or **As listed** in File order restores that reading order.

### Moved code

When code is removed in one place and added in another, in the same file or a different one, both ends get a tint of their own instead of red and green, and a note: **Moved to src/quota.ts, line 3** at the old place and **Moved from src/limits.ts, old line 18** at the new one. Choose a note to go to the other end. Indentation is ignored, so code moved into a block or out of one still matches, and lines edited on the way stay ordinary changes inside the move. A comment that moved with its code says **Moved** too. The byline counts moved lines.

A match needs at least two distinctive lines, 40 characters between them, so a lone brace or `return` never counts as a move. Clean mode shows moved code as plain code.

### What changed, by declaration

JavaScript and TypeScript files with more than one change start with one quiet line, **In this file**, naming each function, class, method (as `Limiter.check`), interface, type and enum that changed, marked + added, • edited, → moved or − removed, then any other changes. A renamed function shows its old and new names. Choose a name to go to its first changed line. Declarations are read by the same sandboxed parser as test plans, and the code is never run.

## Diagrams

Fenced `mermaid` blocks render as diagrams, drawn in the reading palette, light or dark: rounded cards on a soft canvas, muted lines, small-capital group titles. Each diagram is shown at the size its text was laid out for, shrunk only to fit the column. Choose one to open it over the whole window: it starts with all of it in view (a small diagram grows up to twice its size), and from there you can zoom in to read the details of a large one. Pinch or use ⌘/Ctrl + scroll to zoom where the pointer is, double-click to zoom in, or use the − / + buttons and the <kbd>+</kbd> <kbd>−</kbd> keys; the percentage button and <kbd>0</kbd> fit it to the window again. Drag, scroll or use the arrow keys to move around. A click on the backdrop, the close button or <kbd>Esc</kbd> closes it.

An edited flowchart is one drawing of what changed, in the reading palette's change colours and never by colour alone: what it adds is drawn heavier, what it edits heavier with its words in italics, and what it removes is drawn back in, dashed and struck through; **Changes** above it counts them. **Show before and after** opens the two whole versions. Other edited diagrams, and flowcharts Galley cannot read in full, show **Before** and **After**. Clean mode shows the new version. **View source** reveals the Mermaid code, and pointing at the drawing of the changes, or at either version, offers a comment on the matching source fence. Invalid or unsupported diagrams keep their readable source. The engine is bundled and runs in a sandboxed frame that cannot reach the page, your session or the network; external images and icon packs are disabled, and diagrams are limited to 20,000 source characters and 300 edges.

## Comments and replies

Keep the discussion connected to the change. Choose text to comment on, and write your feedback beside it.

- **Start a comment** by selecting text and choosing the **Comment** chip above it, by pointing at a paragraph and choosing **Add a comment…** level with it in the comments column (or the small button beside the text when the column is busy there), or by pressing <kbd>R</kbd>. On touch screens, tap a paragraph.
- **The comments column offers it too.** On wide screens, point anywhere in the comments column and **Add a comment…** appears for the paragraph or line level with the pointer. On the way from a line to its **Add a comment…**, passing over other lines keeps it; pausing on one moves it there.
- **The editor opens beside its text**, which stays tinted; a selection stays highlighted and is quoted above the editor. Other cards move aside so it stays level. On narrow screens it opens below the paragraph. Pointing at a card tints the text it belongs to.
- **Comment locations** follow your selection: selected text is quoted exactly, and the comment anchors to the Markdown block(s) containing it. Removed paragraphs and old diagram versions target the old version. Source-file comments target the selected line or line range. Selections that cross files or mix old and new text are rejected with an explanation.
- **Drafts** stay until you post them or choose **Cancel**. Leave one, comment elsewhere, come back: choosing the same text again returns to its draft, and an editor you never wrote in closes by itself. <kbd>Esc</kbd> leaves an editor and keeps what you wrote; the reader stays open while a comment is unsent.
- **Replies.** Every comment has a **Reply** action; the reply box opens under that comment. GitHub and GitLab threads are flat, so an answer to a reply joins the same thread and starts by mentioning the person it answers.
- **Existing threads** load with the review and sit beside their paragraphs: authors (as the platform names them), times and the comment text, rendered through the same sanitiser as documents. File comments and threads whose line is gone are listed under the document's byline.

Comments use the platform's own review APIs, [GitHub review comments](https://docs.github.com/en/rest/pulls/comments#create-a-review-comment-for-a-pull-request) and [GitLab discussions](https://docs.gitlab.com/api/discussions/#create-a-new-thread-in-the-merge-request-diff), so other reviewers see ordinary platform comments. When the anchored lines are outside the available diff (including omitted or truncated patches), the editor says it will post a quoted GitHub file comment or a GitLab discussion instead of an inline comment. Posting checks the current review revision first. A failed post keeps the draft, and writes are never retried automatically; if a network failure leaves the result uncertain, check the platform before posting again.

## Viewed progress

Mark a file **Viewed** in the top bar (<kbd>V</kbd>) or beside **Fold** at the end of its byline, and it folds to one line, as on GitHub; uncheck it to open it again. Files you already viewed start folded, and a folded file you open yourself stays open. The document menu shows progress and a check beside finished files.

Any file folds the same way: choose **Fold** in its byline, and **Show changes** on the folded line to read it again, just as you left it.

With a GitHub token, Galley reads and updates GitHub's native [Viewed status](https://docs.github.com/en/graphql/reference/pulls#markfileasviewed), including unmarking; these requests check that the review revision is still current, and a failure leaves the previous state and shows an error. Without a token, and on GitLab, progress stays in this browser, keyed to a fingerprint of the file's old and new contents: it resets when that file changes, and unrelated updates keep it. The button's tooltip says where progress is saved.

## Project library and the project map

Galley also reads a project's own documentation, outside any review: its README, specs, decision records and guides, with the same typography, diagrams and settings. Its **Reading settings** (the sliders icon, or <kbd>,</kbd>) share the review reader's **Reading** tab, plus **External images**, and add **Layout**; <kbd>?</kbd> lists its keys.

**Opening.** On a repository's main page, one of its folders or one of its Markdown files on GitHub or GitLab, press **Read the project** in the bottom-right corner. Nothing is fetched until you do. From a Markdown file the reader opens that document at once; from a folder it opens the folder's README, or its first document. Hiding the button with × hides it for that repository.

**One commit.** Galley resolves the branch, tag or commit the page shows to one commit, and reads every document at that commit while the reader is open. The commit is shown in the top bar and under each title. Choose it to check for a newer commit: if the branch has moved, Galley says so and starts over at the new one, reading again only the documents whose content changed. On GitHub the check asks whether the branch has moved without using any of your hourly requests when it has not. A page for a specific commit has nothing newer to check.

**Reading.** Documents are read as they are: no change marks, comments or Viewed. Relative links to other Markdown documents open in the reader at the same commit, and a link to a folder opens its README. Links to source files and other formats open on the platform in a new tab, as does any link you open with ⌘/Ctrl or Shift. Section links scroll to the section and say when it does not exist. **Back** and **Forward** (or <kbd>Alt</kbd> <kbd>←</kbd> / <kbd>Alt</kbd> <kbd>→</kbd>) return to the paragraph you left, at any window width. In Balanced and Wide text, longer documents list their headings in the left margin on wide screens.

**Layouts.** Project library starts in **Focus**: a centred article, with navigation available from the document name. In **Reading settings → Layout**, choose **Balanced** for contents beside the article or **Wide text** for tables, code and diagrams. <kbd>L</kbd> cycles these three choices. Narrow screens stay in one column. Switching layout keeps the paragraph in view. The choice lasts for this library visit; it never overwrites the review's layout. Typography, palette and Comfortable / Compact density remain shared preferences.

**Documents.** Choose the document name in the top bar, or press <kbd>/</kbd>, for every Markdown document at that commit as an outline of folders, README first. Type to find a document by its path or title; once Galley has read documents for the map, their headings are found too and open at that section. Anything the listing could not cover is named at the top, such as a repository too large to list in one go.

**Library chapters.** Outside a review, choose **Chapters** (or <kbd>C</kbd>) for an optional reading sequence. Use **Add** beside a document or search result, or **Add to chapter** in an article to choose its whole document or a heading. **Links from this document** offers only explicit Markdown links, with their source line; a link you have chosen says **Added**, and missing targets still explain the failure when opened. Your stops are numbered in order; choose one to read it, and use **Earlier**, **Later** and **Remove** beside it to change the order. **Read chapter** (shown once there is a stop), **Previous** and **Next** follow it. **Browse all documents** keeps the ordinary outline available. Choices are labelled **Added by you**, last until the library closes, and clear when you explicitly move to a newer commit. Nothing counts as Viewed. A library opened over a review uses that review's chapters and context instead.

**Remembering projects.** By default nothing about a project is kept after the library closes. In **Galley settings → Remembering projects**, turn on **Remember project outlines on this device** and the map of a project you read again skips the documents that have not changed. Galley keeps each document's path, title, headings, links and front matter, never its text, for up to a week after you last read the project, and never from a private window. The same page says how much is remembered and has **Forget remembered outlines**; turning the setting off, or removing a site's token in the popup, forgets what was kept as well. The architecture and infrastructure views suggest where a document "names" a component from the documents read in this visit, so a document taken from the device adds none until you open it.

**Map.** Press **Map** (or <kbd>M</kbd>) to see a document in the middle, the documents that link to it on the left and the ones it links to on the right, with a line for each connection; a document that links both ways keeps its side, with an arrowhead at each end. Point at a document to light its lines. Choose one to open its details beside the map, which narrows to make room: **Preview** shows the document, and links in it preview the document they point to; **Links** says how it connects to the middle, lists every link in and out with its text, section and line (choose one to read that paragraph), names **Links the map cannot follow**, and holds its type. **Show its connections** puts it in the middle, and **Read** opens it. The map keeps its place while you read; **Back to my place** puts the document you are reading in the middle. Drag, scroll or use the arrow keys to move the map, <kbd>+</kbd> <kbd>−</kbd> to zoom and <kbd>0</kbd> to fit it. Each side shows eight documents (four on a phone); **Show more in List** opens the rest. **List** shows every document by folder, with its links in and out. Folders appear as where a document lives, never as a connection: only links someone wrote connect documents. On a phone the map reads top to bottom and details open from the bottom.

The map is built from what documents say. Galley reads up to 150 documents at a time, four at once, and says how many it has read; **Stop reading** stops a pass and **Index more** continues. Documents that cannot be read or are too large are counted, never guessed at. **Linked from**, under every document, uses the same documents.

**Types.** Each document gets a type (Overview, Spec, Decision, Architecture, Runbook, Guide or Document), and Galley says where it came from: the document's front matter (`type`, `kind` or `category`), a guess from its path (a README, `adr/`, `rfcs/`, `ADR-0001-…`), or you. In the map's **Links** tab, change a document's type, or apply it to everything in its folder; your types are kept with your notes when you save them. A decision's or spec's **status** comes from its front matter or its Status section.

**Architecture, Infrastructure and Decisions.** Above the map, switch from **Documents** to another view of the same repository. Everything in them says where it comes from, in words: **Documented** (a document says it), **Declared in configuration**, **Proposed by you**, or **Unverified suggestion**.

- **Architecture** and **Infrastructure** show what the repository's configuration declares: services and their dependencies in Compose files; workflows, jobs and environments in GitHub Actions and `.gitlab-ci.yml`; Kubernetes workloads under `k8s/`, `deploy/` and similar folders; Terraform resources and modules. Galley reads these files only when you press **Read configuration**, in a sandbox, and never runs anything in them. Declared means what the files ask for at that commit, not what is running. What could not be read is said: files too large, included files, references between Terraform resources. Choose an item to see the line that declares it and its connections. A document that names an item by its whole name is listed as an unverified suggestion that it may describe it, with the line; Galley never claims more.
- Add what the files do not show under **Propose something the files do not show** (a component, a data store, an environment), optionally about the document you are reading, and connect it to other items. A declared item's type can be changed too; the type the file gives stays visible beside yours. Proposals are yours, marked as yours, and kept with your notes when you save them.
- **Decisions** lists decision records and specs with their status, which records supersede which (from front matter `supersedes` / `superseded-by`, or links in the Status section), the RFCs they name and the records and specs they link to. When the front matter and the Status section disagree, both are shown.

**Notes.** Press **Notes** (or <kbd>N</kbd>), or **Add a note** under a document's title, for your own ideas, questions, assumptions, next experiments and alternatives. A note can be about the document you are reading, or one of its sections; give alternatives the question they answer and they sit side by side to compare. **Connect…** tentatively connects a note to another note or to an item in the architecture views. Notes are private to this browser and **saved only when you press Save**; until then they are kept as a draft, and a draft left from an earlier visit is offered at the bottom of the page: **Recover** it, or **×** to discard it. **Delete all notes…** asks first, then removes every note, proposal and type you set for that repository. Up to 500 notes are kept per repository.

When a newer commit changes the section a note is about, the note says so: **Reconfirm** once you have read it again, or **Detach** a note whose section is gone. After a refresh the map also says which links changed among the documents read at both commits, and how many notes need another look.

**Export.** **Export…** opens a sheet like the settings that shows exactly what would leave: only the notes you switch on in it, as Markdown or as a Mermaid flowchart, every note labelled a proposal and every source linked at its commit. **Copy** or **Download** it, or **Open a new issue…** to open the platform's own new-issue form in a new tab with the text filled in; nothing is posted unless you submit it there.

The view you are in is named at the right of the top bar; choose it to switch to **Read**, **Map** (<kbd>M</kbd>), **Notes** (<kbd>N</kbd>), **Chapters** (<kbd>C</kbd>) or **This review**. On a phone, open the document-name menu to choose them, which leaves room for the document name in the top bar.

**From a review: Project library.** In a pull or merge request, **Library** in the review's sheet (see [Review chapters](#review-chapters)) reads the repository's docs beside the review, as this change leaves them, at the review's head. The expand button beside **Close** (**Open the full library**) opens the whole library over the review, at **This review**: the project map around the change. In the middle is every file the review changes, chapter by chapter; one that nothing read so far links to or from is a small chip there. On the left are the documents that link to them, on the right the documents they link to, with a line for each link; point at a card to light its lines. On a phone the three stack, top to bottom. **List** shows the same as rows, with what you added to each chapter. Galley never says a document is wrong. Choose one to open it beside the map, which narrows to make room: a preview of the document, and under **Links** how it connects to this review and each link that says so (**Read source paragraph** opens each one). **Show its connections** opens the project map at it, and **Read** opens it in full; <kbd>Esc</kbd> closes it. Changed documents are flagged in the documents list, the byline and the map. Close the library (<kbd>Esc</kbd>) to come back to the review exactly where you were, drafts included.

**What is kept.** Your history and the map last while the reader is open. Notes, proposals and the types you set are kept only when you save them. The reading settings you change (appearance, text size, external images) are saved, the same ones the review reader uses.

**Requests.** On GitHub, opening uses one small API request to resolve the commit, and the documents list one more for the whole tree. A tree too large for one listing is listed again by documentation folder (`docs/`, `specs/`, `adr/` and the like), in at most seven more. Documents are read with your GitHub session, like pull request files, and use no API quota. On GitLab, everything uses your signed-in session. Configuration files are read the same way as documents, only when you ask. Markdown is supported; MDX is read as Markdown and its components are never run, and other formats open on the platform.

## GitLab (gitlab.com and self-managed)

Nothing to configure: Galley reads the merge request with your signed-in session, and comments use the page's CSRF token. On a self-managed instance, click the Galley icon in the browser toolbar and choose **Enable on git.example.com**; the extension then gets access to that one domain. Nested groups and instances under a sub-path work.

## GitHub (github.com and Enterprise Server)

Public repositories work without setup. GitHub allows 60 API requests an hour without a token; Galley uses three for a pull request with up to 100 files, one more per further page of files, and one comparison request when a patch is omitted. Posting a comment also checks that the reviewed version is still current. Reading a project costs one request to find the commit (a few more when the branch name has slashes) and one to list its files (more for a repository too large for GitHub to list at once); its documents are read from github.com itself and cost none, and checking for a newer commit costs none when the branch has not moved.

Private repositories need a token, because GitHub's API does not accept the browser session. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with read-only **Contents** and **Pull requests** access to the repositories you review, then paste it into the Galley popup. To comment, give it **Pull requests: read and write**; **Contents** can stay read-only.

The token is kept in Galley's own extension storage, which web pages (GitHub's included) cannot read. Requests that need it are made by Galley's background worker, never from the page, and only for the few API calls the reader uses on the pull request or repository open in that tab. A repository page can only resolve a commit and list the files of that repository; a pull request page can also list its own repository's files, for Project library. Tokens are saved and sent only for https sites. For GitHub Enterprise Server, enable the site in the popup and save a token for it there; Galley first checks that the site answers like a GitHub Enterprise Server.

## The demo

The [live demo](https://m9sh.github.io/galley/demo/) runs the real reader on a sample merge request. It saves comments in session storage and Viewed progress locally, and never sends anything to GitHub or GitLab. To run it from a checkout: `npm install && npm run demo`, then open http://localhost:4173.

Add `?repo` to the demo URL to read a sample handbook as from a repository page: decision records, an RFC, an architecture note and a runbook that link to each other, with a missing document and a missing section for the map to find, and a Compose file, a workflow, Kubernetes manifests and Terraform for the architecture views. `?repo=docs/adr/0003-queue-for-reviews.md` starts at one document. In the sample review, **Project library** opens the same handbook at the merge request's base or head. Notes in the demo are kept in that browser's local storage.

Add `?spec` to the demo URL to try a test-file review with nested suites, renamed cases, added and removed behaviors, and a comment on a changed assertion.
