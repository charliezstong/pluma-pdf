# Contributing to Pluma PDF

Small fixes, reproducible bug reports and focused improvements are welcome. Describe the behavior you want to change and how you checked it.

## Local development

Use Node.js 24 and the npm version bundled with it. Run these commands from the repository root:

```sh
npm ci
npm run check
```

`npm ci` installs the versions in `package-lock.json`. Keep optional dependencies enabled: Sharp installs native packages for each operating system. When intentionally changing dependencies, commit both `package.json` and `package-lock.json`.

`npm run check` runs TypeScript checks, builds the Figma plugin, then runs the tests. Build before running `npm test` by itself: the controller suite normally tests the generated `dist/code.js` that Figma imports.

To exercise the local PDF engine, run:

```sh
npm run engine
```

For the browser demo, run `npm run preview` in another terminal after building. The demo helps test controls and previews; importing the repository's `manifest.json` in Figma Desktop is still necessary to check real exports and plugin messaging. Keep the engine running when testing Intelligent mode.

For a fresh local installation, use the launcher for your operating system:

| Platform | Install | Start engine | Preview demo |
| --- | --- | --- | --- |
| macOS | `scripts/macos/install.command` | `scripts/macos/start-engine.command` | `scripts/macos/preview.command` |
| Windows | `scripts/windows/install.cmd` | `scripts/windows/start-engine.cmd` | `scripts/windows/preview.cmd` |

These launchers require Node.js 24. Figma Desktop is required for the plugin itself. See [INSTALL.md](INSTALL.md) for the installation steps.

## Repository layout and language

- `src/`: Figma controller, plugin interface and browser-side PDF rendering.
- `engine/`: local image and PDF processing.
- `scripts/`: build, packaging and local development tooling. The build entry point is `scripts/build.mjs`; the browser demo entry point is `scripts/preview.mjs`.
- `scripts/macos/` and `scripts/windows/`: platform-specific launchers.
- `tests/`: automated tests with generated fixtures.
- `docs/`: public installation, architecture, branding and contribution guides.

Keep public documentation, release notes and tooling messages in English. The plugin interface supports English, Spanish and Portuguese. Keep catalog keys and interpolation tokens aligned, provide all three translations, and preserve English fallback and regional language detection. Keep document names and diagnostic evidence unchanged when switching the interface language. Changes to repository organization should preserve the interface and PDF optimization behavior unless the pull request explicitly changes them.

## Test data and privacy

Use synthetic PDFs, images and Figma node objects for automated tests. Include a small generated reproduction when reporting an issue. Never commit private design files, exported client PDFs, screenshots, image assets, Figma file keys or node coordinates copied from a private document. Do not attach confidential files to public issues or releases.

The optional `PLUMA_PDF_FIXTURE` integration check accepts a PDF path on your own machine. Leave it unset for normal development; private fixtures stay outside the repository and are not needed for the public test suite. Do not publish its logs if they reveal confidential information.

Commit only content you have the right to distribute. Preserve dependency licenses and attribution when adding or redistributing code, fonts or artwork. A source code license does not grant rights to someone else's design assets.

## Behavior to preserve

- Exporting and optimization must leave the source Figma document unchanged.
- Keep native text and vectors in Intelligent mode. Handle masks, transparency, image placement and shared resources conservatively.
- Report measured sizes and savings. If processing fails or produces a larger file, show the actual result rather than claiming a successful reduction.
- Cancellation and reanalysis must not let an older operation overwrite a newer result.
- Pixel comparisons describe the rendered images and resolution tested; they do not establish equivalence at every zoom level or certify a PDF's semantics.

Add a focused regression test when changing behavior that could lose visible content, modify the document or mix export jobs. Tests must run without Figma credentials, paid services or private fixtures.

## Pull requests

Explain the trigger, the resulting behavior and the checks you ran. For interface changes, include a screenshot made with synthetic content. For PDF changes, describe the synthetic case and verify text, vectors, image placement and transparency as appropriate.

Run `npm run check` locally with Node.js 24 before opening a pull request. When changing platform-specific behavior, also check it on the affected operating system. Local checks exercise the JavaScript and native image dependencies; they do not replace a manual run inside Figma Desktop. Mention any platform or Figma behavior you could not verify.
