---
status: Accepted
date: 2026-10-11
deciders: [m9sh]
rfcs: [49]
supersedes: [26]
tags: [repository, ui, accessibility]
---

# ADR 0030: A spatial project map and an equivalent list share one evidence model

## Context

[Issue #68](https://github.com/m9sh/galley/issues/68) proposes a Project map that helps a reader recognise their place, inspect connections and follow their sources. [ADR 0026](0026-an-evidence-only-project-map.md) requires a list presentation. Its provenance and evidence rules remain necessary, but its presentation gives little spatial orientation.

**This record supersedes ADR 0026** (accepted by the maintainer on 2026-10-11). ADR 0026's evidence, origin, conflict, classification and suggestion rules carry over unchanged; only its list-only presentation is replaced. The extension's Map adopts it view by view: **Documents** first, then the declared-system views (issue #68, stages 2 and 3).

## Decision

The replacement preserves all of ADR 0026's evidence, origin, conflict, classification and bounded-suggestion rules, and replaces its presentation requirement:

- Project map offers a bounded spatial neighbourhood and a complete navigable **List** over the same filtered evidence model. Both expose the same places, relationships, evidence and actions. Native buttons and a non-interactive SVG layer provide spatial rendering; the equivalent list works without interpreting geometry.
- A document line comes only from an explicit Markdown link. Missing documents and missing anchors are inspectable problems, never verified lines. Every relationship names its direction, source verb, origin, file, section, line and commit. Configuration-derived relationships keep their declarations and caveats; neither presentation implies live infrastructure.
- **Documents** is the initial source choice; **Declared systems** is proposed for the existing configuration model. Configuration is read only on the existing explicit action. Folder regions are literal containment; counts between them represent actual references, never inferred service boundaries.
- Selection is inspection. It does not move the neighbourhood's focus or the current reading place. **Show connections** changes focus deliberately; **Back to my place** restores the reading place. Source navigation keeps a separate map bookmark and article paragraph history. Camera, selection and placement are session-only and reset for a new commit.
- A neighbourhood shows the focus with up to eight incoming and eight outgoing neighbours on desktop (the presentation budget), and four per side on phones, counting what is hidden. The rest open in List, filtered to that neighbourhood, on an explicit action. Lines between two neighbours appear only while one of them is pointed at or selected. Deterministic, session-stable slots keep existing neighbours in place as indexing adds evidence. Labels retain their readable size; the map does not simulate forces across the repository.
- Selecting a place opens one details sheet that previews the document, with its links a tab away. On wider screens the sheet takes a column beside the map, narrowing it rather than covering it, and is not modal; when the narrowed map is too small for three lanes, the lanes stack. On phones it is a labelled bottom sheet using the existing sheet layer, with the background inert. Close and Escape restore focus. Buttons, keyboard and List accomplish camera/navigation tasks without gestures. Motion respects reduced motion.
- Search finds indexed names and paths and lists ranked matches in a popup under the field; it never replaces the map. Choosing a match selects it where it is, or makes it the new centre when it is not on the map.
- Partial indexing, read failures, source conflicts, unresolved links and presentation omissions stay visible. A zero count is not a claim about unindexed source. Reader corrections keep the original classification beside them. Reading chapters remain explicitly assembled **Added by you** routes, separate from source relationships and progress.

Source-choice labels and initial counts stay open to reader validation. No new dependency, permission, storage key, network host or source inference is introduced. The demo puts the document being read in its own page address (`doc=`), so Back, Forward and links work there; in the extension the page belongs to GitHub or GitLab, and changing its address would need a separate decision.

## Consequences

- **Good:** the reader can retain a recognisable neighbourhood while checking another place, and trace a line back to source.
- **Costs:** two presentations must preserve selection, evidence and action parity. Dense relationships need bounds, disclosed counts and deliberate expansion.
- **Follow-up:** the extension's **Documents** map follows this record (`src/ui/library/map-view.ts`), and so does **This review**, the same map around the files a review changes. Search in a popup on the map, declared systems, chapters and refresh changes follow in separate slices; diagram extraction remains separate. Voluntary reader sessions still inform the labels and counts.

## Alternatives considered

- **Keep only the current lists:** strong for evidence auditing, weak for spatial orientation. List keeps that strength beside the map.
- **Whole-repository force graph:** unstable placement and small labels; no demonstrated need for a layout dependency.
- **Infer dependencies from prose, folder proximity or a model:** breaks the evidence contract and can manufacture authority.

## Enforcement

- `src/core/project-map.test.ts` checks exact evidence, anchor failures, conflicts, correction provenance, deterministic incremental placement with per-lane totals, cycles, isolation, containment and presentation budgets (2,000 places, 6,000 inspected connections, 12 evidence previews, 8 neighbours per side).
- `src/ui/library/map-view.test.ts` and `src/ui/library/repo-map.test.ts` check the extension's map and List over the same model: lanes, lines and arrowheads, lit lines, the camera by buttons, keys, trackpad and drag, stacking, the details sheet (Preview, Links, evidence, problems, the type editor), the phone's modal sheet, List paging and its neighbourhood filter, the map's own place across reading, Back to my place, and corrections.
- `e2e/repo.mjs` checks the map in Chrome: the sheet narrowing the map, evidence opening its paragraph, problems listed and never drawn, the phone's stacked map and bottom sheet with full touch targets, and no sideways scrolling. `e2e/project-map.mjs` keeps checking the demo prototype, and the build keeps the prototype out of the extension.

## References

- [RFC 0049](../rfcs/0049-repository-docs-and-project-maps.md), [implementation task #68](https://github.com/m9sh/galley/issues/68).
- [ADR 0024](0024-read-a-repository-at-one-commit.md) commit identity, [ADR 0027](0027-read-configuration-statically.md) static declarations, [ADR 0028](0028-private-project-notes.md) explicit private notes.
