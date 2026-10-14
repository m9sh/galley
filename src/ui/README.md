# UI modules

Galley's two reader shells compose shared controls and rendering. Tests stay beside the module they exercise, including each shell's interaction tests.

| Directory | Responsibility | Start here |
| --- | --- | --- |
| `review/` | The review reader, chapters, Viewed, reading positions and moved-line presentation | [reader.ts](review/reader.ts) |
| `library/` | The Project library, standalone session chapters, map and notes views, saved notes and configuration reads | [repo-reader.ts](library/repo-reader.ts) |
| `rendering/` | Sanitised Markdown and code, diagrams, images, source comments, test plans and document interaction | [render.ts](rendering/render.ts), [reading.ts](rendering/reading.ts) |
| `sandbox/` | Opaque frame transport and bundled parsers/renderers; the isolated image fallback | [sandbox.ts](sandbox/sandbox.ts), [sandbox-frame.ts](sandbox/sandbox-frame.ts) |
| `components/` | Shared controls, layout picker, chapter context and attachment form, settings sheet, icons, fonts and the common stylesheet (`styles/`, joined by `reader-styles.ts`) | [dom.ts](components/dom.ts), [layout-controls.ts](components/layout-controls.ts), [chapter-context.ts](components/chapter-context.ts), [chapter-attachment.ts](components/chapter-attachment.ts), [reader-styles.ts](components/reader-styles.ts) |
| `preferences/` | Shared settings, persistence and application | [settings.ts](preferences/settings.ts) |
| `opening/` | The optional floating page launcher | [launcher.ts](opening/launcher.ts) |

The shells compose these modules; shared components do not import the shells. Rendering clients use the sandbox transport and validate engine replies. Sandbox scripts cannot import token storage or the background worker; the build enforces that boundary.

Frame HTML and script sources live together in `sandbox/`. Builds still package them at the extension and demo bundle root (`diagram-frame.html`, `image-frame.html`, etc.), matching the manifest and runtime URLs. Source organisation does not change those public paths.

`npm run check` discovers tests recursively under `src/ui`; `npx vitest run --project ui` runs this layer. [Architecture](../../docs/architecture/README.md), [UI map](../../docs/design/ui-map.md) and [security model](../../docs/architecture/security-model.md) explain the wider boundaries and surfaces.
