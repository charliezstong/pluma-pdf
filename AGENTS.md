# Instructions for working on Pluma PDF

This repository contains a Figma plugin and a local Node engine. Preserve the existing workflow and make small, verifiable changes. The user's current instructions and authorizations take precedence over this file.

## Current documentation with Context7

Consult Context7 MCP whenever a task concerns a library, framework, SDK, API, CLI tool, or cloud service: syntax, configuration, versions, migration, installation, or specific errors. Do so even if you think you know the answer; prefer Context7 over web search for library documentation.

1. Start with `resolve-library-id`, providing the library name and what you need to look up. Skip this step only when the user provides an exact `/org/project` ID or a version of that ID.
2. Choose the match by name, relevance, example coverage, reputation, and score. If the match is poor, rephrase the search. Respect the requested version and check the installed version in the lockfile.
3. Use `query-docs` with the selected ID and a specific question about one concept. Query independent concepts separately; combine them only when you need to understand their interaction.
4. Base the implementation and explanation on the retrieved documentation.

Context7 is not required for mechanical refactoring, scripts written from scratch, business logic, general code review, or programming concepts that do not depend on a library API.

## Product invariants

- **The Figma design remains intact.** Exporting or analyzing must not create clones or change fills, masks, visibility, opacity, hierarchies, positions, or dimensions. Do not use temporary document changes as an export step.
- **"Foco" is the only navigation exception.** An explicit request to focus a layer may change the selection and viewport. It must not edit the layer's content or discard the set of pages already reviewed. Do not focus during an active export.
- **"Inteligente" starts from the native PDF.** Optimize images inside the exported PDF; preserve text, fonts, and vector instructions. Do not rasterize an entire frame by default. The "Compacto" mode explicitly allows that tradeoff.
- **"Original" preserves the exported content.** Merging pages may change PDF serialization and references; it must not re-encode images or alter drawing instructions.
- **Before and after share the same capture.** Keep originals in memory and compare their variants. Do not present measurements from two different exports as a comparison of the same capture.
- **JPEG is lossy.** Do not promise pixel equality, print quality, or an absolute file size. Exact RGBA equality, a difference threshold, and visual assessment are distinct results.
- **"Diagnóstico" does not remove layers.** Distinguish possible overlaps from verified geometric coverage. Matching images or positions do not establish visual redundancy.

## PDF, images, and transparency

- Preserve ICC profiles and interpretation parameters. If you cannot establish compatibility, leave that resource intact.
- Do not guess `/Decode`, Flate predictors, `ColorTransform`, CMYK/Indexed color spaces, `/Matte`, or complex masks.
- Resample color and alpha together to avoid halos. Store the resulting alpha losslessly. Never modify a shared mask: create a separate reference for the variant and remove the old one only when nothing references it.
- Remove an opaque mask only after verifying that all its samples are 255. Having an alpha channel does not imply actual transparency.
- Deduplicate by encoded bytes and equivalent dictionaries, including masks and profiles. The final `/pdf/deduplicate` pass must not decode or recompress images.
- A shared image must cover its largest use throughout the document. When merging aliases, an unknown use forces the global limit. Ambiguous groups or patterns retain that conservative behavior.
- Preserve byte, pixel, concurrency, and time limits. Do not upscale small images. Return the original when the complete result is not smaller.

## Interface and protocol

The accepted interface is vertical, **460 × 800**. Use a white or very light gray canvas with blue and graphite widget cards. Preserve the actual PDF colors in the comparison. Check the actual plugin width, scrolling, long text, and the complete list; a screenshot of the wide demo does not replace that check. Prevent the minimum content size of grids or flex items from expanding the panel horizontally.

Preserve the `jobId` protocol, sequential page delivery, and ACKs. A stale response, settings change, or cancellation must not publish an outdated result. Respect the cache limit and release blob URLs, canvases, and PDF.js tasks.

Do not introduce requests to CDNs or optimization services. The PDF.js worker is included in the bundle. User bytes must only travel to the localhost engine when the selected mode requires it.

## Structure and development

- `src/plugin.ts`: Figma API, scope, canvas order, export, cancellation, diagnostics, and focus.
- `src/ui.*`: interface, cache, variants, merging, and download.
- `src/geometry.ts`, `occlusion.ts`, `pdf-preview.ts`, `visual-diff.ts`: geometry, diagnostics, and comparison.
- `engine/`: loopback HTTP, Sharp, PDF optimization, placement, and deduplication.
- `tests/`: synthetic fixtures and tests for the limits above.
- `scripts/build.mjs` generates `dist/code.js` and `dist/ui.html`. `dist/` is ignored by Git and is absent from source checkouts and GitHub's automatic source archives. The installable release ZIP includes these prebuilt bundles. Do not edit generated outputs by hand or commit them.
- `scripts/preview.mjs` provides the local demo; it does not control a real Figma document.
- `scripts/macos/{install,start-engine,preview}.command` and `scripts/windows/{install,start-engine,preview}.cmd` are the platform launchers. They use `scripts/local.mjs` for installation, engine startup, and the demo.

Use a Node version compatible with `package.json` and use `npm ci` to respect the lockfile. The installer prepares the bundles, including when `dist/` is missing from a source download; complete installation before importing the manifest into Figma. Do not restructure the project for a localized fix. Do not rebuild or reload the UI during an active export; coordinate that work or use an isolated copy.

## Verification

For complete local validation, run `npm run check`: typecheck, build, and tests. Do not add a GitHub Actions workflow; validation is run locally. Controller tests verify the bundle that Figma imports, so the build must match the source code. During focused work, you can compile the controller in memory with `PLUMA_TEST_CONTROLLER_SOURCE=1`.

Public tests must generate their own synthetic PDFs and pixels. The 55-frame regression uses an artificial grid, reversed names, and a layer order that differs from the visual order. Keep it independent of client documents.

`PLUMA_PDF_FIXTURE` enables an optional private test. Its file is supplied outside the repository; never copy it into the publishable tree. Report passed, failed, and skipped tests separately: a skipped private test is not a passed test.

For optimization changes, validate content and rendering: pages, text, operators, fonts, image references, ICC, and alpha. Numeric references may change after `copyPages`; compare their semantic content. Also inspect regions with detail and transparency, beyond the average of an almost white page.

## Privacy and publication

Publishing this software does not authorize publishing the documents used during its development. Do not include client PDFs, screenshots, renders, extracted photos, private project names, private Figma file or layer IDs, coordinates from a real canvas, private document hashes, personal paths, credentials, `.env` files, or reports containing them.

`work/`, installed dependencies, caches, logs, and private validation results remain local. Preserve the user's reports without deleting them: exclude them from the public snapshot or archive them locally. If you need a public sample, create it with synthetic data and document its origin.

Before creating a public commit, tag, or release artifact:

1. Review the complete list of files to be published, including hidden files and ZIP contents. Do not rely solely on `.gitignore`.
2. Check the invariants and run the appropriate validation; `npm run check` must pass for a release.
3. Generate bundles from that same revision, check manifest targets, and include the prebuilt `dist/` files and required third-party notices and licenses in the installable release ZIP. Keep generated bundles out of Git. Keep the version in `package.json`, the lockfile, `/health`, and the release artifact synchronized: the launchers verify that identity.
4. Verify that tests, documentation, screenshots, and generated outputs contain no private data. Do not attribute private metrics to a synthetic example.
5. Publish within the authorized scope. Publishing on GitHub does not authorize publishing on Figma Community or uploading design material.

Code changes, public samples, and private validation reports are distinct artifacts. Keep them separate without modifying the user's document.
