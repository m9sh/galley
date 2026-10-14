---
status: Accepted
created: 2026-10-12
authors: [m9sh]
discussion: https://github.com/m9sh/galley/issues/74
theme: Read the project
phase: Follow-up to the project library ([RFC 0049](0049-repository-docs-and-project-maps.md)); a privacy change in its later steps
progress: Step 1 (documents and readings kept by content hash across a refresh), the opt-in on-device outline index (step 3, in extension storage, with the settings switch, Forget control, expiry, size bounds, private windows and forgetting with a site's token) and GitHub conditional refresh (the listing is immutable at a commit, so it needs none) are implemented in this pull request; step 2 (a worker session cache) and batched GraphQL reads are not built, and rate-limit use on a large repository is still to be measured
adrs: [31]
---

# RFC 0074: Read each document once: caching repository reads by commit and blob

## Problem

Galley reads repositories again every time. Each visit to the project library lists the repository (GitHub `git/trees`, GitLab `repository/tree`) and reads every document it needs: from `/raw/<commit>/<path>` on GitHub, from the files API on GitLab. Building the map reads up to 150 documents per pass, four at a time. **Refresh** to a newer commit throws everything away, so documents that did not change are read again. Opening the library from a review, from another tab or the next day starts from nothing.

On large repositories, and without a token (GitHub allows 60 API requests an hour), this is slow and spends the reader's rate limit. It also asks more of GitHub and GitLab than it needs to.

What is spent where (found while building it): on GitHub the documents are read from the site's own `/raw/` addresses and cost no API quota. The quota goes on finding the commit and listing the tree, and on each **Refresh**. The saving from reading less is time and load on the platform; the saving in quota comes from asking GitHub whether a refresh has anything new.

## What makes this safe to cache

Content at a commit never changes. Both platforms' listings give each file's **blob hash**, so a document can be keyed by its content. A cache keyed that way is never stale; it only needs bounds: size, lifetime and a way to clear it.

## Proposal, in steps

1. **Read each blob once per visit (no new storage).** Key the library's in-memory cache by blob hash instead of path and commit, and keep it across **Refresh**: after a refresh, only documents whose blob changed are read. Keep the derived index (title, headings, links, type) per blob too, so the map rebuilds without parsing again.
2. **Share reads across tabs and reopenings, in memory only (needs an ADR).** The background worker keeps documents and their indexes in `chrome.storage.session`, keyed by site and blob hash. It is held in memory, never written to disk, and cleared when the browser closes or the site's token is removed. Reopening the library, or switching between a review and its library, reuses what was read.
3. **Keep the index on this device, opt in (needs an ADR and PRIVACY.md).** A bounded cache in the extension, off by default, with an expiry (for example 7 days), a size limit with least-recently-used eviction, a **Forget cached documents** control, and nothing kept from private windows. It should hold only the derived index (titles, headings, links), not full text: enough for an instant map, while reading still fetches the document.

Independently of caching, fewer requests:

- **Conditional requests.** GitHub documents that a conditional request answered `304 Not Modified` does not count against the primary rate limit. Use `ETag` / `If-None-Match` for the listing and for **Refresh**.
- **Batched reads with a token.** GitHub's GraphQL API can return many blobs in one query, instead of one request per document.

## Proposed acceptance criteria

- [x] After **Refresh** to a newer commit, only documents whose blob changed are read again (step 1).
- [x] The map rebuilds from cached indexes without parsing unchanged documents again (step 1).
- [ ] Reopening the library in the same browser session reads no document it has already read (step 2). With **Remember project outlines on this device** on, the map of a project read again reads none of the documents whose hash is unchanged; the document being opened is still read, and with the switch off a reopened library starts from nothing.
- [x] Nothing from a repository is written to disk unless the reader turns it on (steps 1–2), and step 3 is off by default.
- [x] Every cache is bounded in size and lifetime, says what it holds, and can be cleared from the popup or settings. The memory cache is bounded in size and lasts while the reader is open; the on-device outlines are bounded in size, last 7 days from last use, are described in Galley settings and are cleared there.
- [x] Removing a site's token clears what was cached for that site.
- [x] Private windows never persist anything.
- [x] PRIVACY.md and the storage inventory describe exactly what is kept, where and for how long, before step 2 or 3 ships.
- [ ] Rate-limit use is measured before and after on a large repository, with and without a token.

## Privacy and architecture decisions

The storage inventory (`docs/architecture/storage.md`) and PRIVACY.md promise that **repository content is never stored**, under [ADR 0019](../adr/0019-review-progress-as-fingerprints.md). Step 1 keeps that promise. Steps 2 and 3 change it and need a superseding or extending ADR: what is kept (text or only indexes), where (memory-only session storage or disk), for how long, and how it is cleared. Private repositories make this matter: anything written to disk is readable by anyone with access to the browser profile.

[ADR 0031](../adr/0031-read-each-document-once.md) records the decision: documents and readings by hash in memory while the reader is open; document outlines (never text) in extension storage only when the reader turns it on.

The worker boundary from [ADR 0009](../adr/0009-github-tokens-in-the-background-worker.md) is unchanged: tokens stay in the worker. A shared cache in the worker must never let one site's content reach another site's page.

## Alternatives and tradeoffs

- **Do nothing:** simple, but large repositories stay slow and spend the reader's rate limit.
- **Cache full text on disk by default:** fastest, but stores private repository content without the reader choosing it.
- **Cache by path and commit instead of blob hash:** simpler keys, but every refresh reads unchanged documents again.

## Open questions

- **Product, blocking:** is a memory-only session cache (step 2) enough, or do readers need the on-device index (step 3)? Answered by the maintainer on 2026-10-13: local storage is fine. The on-device index is built in extension storage, off by default; the worker's session cache is not built.
- **Engineering, not blocking:** what size and lifetime limits fit large documentation repositories? Started at 7 days, 1,000,000 stored characters for a project and 4,000,000 in all; revisit with real repositories.
- **Product, not blocking:** should the review reader share the same cache for files a review changes?
- **Product, not blocking:** should the setting start on? It starts off, as proposed; making it a default is a separate decision.
- **Engineering, not blocking:** GraphQL batching adds a request to the token allowlist, and costs API quota that same-origin raw reads do not. It is not built; is it worth it for requests saved rather than quota?

## Validation

Compare time to an interactive map and platform requests on a large documentation repository, first visit and second, with and without the setting and a token. Research sessions only; Galley has no telemetry.

## Sequencing

Builds on the project library ([RFC 0049](0049-repository-docs-and-project-maps.md)). Step 1 and the conditional refresh need no decision; the on-device index follows [ADR 0031](../adr/0031-read-each-document-once.md). Step 2 and batching can follow if measurements call for them.

## Related RFCs

- [RFC 0049](0049-repository-docs-and-project-maps.md) — the project library and map that read these documents.
