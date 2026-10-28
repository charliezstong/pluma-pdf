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

For the browser demo, run `npm run preview` in another terminal after building. The demo helps test controls and previews; importing `manifest.json` in Figma Desktop is still necessary to check real exports and plugin messaging.

## Test data and privacy

Use synthetic PDFs, images and Figma node objects for automated tests. Include a small generated reproduction when reporting an issue. Never commit private design files, exported client PDFs, screenshots, image assets, Figma file keys or node coordinates copied from a private document. Do not attach confidential files to public issues or releases.

The optional `PLUMA_PDF_FIXTURE` integration check accepts a PDF path on your own machine. Leave it unset for normal development and CI; private fixtures stay outside the repository and are not needed for the public test suite. Do not publish its logs if they reveal confidential information.

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

CI installs locked dependencies, typechecks, builds and runs the tests on Ubuntu, Windows and macOS with Node.js 24. These checks exercise the JavaScript and native image dependencies; they do not replace a manual run inside Figma Desktop. Mention any platform or Figma behavior you could not verify.
