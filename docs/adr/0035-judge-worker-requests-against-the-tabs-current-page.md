---
status: Accepted
date: 2026-10-14
deciders: [m9sh]
rfcs: []
tags: [security, github, bug]
---

# ADR 0035: Judge the worker's requests against the page the tab is on now

## Context

The background worker makes only the GitHub calls that belong to the pull request or repository open in the tab ([ADR 0009](0009-github-tokens-in-the-background-worker.md)). To know which one that is, it used the address the browser reports for the sender, `sender.url`.

The browser keeps `sender.url` at the address the document was **loaded** at. GitHub and GitLab move between pages without loading one: a click from a pull request list to a pull request changes the address and swaps the content. The content script is the same, and so is its `sender.url`.

So after such a click, the reader asked for pull request 96 while the worker judged the request against the pull request list. It refused it. The page-side wrapper then reported every refusal as a lost connection:

- The Read button turned red, with a `!`.
- The reader said **Could not reach GitHub. Check your connection and try again.**
- Loading the same address fresh worked, which is why it looked like a flaky connection.
- GitLab was not affected: its content script reads with the page's own session, without the worker.

This was in the worker from the start (0.3.1). It was found by reproducing the click-through in the shipped extension against real GitHub, and by logging what the worker received.

## Decision

The worker judges a request against the page the **tab** is on now.

- `pageOf()` in `src/background/worker.ts` uses `sender.tab.url`, which follows the navigation, in place of `sender.url`.
- It does so only for the **top frame** (`frameId` 0) and only when the tab's address is on the **same origin** as the frame's own address. A frame cannot name a page other than its own, and a tab address on another site cannot stand in for it.
- The token is still looked up by the **frame's** origin, as before.
- Without a readable tab address, the address the document was loaded at counts, as before.
- Both addresses come from the browser, never from the message.

The page-side wrapper (`backgroundApi()` in `src/platforms/github-api.ts`) no longer reports every failure as a lost connection:

| What happened | What the reader says |
| --- | --- |
| The worker refused the request | **Galley could not ask GitHub for this page.** It says to reload, and what the worker said |
| A read got no answer from the worker | **Galley could not reach its background worker.** It says to reload the page |
| A write got no answer from the worker | Unchanged: status 0, which the reader says it cannot confirm, so the reviewer checks the platform before trying again ([ADR 0008](0008-comment-through-platform-review-apis.md)) |
| The worker's own request to GitHub failed | Unchanged: **Could not reach GitHub** |

A refusal happens before anything is sent, so it is certain for a write too. An unanswered write may have been made, so it stays uncertain.

## Consequences

**Good**

- Opening a review by clicking through GitHub works, which is how most people arrive.
- A refusal or a missing worker no longer reads as a network problem, so the next bug of this kind says what it is.

**Costs**

- A script in the page can change the tab's address with `history.pushState`, so the page now has some say in which pull request or repository of its own site the worker allows. Before, the loaded address fixed it. This is bounded:
  - Only calls on the allowlist are made, and only for a page of the same site.
  - The token is the reviewer's own, and a script that can run in github.com already acts with the reviewer's session, which can do more than a fine-grained token.
  - Galley does not run on any other site, except an enterprise site the reviewer has enabled.
- Reading the tab's address needs the host permission Galley already has for github.com and gitlab.com, and the one the reviewer grants for an enterprise site. It adds no permission.

## Alternatives considered

- **Reload the page when the review changes:** keeps `sender.url` right, but reloads GitHub under the reviewer on every click, and the reader would have to survive it.
- **Let the content script say which page it is on:** the page controls the message, so the worker would be trusting what it is meant to check.
- **Watch navigations in the worker with `webNavigation`:** a new permission for the same answer the tab already gives.
- **Only fix the message:** the click-through would still fail, with a better explanation.

## Enforcement

Tests:

- `src/background/worker.test.ts`:
  - a request is judged against the tab's page, not the loaded one;
  - it is that page that is allowed, and no other;
  - a frame and a tab address on another site cannot widen what is allowed;
  - the token follows the frame's site.
- `src/platforms/github-api.test.ts`: each outcome in the table above, including that an unanswered write stays uncertain.
- `e2e/navigation.mjs`: in the shipped extension, a click-through from a list to a pull request, and on to another, reads each one. It fails with the old worker.

Review:

- A change to what the worker takes as the page for a request is a trust-boundary change: it needs this ADR's tests to keep failing for it.

## References

- [ADR 0009](0009-github-tokens-in-the-background-worker.md), [ADR 0008](0008-comment-through-platform-review-apis.md).
- [Security model](../architecture/security-model.md).
