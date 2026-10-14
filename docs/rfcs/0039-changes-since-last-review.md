---
status: Accepted
created: 2026-10-10
authors: [m9sh]
discussion: https://github.com/m9sh/galley/issues/39
theme: Never lose the thread
phase: Follow-up after the core experience
progress: The file-level and incremental view are built for GitHub and GitLab, with an explicit Mark as reviewed; choosing any earlier head, chapter marks, and reconfirming private notes are open
implemented-in: [https://github.com/m9sh/galley/pull/93]
adrs: [19, 34]
---

# RFC 0039: Show what changed since my last review

## Problem

New commits can force a reviewer to work out which parts of a previously examined MR need another look. Restarting from the whole diff can waste attention, while trusting old progress can leave changed behavior insufficiently examined.

Current local Viewed fingerprints already reset when a file changes. This RFC proposes a coherent re-review experience that explains what changed since a known review baseline.

## Proposal

Let reviewers retain a clearly identified reviewed revision and compare it with the current head. Show additions, edits, deletions and renames since that baseline, with a route through affected files or chapters.

Preserve applicable progress for unchanged content and identify affected areas needing another look. Provide both the incremental comparison and the full current MR diff; reviewers should understand which one they are reading.

Private follow-ups and checkpoints should retain their history. Changed anchors should be marked for reconfirmation rather than silently treated as current.

## Proposed acceptance criteria

- [ ] The reviewer can identify and choose the baseline revision for an incremental comparison.
  - The card names the baseline, and the reviewer chooses it by marking a version reviewed. Picking any earlier head from a list is not built.
- [x] The view clearly labels its baseline and current head, and offers the full current diff.
  - **Showing what changed since 4f2a9c1**, "4f2a9c1 → 9d3e7b2", and **Show the whole review**.
- [x] Added, changed, renamed and deleted files are represented.
  - Each changed file is drawn from its earlier version, with its own status. Files that did not change step out of the way.
- [x] Unchanged review state is preserved; affected state is visibly marked for re-review.
  - Viewed belongs to the review's own contents, so a changed file is unchecked and the rest stay. Changed files say **Updated since …** in their byline, the document menu and the Files layout.
- [x] Updating local state does not silently mark provider files Viewed or imply approval.
  - **Mark as reviewed** is local, says so beside the button, and is tested not to touch the platform's Viewed state.
- [ ] Changed note/checkpoint anchors retain the user's text and show when reconfirmation is needed.
  - Private follow-ups and checkpoints do not exist in the review reader yet ([RFC 0037](0037-private-follow-ups.md)).
- [x] Unavailable baselines, force-pushed history, incomplete comparisons and fetch failures are distinguished from “no new changes.”
- [x] The reviewer decides when to advance the baseline.
  - Opening the reader never moves the mark. **Mark as reviewed** and **Unmark** do.
- [x] Focused comparison/state tests and browser checks cover the failure paths and retain existing coverage gates.

## Alternatives and tradeoffs

- **Reset all progress on every new head:** easy to reason about but discards useful work.
- **Show only changed files:** cheaper than a full incremental diff, but may still require re-reading large files and can obscure removed content.
- **Keep prior diffs locally:** can enable richer comparisons, but storing repository content changes privacy and retention obligations. Prefer provider-accessible revisions and minimal local metadata where possible.

A file-level version may be a useful first increment if it clearly communicates its limits.

The first increment went further than that, on both platforms: [ADR 0034](../adr/0034-show-what-changed-since-the-reviewer-last-looked.md) records what it keeps and how it compares.

## Open questions

- **Engineering, blocking:** Which provider APIs supply reliable revision comparisons, including rebases and unavailable old commits?
  - Answered on 2026-10-14, by trying both platforms. GitHub's `compare/{old}...{head}` and GitLab's `merge_base` with `compare?straight=true` say whether the earlier head is part of this one's history, and list the files that differ.
  - GitHub's comparison lists at most 300 files, and its two-dot form does not exist. A rewritten branch, a commit the platform no longer has, and a long list are each said so, and never read as "no new changes".
- **Product/design:** What reviewer action establishes or advances a baseline?
  - Answered by the maintainer on 2026-10-14: an explicit **Mark as reviewed**, with the head the reader was last opened at suggested until then.
- **Engineering:** How should local progress reconcile with native provider Viewed state?
  - Not decided here. The mark is local and does not touch Viewed. A file that changed is unchecked, because Viewed is keyed to its contents, and is marked **Updated**.
- **Design:** How can the incremental view keep dependencies and unchanged context discoverable?
  - Open. Files that did not change are out of the way, and the whole review is one choice (<kbd>U</kbd>) away. Chapters do not yet mark what changed.
- **Product/engineering:** What baseline metadata can be retained within the existing privacy model?
  - Answered by the maintainer on 2026-10-14: a commit id per review, on the device, as fingerprints plus commit ids only ([ADR 0034](../adr/0034-show-what-changed-since-the-reviewer-last-looked.md)).

## Validation

Use real MRs with an initial review and a subsequent revision. Ask reviewers to identify new work and explain which earlier conclusions still apply. Compare repeated reading and missed consequential edits with the full-diff workflow. Explicitly test rebases, deletions and unavailable baselines. Record results through research sessions, without product telemetry.

## Sequencing

A proposed follow-up. Integrates with review chapters, private follow-ups and checkpoints, while remaining useful with the existing Viewed model.

## Related RFCs

- [RFC 0036](0036-review-chapters.md) — Review chapters with a clear starting point (core)
- [RFC 0037](0037-private-follow-ups.md) — Private follow-ups for review questions (core)
- [RFC 0038](0038-pause-and-resume.md) — Pause and resume the reviewer's train of thought (core)
- [RFC 0040](0040-thoughtful-finish.md) — A thoughtful finish for a review (follow-up)
