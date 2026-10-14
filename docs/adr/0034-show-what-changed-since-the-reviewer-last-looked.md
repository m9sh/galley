---
status: Accepted
date: 2026-10-14
deciders: [m9sh]
rfcs: [39]
tags: [privacy, storage, reader, platforms]
---

# ADR 0034: Show what changed since the reviewer last looked, from commit ids kept on the device and a comparison the platform makes

## Context

A reviewer who comes back to a review after new commits has to work out what needs another look ([RFC 0039](../rfcs/0039-changes-since-last-review.md)). Starting again from the whole diff wastes attention. Trusting old progress can miss a change.

Viewed already resets for a file whose contents changed ([ADR 0019](0019-review-progress-as-fingerprints.md)). That says nothing about what changed, or against which version.

Galley needs two things: a head to compare with, and a comparison it can trust.

### What the platforms give

Checked against the live APIs on 2026-10-14.

**GitHub**

- `GET /compare/{old}...{head}` is already allowed on a pull request page ([ADR 0009](0009-github-tokens-in-the-background-worker.md)). Only the three-dot form works; the two-dot form answers 404.
- It answers `ahead`, `behind`, `diverged` or `identical`. `ahead` and `identical` mean the old head is part of the new one's history.
- It lists at most 300 files, all on the first page. Later pages list none, however much changed.
- An unknown commit answers 404.

**GitLab**

- `repository/merge_base?refs[]=old&refs[]=head` says whether the old head is part of the new one's history.
- `repository/compare?from=old&to=head&straight=true` lists the files that differ, and says when it timed out.
- Both use the reviewer's session, as every other GitLab read does.

The comparison calls say nothing about which head the reviewer last saw. That has to be remembered here.

## Decision

Galley remembers commit ids on the device, asks the platform for the comparison, and never stores the comparison.

### What is remembered

One key, `galley:revisions`, in `chrome.storage.local` (`localStorage` in the demo). For each review it holds:

- under a SHA-256 fingerprint of the review's address, never the address itself;
- `reviewed`: the head the reviewer marked as reviewed, if any;
- `seen`: the last two heads the reader was opened at;
- `at`: when it was last written.

Only the 50 most recent reviews are kept. A value that is not a 40- or 64-digit hexadecimal commit id is ignored when read. No path, title, text or address is stored (`src/ui/review/revisions.ts`, `fingerprint.ts`).

A commit id says nothing readable on its own. It is still an identifier of a private repository's history, so [PRIVACY.md](../../PRIVACY.md) and the [storage inventory](../architecture/storage.md) list it.

### Which head to compare with

- The head marked as reviewed, when there is one. The reviewer chose it.
- Otherwise the last head the reader was opened at that differs from the current one, offered as a suggestion.
- Otherwise nothing: the reader has no earlier head to speak of.

**Mark as reviewed** is an explicit action. Opening the reader never advances it. **Unmark** takes it back, and the last opened head is suggested again.

The mark is local. It does not approve the review, mark any file Viewed on the platform, or write anything there ([ADR 0008](0008-comment-through-platform-review-apis.md)).

### What the comparison says

A `ReviewSource` may offer `history`: its current head, and `since(commit)` ([the contract](../architecture/README.md#the-reviewsource-contract)). The answer is one of:

| Answer | Meaning | What the reader does |
| --- | --- | --- |
| `changes` | The earlier head is part of this one's history; here are the files that differ, possibly none | Offers **Show only what changed**, and marks the files |
| `rewritten` | It is not part of this history, as after a force push | Says so, shows the whole review |
| `unavailable` | The platform no longer has it | Says so, shows the whole review |
| `incomplete` | The platform listed only some of the files | Says so, shows the whole review |
| (a failure) | The request failed | Says so with what to do, and offers **Try again** |

No answer but `changes` is shown as "no new changes". The reader never guesses a comparison from a rewritten branch.

GitHub's answer costs one request. GitLab's costs two. Reading a changed file at the earlier head costs one more, once, only when the reviewer chooses to read what changed. Raw files are read with the reviewer's session, as every document is.

### Reading only what changed

While **Show only what changed** is on:

- A file that changed is drawn from its earlier version to the review's head. A file that did not change is out of the way.
- Viewed, folding and reading positions belong to the review's own contents and stay as they were. Viewed is never keyed to the earlier version.
- Comments can be written on text that is in the head. Old lines in this view belong to an earlier head, not the review's base, so a comment on them is refused with the reason, and existing old-side threads are shown on their file.
- Unsent comments stay where they are written: the view does not change under them.

The whole review is one choice away, and the bar says which one is showing.

## Consequences

**Good**

- A reviewer coming back sees which files changed, and can read only those changes.
- A comparison that cannot be made is said to be one, and never reads as "nothing changed".
- Nothing readable is stored. The comparison itself is asked for each time and never kept.
- No new permission, host, or allowlisted request.

**Costs**

- Commit ids of reviews are kept on the device, for up to 50 reviews, until uninstalled or pushed out by newer ones.
- A branch rewritten since the reviewer last looked cannot be compared. Reviewers who force-push often will see the whole review.
- GitHub lists at most 300 files, so a very large update is `incomplete`.
- A change in a file only on the base (a merge from the target branch) is not in the review's files, and so is not shown.
- Chapters do not mark which files changed since. The files menu, the Files layout list and each file's byline do.

**Follow-up**

- Reconfirmation of private notes whose text changed ([RFC 0037](../rfcs/0037-private-follow-ups.md)).
- Reconciling the mark with the platform's own Viewed state.
- Marking changed files in Chapters.

## Alternatives considered

- **Keep earlier versions of files on the device:** a richer comparison, even after the platform loses the commit. It stores repository text without the reader choosing it, and does not fit the extension's storage.
- **Compare two diffs instead of two heads:** survives a force push, but needs both full diffs and is hard to explain to a reviewer.
- **Reset progress on every new head:** simple, and throws away work.
- **Advance the baseline whenever the reader opens:** the reviewer would lose the changes they have not yet read. The RFC asks that the reviewer decides.
- **Read the head from the reviewer's own submitted review:** GitHub's reviews carry the commit they were made at. It only covers reviewers who submit formal reviews, and needs a new allowlisted call and a way to know who the reviewer is.

## Enforcement

Tests:

- `src/ui/review/revisions.test.ts`: fingerprinted keys, commit ids only, the 50-review bound, the two heads kept, damaged storage, and which head is compared with.
- `src/platforms/since.test.ts`: GitHub and GitLab answers, including rewritten, unavailable, incomplete and failed, and the requests made.
- `src/ui/review/reader-since.test.ts`: the bar, the mark and unmark, reading only what changed, comments and drafts, and what each answer says.
- `e2e/revisions.mjs`: the same in Chrome, with a phone layout.

Review:

- A new field in `galley:revisions` is a privacy change: [PRIVACY.md](../../PRIVACY.md) and the [storage inventory](../architecture/storage.md) must list it.

## References

- [RFC 0039](../rfcs/0039-changes-since-last-review.md), [issue 39](https://github.com/m9sh/galley/issues/39).
- GitHub: [compare two commits](https://docs.github.com/rest/commits/commits#compare-two-commits).
- GitLab: [compare branches, tags or commits](https://docs.gitlab.com/ee/api/repositories.html#compare-branches-tags-or-commits) and [merge base](https://docs.gitlab.com/ee/api/repositories.html#merge-base).
