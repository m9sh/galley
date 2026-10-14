---
paths:
  - "docs/**"
  - "*.md"
  - "store/*.md"
  - ".claude/skills/**"
---

# Documentation

- Words follow `docs/COPY.md`: plain, specific, the reader's real labels, no unbacked claims.
- **Readability is a must.** Text is well organised and split into short, readable paragraphs: one idea each, the point first, a blank line between them, and headings and lists instead of long blocks. Rewrite any wall of text before you finish. The rules are in [Readable documents](../../docs/COPY.md#readable-documents).
- ADRs and RFCs: load the `decision-records` skill. Front matter is plain YAML (no ` #` inside a value); ADR `rfcs:` and RFC `adrs:` must name each other.
- After adding or editing a record, run `npm run docs:index`, then `npm run docs:check` (it also checks every relative link and heading anchor).
- Never edit `CHANGELOG.md` or the generated index tables by hand.
