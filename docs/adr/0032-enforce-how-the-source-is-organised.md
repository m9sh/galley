---
status: Accepted
date: 2026-10-14
deciders: [m9sh]
rfcs: []
tags: [process, structure]
---

# ADR 0032: Enforce how the source is organised, with Biome rules and a structure check

## Context

Galley's source grew to about 300 files, and its organisation was kept by convention. A review of the repository found the usual drift:

- three files over 1,000 lines, and a 6,917-line stylesheet;
- exports that nothing outside their own file used, and functions that only tests called;
- the background worker importing from the interface folders;
- an import of `@babel/types` that package.json did not declare;
- images in `docs/` that no document linked to.

None of it was caught by a check. [ADR 0015](0015-vitest-biome-and-pre-push-checks.md) runs Biome and the tests, and [ADR 0017](0017-full-coverage-of-every-file.md) keeps coverage at 100%, but nothing stopped the structure from drifting.

## Decision

Organisation is enforced by two things that run with `npm run lint`, so also in `npm run check`, the pre-push hook and CI.

### Biome rules (`biome.jsonc`)

- `noImportCycles`: a module cannot import itself back through others.
- `useFilenamingConvention`: files are named in kebab-case.
- `noBarrelFile`, `noReExportAll` and `noExportedImports`: import from the module that defines a thing, not from one that passes it along.
- `noUndeclaredDependencies`: what the code imports is declared in package.json.

### The structure check (`scripts/structure.mjs`)

It checks what Biome cannot see across files and folders:

1. **Layers.** A folder imports only from the folders its layer allows (the `LAYERS` table). Core logic knows nothing of the page or the platforms. Platforms know core. The interface knows both. The entry points (content, popup, options, background) assemble them. Imports that only name types are not checked, because they are erased at build time.
2. **Size.** A source or stylesheet file stays under 800 lines. A file already over the limit is listed in `scripts/structure-baseline.json` with its limit. It may not grow, and its limit only goes down: a file that shrinks by 100 lines or more must have its limit lowered (`npm run structure -- --update`).
3. **Exports.** Something is exported only if another file uses it. Tests, test helpers and the demo count as users.
4. **Folders.** A folder holds at most 30 source files. More wants a subfolder.
5. **Tests.** Every `src` folder with tests is a Vitest project, or its tests would never run.
6. **Styles.** A stylesheet that code imports exists. The `*.css` wildcard type hides a missing file from the compiler.
7. **Root.** The repository root holds only what the `ROOT` list names. Only tracked files count, so a scratch file in a working copy never blocks a push.

`docs:check` already fails on an image in `docs/` that no document links to.

## Consequences

- **Good:** drift fails a check the day it happens, with a message that says what to do.
- **Good:** the large files that exist today cannot grow, and their limits ratchet down as they are split.
- **Costs:** a new top-level folder, a new root file or a deliberately large file needs a line in `scripts/structure.mjs` or the baseline. That is the point: it becomes a decision.
- **Costs:** the unused-export check matches names, not symbols. A name that is also used elsewhere for something else hides an unused export. It never reports a used one.
- **Follow-up:** the baseline started with six files over the limit: `review/reader.ts`, `library/repo-reader.ts`, `library/map-view.ts`, `library/repo.css` and the demo's two project-map files. They are now split, the baseline is empty, and it stays as the place to record a deliberate exception.
- **Costs:** the three large classes are split as chains of abstract layers, with their members `protected` rather than `private`. That keeps every method body and field initialisation unchanged, but it is a layout, not a decoupling. Turning layers into separate objects is a later refactor that this check does not require.

## Alternatives considered

- **dependency-cruiser, knip or an ESLint boundaries plugin:** more capable, but each is a new dependency to vet for licence and upkeep, and the rules here are a few hundred lines of plain script with tests.
- **Convention and review only:** what the repository did until now.
- **Biome alone:** it has no cross-folder layering, size ratchet or unused-export rule.

## Enforcement

- `scripts/structure.test.mjs` gives each rule a deliberate violation and checks the message, and runs the whole check on a temporary repository.
- `npm run structure` is part of `npm run lint`, the "Structure" step in CI, and the pre-push hook.

## References

- The review that led to it is described in [pull request 82](https://github.com/m9sh/galley/pull/82).
