---
name: decision-records
description: Write, update and use Galley's architecture decision records (docs/adr) and RFCs (docs/rfcs). Use when a change makes or reverses an architectural decision, adds a dependency, permission, storage key, network request or trust boundary, contradicts an existing ADR, implements or touches an open RFC, when asked to write an ADR or RFC, or when asked why something is built the way it is.
---

# Decision records and proposals

Process docs: [ADRs](../../../docs/adr/README.md) and [RFCs](../../../docs/rfcs/README.md). Why this exists: [ADR 0001](../../../docs/adr/0001-record-decisions-and-proposals.md).

## Answering "why is it like this?"

Search `docs/adr/` (the README has an index by area) and cite the ADR. If no ADR covers it, check `git log -S '<identifier>'` and pull request descriptions, and say so plainly rather than guessing; offer to backfill an ADR.

## Does this change need one?

| Change | Record |
| --- | --- |
| Follows an existing decision | None; cite the ADR in the pull request if useful |
| New runtime dependency, permission, host, storage key, network request, or trust boundary | **ADR** |
| A rule contributors must follow (process, token contract, coverage) | **ADR** |
| Contradicts or narrows an accepted ADR | **New ADR that supersedes it**; never edit the old one's decision |
| New surface, workflow, stored user data, multi-PR feature, or needs research with reviewers | **RFC** first |
| Implements an RFC, in part or in full | **The same pull request updates the RFC file** (below), and says `Refs #NN`, or `Closes #NN` when it meets the acceptance criteria |

## Writing an ADR

1. Copy `docs/adr/template.md` to `docs/adr/NNNN-short-title.md` (next free number, lower-case kebab-case).
2. Front matter: `status` (Proposed while in review, Accepted when merged), `date`, `deciders`, `rfcs: [..]`, and `supersedes`/`superseded-by` when replacing. Values are plain YAML: no ` #` inside a value.
3. Heading: `# ADR NNNN: The decision, stated plainly`.
4. Sections: Context (facts, with links), Decision (present tense, name the files), Consequences (good, costs, follow-up), Alternatives considered, **Enforcement** (the test, lint rule, build step or review step that fails if it is broken), References (commits, pull requests).
5. If it supersedes ADR X, set X's `status: Superseded` and `superseded-by: NNNN`.

## Writing or importing an RFC

1. The discussion lives in a GitHub issue titled `RFC: …`; its number is the RFC number.
2. Copy `docs/rfcs/template.md` to `docs/rfcs/NNNN-short-title.md`; front matter `status`, `created`, `authors`, `discussion` (the issue URL), `theme`, `adrs: [..]`.
3. Keep the house shape: Problem, Proposal, Proposed acceptance criteria, Privacy and data decisions, Alternatives and tradeoffs, Open questions (tagged Product / Design / Engineering, blocking or not), Validation (research sessions, never telemetry), Sequencing, Related RFCs.
4. Benefits are hypotheses; the reviewer stays in control; failure, keyboard, mobile and coverage are in the acceptance criteria.
5. When importing an issue, keep its text; move its bold header lines into front matter and turn `#NN` references into links.

## Linking and indexing

- An ADR's `rfcs:` and each listed RFC's `adrs:` must name each other. So must `supersedes:` and `superseded-by:`.
- Run `npm run docs:index` to regenerate both index tables, then `npm run docs:check`. The check fails on one-way links, unknown statuses, bad dates, stale indexes and broken relative links or anchors anywhere in the repository's Markdown.
- Update the "By area" table in `docs/adr/README.md` by hand when adding an ADR.

## When a pull request implements an RFC

The RFC file is part of the pull request that does the work, never a separate follow-up. Before the pull request is ready:

- **Part of the work:** update `progress:` with what this pull request does and what stays open, add the pull request to `implemented-in:`, and say `Refs #NN`.
- **The work that meets the acceptance criteria:** set `status: Implemented`; tick the criteria and say which pull request met them; list every pull request in `implemented-in:`, this one included (its URL exists once `gh pr create` has run: commit the RFC change then and push it to the same branch); drop `progress:`, or keep only what stays open outside the criteria, such as validation sessions; say `Closes #NN`.
- **Settled questions:** record each answer the maintainer gave under its open question, dated, in the same pull request.
- **A Proposed RFC** is accepted by the pull request that implements it: the diff sets `Accepted` or `Implemented`, the description says so in its first lines, and the maintainer's merge is the decision. If the maintainer has not agreed in the conversation, ask before setting the status.
- Run `npm run docs:index` and `npm run docs:check`; the check refuses `Implemented` without `implemented-in:` links.

## Changing an RFC's status otherwise

Only the maintainer declines, postpones or withdraws an RFC, and swaps the issue's `rfc:` label to match (`rfc: accepted` stays on an implemented RFC; its issue closes when the pull request merges).
