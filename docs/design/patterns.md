# Interaction patterns

How the reader's controls behave, so a new feature feels like the rest. Each pattern names the code to copy. When you need something not listed here, add it here in the same pull request.

## Controls

| Control | Use it for | Markup | State |
| --- | --- | --- | --- |
| **Button** | An action | `button.mr-btn` with `data-act="…"`; `mr-icon-btn` for icon-only | Icon-only buttons need `aria-label` and a `title` naming the shortcut: "Close reader (Esc)" |
| **Segmented control** | One of two to four values of a setting | `.mr-seg` with `role="group"`, `aria-label`, `data-setting="<key>"`, and `button[data-value]` children | `aria-pressed="true"` on the chosen one, set by `applySettings()` |
| **Switch** | A setting that is on or off | `button.mr-switch` with `role="switch"`, `aria-checked`, `aria-labelledby` pointing at the row label | Toggle in `onClick()`, persist through `update()` |
| **Choice cards** | Visual choices (palettes, layouts) | `.mr-theme-options` with `data-setting`, cards with a preview, name, check icon and caption | `aria-pressed`; only the chosen card shows its check |
| **Select** | A long list of named values (typeface, a note's kind) | Native `select` inside `.mr-font-select`; `selectField(select)` builds it | `change` event calls `update()`, or the view's `onChange()` |
| **Text field** | One line of the reader's own words (a name, a label) | `textField(name)` → `input.mr-field`, the same size and edge as the select | Inside a form; longer text is the composer's `textarea` |
| **Disclosure** | Showing hidden content in place | A button that names what it reveals: **N unchanged blocks**, **Show changes**, **View source**, **Browse tests** | `aria-expanded` where it toggles; the same right/down arrow everywhere |
| **Chip** | A fact about a file, a document or an item on the map | `chip(kind, text)` → `.mr-chip.is-added` with a dot and a word. Change kinds (`added`, `modified`, `removed`, `moved`) colour the dot; `own` (the reader's own: a type they set, a proposal) carries the accent; `unverified` (a guess Galley has not checked) has a hollow dot; no kind is a plain fact | Never colour alone; links and buttons styled as chips still say what they do. Change colours only for changes |

Settings rows follow one shape: a label with an optional `small` explanation on the left, the control on the right (`.mr-set-row`). `setRow(label, control, explain)` builds one and names the control by its label, so a row works the same in the settings sheet, the export sheet, a form or a card.

Both readers build these controls with the helpers in `src/ui/components/dom.ts` (`chip`, `setRow`, `switchButton`, `selectField`, `textField`, `option`), and share the settings sheet from `src/ui/components/settings-sheet.ts`: its markup, its Reading tab, tab focus and the palette carousel. `layout-controls.ts` builds both Layout panels from one vocabulary, with only supported choices and context-specific previews. Its `LibraryLayout` state starts in Focus and stays in the library session; it never enters saved review settings. Each component has adjacent tests, and the reader integration tests cover navigation and return to a review.

## Actions and events

- **One click handler.** `Reader.onClick()` reads `data-act` from the nearest element and does the work. New actions add a `data-act` value and a branch there, not their own listeners.
- **One key handler.** `Reader.onKey()` handles shortcuts when no field is focused and no sheet is open; the review's side sheet gets first refusal (`ChapterMap.onKey()`, then `Sheet.onKey()`). Every shortcut is listed in `SHORTCUTS` (the Keys tab), the README's **Keys** table and the [user guide](../GUIDE.md).
- **Settings flow one way:** a control calls `update(patch)`, which merges, calls `applySettings()` (which sets root attributes and `aria-pressed` / `aria-checked` everywhere) and saves. Nothing else writes settings.
- **Layout is batched.** Anything that moves cards or bars calls `schedule(true)`; work happens in one animation frame.

## Layers and focus

Layers, innermost first: the enlarged diagram, the settings sheet, the side sheet and the sheets stacked in it (Review chapters and the Library, the map's details, a document in This review), the document menu, the selection chip, an editor, then the reader itself.

- **<kbd>Esc</kbd> closes the innermost layer** and nothing else. With an editor focused, <kbd>Esc</kbd> leaves it; an empty editor closes, and one with a draft stays ("Draft kept. Cancel discards it."). The reader closes last, and refuses while a comment is unsent ("You have an unsent comment. Post it, or choose Cancel to discard it.").
- **Focus moves in, and comes back.** Opening the settings sheet focuses its close button; a side sheet focuses itself, named by its label, so <kbd>↓</kbd> goes straight into its list. A sheet that covers the page marks the page behind `inert`. Closing returns focus to the control that opened it. Closing the reader returns focus to where it was on the page.
- **Focus stays inside.** <kbd>Tab</kbd> cycles through the visible controls of the current layer (the diagram, the sheet, or the reader).
- **Tabs use roving focus.** Settings tabs move with the arrow keys, <kbd>Home</kbd> and <kbd>End</kbd>.
- **Menus close on an outside click** and when another opens (`closeMenus()`).
- **One side sheet, a stack.** Details beside what a page shows use `Sheet` (`src/ui/components/sheet.ts`), on every page: Review chapters and the Library beside them, the map's selected document and a document chosen in **This review**. It is `aside.mr-sheet` plus its own class. On wide screens it sits on the right edge at `--sheet-width` and the page narrows (`.mr-root.has-sheet`) instead of being covered, sliding aside with it (`slideWith()` in `motion.ts`); it is not modal. On phones it rises as a bottom sheet over a scrim, `role="dialog"` with `aria-modal`, the page `inert` and <kbd>Tab</kbd> inside it. It slides in and out, and reduced motion removes the slide. The page fills the first sheet (`fill()`), opens and closes it (`show()`, `hide()`), decides what **Close**, the backdrop and <kbd>Esc</kbd> on the first sheet do (`dismiss`), and gives focus back. Do not build another.
  - **What opens from a sheet opens on top of it** (`push()`): a chapter from the chapters, a document from a chapter or the Library, and a document from a link in a document, so <kbd>Esc</kbd> goes back through what the reader came from. Each slides in from the right edge and stops a step further in than the one beneath (`--sheet-peek`), lifted by its shadow; a sheet beneath another is only its edge, full height and in shade (`--recede`), its contents out of view, and choosing the edge goes back to it (`popTo()`). On phones the stack rises instead, each sheet a step lower than the one beneath. **Back**, named after the sheet beneath, and <kbd>Esc</kbd> go back one sheet at a time; on the first sheet <kbd>Esc</kbd> closes it. Stepping to a sibling, such as the next chapter, takes the top sheet's place instead (`replace()`), keeping its way back and the focus on the control that stepped.
  - **Every sheet has the same anatomy** (`SheetContent`): a top row with a way back or a switch (`.mr-sheet-tabs`, the first sheet's title), its own actions and **Close** last; an optional kicker, the title (`.mr-sheet-title`; a document's is set as the document is) and a description; under them a search field, the main action or tools (`extra`); then one scrolling `.mr-sheet-body` of sections (`sheetSection()`: a small title, a count, quiet actions) made of rows (`sheetRow()`: a decorative lead mark, a title, a meta line, a short value at the end, and a chevron when the row opens another sheet; a row for another site is a link). Lists are rows, never cards; the chapters are a path of numbered rings joined by a line.
  - **Keys are shown where they work.** On screens with a keyboard, every sheet lists its keys at its foot (`keys`), ending with what <kbd>Esc</kbd> does there (**Back** or **Close**); Back and Close name <kbd>Esc</kbd> in their tooltips. Touch screens and phones hide them. With focus in the sheet on top, <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Home</kbd> <kbd>End</kbd> move between rows, <kbd>↓</kbd> enters the list from the header or the search field, and <kbd>/</kbd> goes to the search field.
  - **Focus follows the stack.** Each sheet takes focus as it opens; going back returns focus to what opened it, or to the control drawn in its place since (the same element with the same data, `twin()`), else to the sheet now on top.
  - **One width.** Every sheet is `--sheet-width`, the chapters and a document alike, so going deeper never moves the page.
- **One settings sheet.** Choices about the reader are `.mr-settings` → backdrop and `.mr-settings-panel` (`role="dialog"`, `aria-modal`), with a heading, a close button and `.mr-settings-body` of sections and rows: the settings, and the repository reader's **Export notes**. It sits at the top right on wide screens and rises from the bottom on phones.

## Navigation

| Intent | Keys | Behaviour |
| --- | --- | --- |
| Next or previous change | <kbd>J</kbd> <kbd>K</kbd>, the pill | Scrolls the change to 30% of the viewport and flashes it |
| Next or previous conversation | <kbd>N</kbd> <kbd>P</kbd> | Same, for thread anchors |
| Next or previous file | <kbd>]</kbd> <kbd>[</kbd> | Follows the current file order |
| Any file | <kbd>F</kbd>, the file name | The document menu |
| A route through the review | <kbd>M</kbd>, **Chapters** | The chapter map |
| A phrase anywhere | <kbd>/</kbd>, the search icon (narrow phones: **Search this review** in the document menu) | The search popup; choosing a result shows it in place, and the results bar steps through the rest or goes **Back to where you were** |

Moving never changes state: it does not mark files Viewed, open folded files, or discard drafts. The one exception is a search result the reader chooses: it opens what folds that text (a folded file, an unchanged stretch, a test-plan section), because seeing it was the request. Viewed and drafts still never change.

**Searching a review.** The field is a combobox over a listbox: the first result is active, arrow keys move, <kbd>Enter</kbd> chooses, and focus stays in the field while results are chosen with the pointer. Results are grouped by file in reading order and say what each is, where it is and which version it is in; private content says **Only you can see it**. The popup always says what it searched and what it did not (code files left off, files loading or failed), so no matches never reads as nothing there; loading more is a separate, explicit action. Matching runs in pauses of a few milliseconds, a newer query replaces an older one, and at most 200 results are listed, with the total reported. A chosen result moves instantly, as find in a browser does, flashes, and keeps its words marked with the Custom Highlight API (tint and underline) until the results bar closes. **Back to where you were** returns to the file and offset read before the search began, however many results were visited.

## Feedback

- **Toasts** (`toast()`, `role="status"`) confirm what just happened in a few words, optionally with **View on platform**, and leave after six seconds. Use them for results of an action the reviewer took ("Comment posted", "Layout: Review"), not for errors that need action.
- **Inline status** sits next to what it describes: an editor's status line, the Viewed feedback line under the top bar, a chapter map's feedback line.
- **Offers to pick up** use the resume pill (`.mr-resume`): a sentence, one action, and **×**. The review reader offers to continue reading; the repository reader offers to **Recover** unsaved notes.
- **Progress** shows as text ("1 of 3 viewed", "Change 3 of 12"), never only as a bar.
- **Saving** is never claimed before it succeeded. A failed Viewed update restores the previous state and says so; storage failures are surfaced.

## Errors and empty states

- **Say what happened, then what to do.** `ReaderError` carries a message and a hint ("GitHub API rate limit reached." / "Wait a few minutes and try again."). A missing token adds the steps to create one.
- **Always offer a way out.** Full-page messages end with **Back to the diff**.
- **Never pretend content is empty.** A file that failed to load says so in the chapter map and the document menu; changes that cannot be shown are counted ("3 lines not shown") and linked to the platform diff.
- **Empty means helpful.** No documents? Explain and offer **Reading settings** to turn on **Code files**.
- **Writes are not retried.** A failed post keeps the draft and says to check the platform before posting again if the result is uncertain ([ADR 0008](../adr/0008-comment-through-platform-review-apis.md)).

## Loading

- Each file shows a skeleton until it renders; files load in reading order from the current one.
- Heavy work (diagrams, syntax colours, test plans) arrives after the text, from sandboxed frames, without moving what the reviewer is reading.
- Positions are restored only by an explicit **Continue**.

## Commenting

1. **Start** by selecting text (the **Comment** chip), pointing at a block (**Add a comment…** in the comments column), tapping a paragraph on touch screens, or pressing <kbd>R</kbd> for the paragraph in focus.
2. **The editor opens where the thread will appear**, level with its text, which stays tinted; other cards move aside. It names its target ("Comment on old lines 30–34") and says in advance if it will post a file comment instead of an inline one.
3. **Drafts persist** while the reader is open. Choosing the same text again returns to its draft; an untouched editor closes when you go elsewhere.
4. **Post** with **Comment** or ⌘/Ctrl Enter. Success shows a toast with **View on platform**; failure keeps the draft and explains.
5. **Reply** under any comment; replies to replies join the thread with an @mention, because platform threads are flat.

Writing that stays private uses the same shapes. In the repository reader a new note, an edited note and a proposal for the map are composer cards (`.mr-composer`, a `.mr-comment-target` naming what is written, fields in settings rows, then `.mr-compose-actions`), and each saved note is a thread card of the reader's own (`.mr-thread.is-own`) with its actions in `.mr-thread-foot`.

## Folding and context

- A fold always says what it hides and how much: "4 unchanged blocks"; "Lockfile · Written by a package manager when dependencies change · 1,204 added".
- Opening is one action, and the content opens exactly as it was left.
- Folding is not progress, and Viewed is not folding: marking a file Viewed folds it, but folding a file does not mark it Viewed.
- A file with a discussion never folds automatically.

## Copy in the interface

Follow [COPY.md](../COPY.md). In controls specifically:

- Label buttons with what happens: **Show changes**, **Save token**, **Back to the diff**, **Start here**.
- Name settings by what the reviewer chooses, with the choices as nouns: **Context: Changed parts / Whole files**.
- Use sentence case, no full stop in labels, and "…" only for actions that open something to type in (**Add a comment…**).
- Write numbers with separators and units: "1,204 added", "20 px", "lines 31–37" (en dash).

## Supporting reading for a chapter

Changed files and Project context are separate groups. Context controls show base/head and the commit before opening material. Automatic connections show their source link and line; session attachments say Added by you and offer Remove. The library's return row names the originating chapter. Return to review restores the context control; Continue chapter resumes the review article. A native Add to chapter disclosure contains the chapter and heading selects, session lifetime explanation, submit action and live confirmation.

## Proposed spatial map interaction

The demo-only [Project map proposal](project-map-reimagining.md) uses native place buttons over an SVG line layer; each line also has a wide, transparent stroke that selects it. Selection updates one details sheet; **Show its connections** deliberately changes the neighbourhood, while **You are here** retains the reading place. A separate session bookmark retains the view, camera, selection and sheet during an article round trip. These patterns require ADR 0030 review and reader validation before production adoption.

- **One bar.** The project name, search, **Map**/**List**, **Details** and settings share the top bar; phones give search its own row. Reading a document puts **Back to map** and the document's name in the same bar, never inside the article.
- **A sheet that makes room.** On wider screens, details open in a full-height column beside the map. The map narrows instead of being covered, the sheet is not modal, and Tab moves between them. It keeps its width while its column grows, so it slides in from the edge without reflowing; reduced motion removes the slide. On phones the same sheet is a bottom sheet at layer 40: the background is inert, Tab stays in the sheet, and Escape or Close return focus to the selected place. The header holds the type, the name, the path, **Preview**/**Links** tabs, and **Read**, **Show its connections** and **Close**; there is no footer. Arrow keys move between the tabs.
- **Light, not labels.** Lines are neutral. Pointing at, tabbing to or selecting a place lights its lines in the accent and dims the others to 18%; links between two neighbours appear only then, dashed. Colour is never the only cue: lit lines are also thicker, and two-way links have an arrow at each end.
- **Search as a combobox.** The field has `role="combobox"` and points at a listbox popup with `aria-activedescendant`. Matches are grouped under a count, suggestions under **Recent** and **Around** the focus. Matched words are bold and underlined rather than coloured. Each result says whether it is already on the map. Escape closes the popup, then clears the field, and only then leaves the panel.
- **Addresses in the demo.** Reading writes `doc=` into the demo's own address; **Back to map** retraces the entries reading added, so the browser's Back and Forward agree with it. The extension does not change a GitHub or GitLab page's address.

The prototype uses the shared **Reading settings** sheet, palette carousel and type preview. Reading choices apply the saved palette, appearance (including System), named typeface, text size and top glow; Layout contains the implemented Density control. The settings sheet makes the map inert, traps keyboard focus and returns focus to its opener on Escape. Changes stay in this prototype session. Preview uses the safe renderer: links continue inside the preview, diagrams show their source without an unstarted loading indicator, and external images remain on request.
