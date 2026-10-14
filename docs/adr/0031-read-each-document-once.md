---
status: Accepted
date: 2026-10-13
deciders: [m9sh]
rfcs: [74]
tags: [privacy, storage, repository]
---

# ADR 0031: Read each document once, by its content hash, and remember document outlines on the device only when the reader allows it

## Context

The project library lists a repository and reads the documents it needs again on every visit: up to 150 per pass for the map, four at a time, and all of them again after **Refresh** to a newer commit ([RFC 0074](../rfcs/0074-read-each-document-once.md)). Content at a commit never changes, and both platforms' listings give each file's content hash (GitHub's `sha`, GitLab's `id`), so a document can be recognised wherever it appears.

The cost is mostly time and load on the platform. On GitHub the documents are read from the site's own `/raw/` addresses and cost no API quota ([ADR 0024](0024-read-a-repository-at-one-commit.md)); the API is spent on finding the commit and listing the tree ([ADR 0025](0025-repository-reads-in-the-token-allowlist.md)).

Until now the storage inventory promised that repository content is never stored ([ADR 0019](0019-review-progress-as-fingerprints.md)), with one exception the reader chooses: the paths and headings a saved note is about ([ADR 0028](0028-private-project-notes.md)). The RFC asked whether a memory-only cache is enough or whether readers need an on-device one. The maintainer answered on 2026-10-13 that extension local storage is fine.

## Decision

- **In memory, always.** The repository reader keeps the text of each document it reads by the hash of its content (`BlobCache`, `src/core/blob-cache.ts`), and what the map learned from it (title, kind, headings, links) by hash and path. They survive **Refresh**: at a newer commit only documents with a new hash are read. At most 16,000,000 characters are kept, the document read longest ago going first, and all of it is let go when the reader closes. Nothing is stored. Repositories whose listing gives no hash are read as before.
- **On the device, only when the reader turns it on.** **Remember project outlines on this device** (Galley settings → Remembering projects; `rememberOutlines`, **off by default**) keeps, for each document the map read, its path, content hash, title, kind, status, front matter fields, headings, links (text, address, line, section) and anchors. **Never the text of a document.** A project read again takes these from the device for every document whose hash is unchanged, and reads only the others (`src/ui/library/outline-cache.ts`).
- **Where and how.** `chrome.storage.local` (the demo uses `localStorage`): a small directory `galley:outlines` (for each project a fingerprint, when it was last used, how much it holds and the site's origin) and one record `galley:outlines:<sha256 of the repository id>` per project, like notes ([ADR 0028](0028-private-project-notes.md)). The content script reads and writes them itself; no message to the worker is added and no token is involved. The storage, lifetime and forgetting live in `src/ui/library/outline-store.ts`, which holds no document parsing, so the popup, the settings page and the worker use it without loading the Markdown parser; the readings are in `outline-cache.ts`.
- **Bounds.** A project keeps at most 1,000,000 stored characters, everything kept at most 4,000,000 (the browser allows an extension 10 MB in all); a project not used for **7 days** is forgotten, then the least recently used go until the rest fit. Expired projects are ignored when read, removed whenever anything is saved, and removed when the browser starts or Galley is updated (`pruneOutlines`, from the background worker), so a project that is never read again does not stay on the device. Writes happen after a map pass, one at a time, and a store that is full or unavailable is ignored: the documents are read as without it.
- **Versioned, and trusted only when checked.** A record carries `OUTLINE_FORMAT` (`src/core/docindex.ts`, the shape of a reading; a test fails when what a reading holds changes, as the reminder to raise it) and the version of Galley that wrote it. A record from another format or another Galley version is ignored, and replaced the next time that project is saved, so an update that reads documents differently never meets old readings. Each reading has every field checked (`restoreDoc`), and a reading is used only for a document whose hash the listing still gives for that path. The in-memory cache needs no version: it holds text by content hash, and lives for one reader.
- **Private windows** read and keep nothing (`chrome.extension.inIncognitoContext`).
- **Clearing.** **Forget remembered outlines** in Galley settings removes everything; turning the setting off does the same; removing a site's token in the popup removes what was kept for that site's projects. The settings page says how many projects are remembered and how much they hold. Uninstalling removes it all.
- **GitHub refresh asks first.** **Refresh** sends the `ETag` of GitHub's earlier answer as `If-None-Match` for the first ref it tried; "not modified" returns the same snapshot, and GitHub does not count that request against the hourly limit. The worker passes a well-formed ETag on a read and returns the ETag header; the allowlist ([ADR 0009](0009-github-tokens-in-the-background-worker.md)) is unchanged.
- **Not decided here.** Full text on disk, a session-storage cache in the worker shared between tabs, and batching reads with GitHub's GraphQL API. The first stays out by the RFC's design; the others are not needed for what was decided and are left to the RFC.

## Consequences

- **Good:** a refresh reads only what changed; a project read again can open its map without reading its documents; a refresh that finds nothing new costs none of the hourly quota; the reader decides whether anything persists.
- **Costs:** with the setting on, the titles, headings, link text and front matter of a project's documents, and their paths, are readable by anyone with access to the browser profile, which matters for private repositories. [PRIVACY.md](../../PRIVACY.md) and the [storage inventory](../architecture/storage.md) say so.
- **Costs:** documents taken from the device are not read, so the architecture and infrastructure views' "named in" suggestions, which search the text of documents read in the visit, find fewer; opening a document, or reading it for the map when its content changed, adds it.
- **Costs:** the inventory's "never stored" line now has this exception; a new field kept in a reading is a privacy change, and raises `OUTLINE_FORMAT`.
- **Costs:** every Galley update starts the remembered outlines over, so a project is read in full once after each release.
- **Follow-up:** measure API use before and after on a large repository, with and without a token (an acceptance criterion of the RFC); decide whether the review reader should share the cache for the files a review changes.

## Alternatives considered

- **Cache full text on disk by default:** fastest, but stores private repository content without the reader choosing it, and does not fit the 10 MB extension quota.
- **Session storage in the worker, shared between tabs (RFC step 2):** memory-only and cleared when the browser closes, but it needs new messages and a boundary that keeps one site's content from another site's page. With on-device outlines chosen it adds little.
- **IndexedDB for the outlines:** more room, but a second storage mechanism for something `chrome.storage.local` holds in a few megabytes.
- **Key by path and commit:** simpler keys, but every refresh reads unchanged documents again.

## Enforcement

- `src/core/blob-cache.test.ts` (hash-keyed text, bound, derived readings by hash and path), `src/ui/library/repo-cache.test.ts` (a refresh reads only changed documents, nothing is stored unless turned on, a project read again, a partial pass, private windows, unreadable documents), `src/ui/library/outline-cache.test.ts` (fingerprinted keys, no text, lifetime, bounds, eviction, damaged records, private windows, forgetting), `src/core/docindex.test.ts` (readings checked field by field, the `OUTLINE_FORMAT` guard), `src/options/options.test.ts` and `src/popup/popup.test.ts` (switch, forget, token removal).
- `src/platforms/github-repo.test.ts`, `github-api.test.ts` and `src/background/worker.test.ts` (conditional refresh).
- [PRIVACY.md](../../PRIVACY.md) and the [storage inventory](../architecture/storage.md) must list the keys; reviewers treat a new key or field as a privacy change.

## References

- [RFC 0074](../rfcs/0074-read-each-document-once.md), [issue 74](https://github.com/m9sh/galley/issues/74).
- GitHub: [conditional requests](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests) do not count against the primary rate limit when they return `304 Not Modified`.
