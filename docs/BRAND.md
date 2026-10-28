# Pluma PDF brand

The primary icon is a sculpted white feather inside a luminous cobalt glass tile. The Community and repository cover uses a calm radial halo, from deep navy through cobalt and cyan to pale ice blue, with flat white typography. The earlier navy icon-and-type cover remains available as a legacy asset.

## Files

- `assets/brand/icon.png`: full-resolution source icon with transparent exterior.
- `assets/brand/icon-128.png`, `icon-256.png`, `icon-512.png`: delivery sizes exported from that source.
- `assets/brand/mark.svg`: simplified monochrome feather for contexts that require a small vector mark. It does not reproduce the glass rendering.
- `assets/brand/figma-cover.png`: 1920 × 1080 PNG for the Figma Community cover.
- `assets/brand/figma-cover.webp`: smaller web export used by the README.
- `assets/brand/cover.png`: earlier navy repository cover, preserved as a legacy asset.
- `assets/brand/cover.webp`: smaller web export of the earlier navy cover.
- `assets/brand/preview.png`: actual plugin screenshot using its built-in synthetic document.

The plugin header and settings sheet embed the 128 px icon locally during the build. The startup screen uses the 256 px asset at 96 CSS pixels for a sharp centered logo, with a small animated loading indicator. Startup waits for the initial pages and language preference, with bounded fallbacks and reduced-motion support; it does not wait for the optional engine. No remote brand images are requested. Run `node scripts/brand.mjs` to recreate the delivery sizes after intentionally replacing the source artwork.

## Production

The icon was generated using the built-in image generation tool, guided by the user's reference for blue, depth and frosted glass. The feather is original to Pluma PDF; the reference's flower, lightning bolt and attribution are not part of the result. The current cover was generated separately from a blue radial-gradient reference. Delivery exports resize the generated artwork; these are raster assets, not vector reconstructions. No client design imagery is included.

### Final icon prompt

```text
Use case: stylized-concept.
Asset type: final app icon for Pluma PDF, a local Figma PDF optimization tool.
Input images: Image 1 is a style reference only: use its powerful cobalt blue, sculpted volume, frosted translucent material and polished light. Image 2 is the existing flat feather brand: use the feather concept, but replace the flat execution completely.
Primary request: create one original premium macOS-style app icon: a bold white-to-icy-blue sculpted quill feather floating inside an electric cobalt blue rounded square. Make the feather the clear hero, large, diagonal lower-left to upper-right, elegant single central cut along its spine and very few broad sculptural surfaces. The icon should feel fast, light and powerful. Use smooth frosted glass with luminous edges, believable soft contact shadows and subtle layered depth, like a carefully art-directed product render. A soft blue inner halo may frame the feather, but do not add extra symbols.
Composition: square, straight-on, centered; the blue squircle occupies about 94% of the canvas with transparent exterior margins. The feather remains very legible at small size.
Palette: saturated cobalt and ultramarine blue, icy azure and white highlights. Avoid purple.
Constraints: transparent background outside the app tile, no surrounding poster, no text, no letters, no watermark, no reference branding. Do not copy the flower or lightning bolt from the reference. No flat generic vector look, no noisy details, no black exterior background.
```

### Earlier navy cover prompt

```text
Use case: ads-marketing.
Asset type: final GitHub repository cover for Pluma PDF, wide landscape 2:1 banner.
Input image: the final Pluma PDF app icon. Preserve the same recognizable white feather, blue glass tile, depth and materials. This icon is the brand asset to feature.
Primary request: create a beautifully art-directed premium software cover. Near-black midnight navy background, generous negative space, the supplied luminous cobalt blue frosted-glass feather app icon on the LEFT, rendered as a dimensional product with soft restrained blue light beneath it. The icon occupies roughly the left third, never cropped. On the RIGHT, large clear white modern sans-serif typography reads exactly "Pluma PDF". Directly below in smaller muted ice-blue typography, exactly "Lighter PDFs. Native detail." At the bottom of that same text column, a very small, carefully spaced line reads exactly "LOCAL · FREE · OPEN SOURCE". The composition is confident, quiet, sophisticated, with the icon providing the saturated blue energy. Keep all text well inside the margins and sharply legible.
Constraints: match the input icon closely; only the three specified text strings; no watermark, no reference branding, no UI mockup, no extra symbols, no badges, no buttons, no decorative charts. Wide landscape 2:1 composition.
```

## Plugin interface

Keep the panel vertical at 400 × 720. Use a pale neutral canvas, compact controls, and deep cobalt blue, related to the icon, for the rounded primary action and active choices. The document preview canvas is `#1E1E1E`. Show measured page sizes in one quiet white strip with thin separators after reading the original PDF. Keep empty metrics hidden and let the document preview use the available space. Preserve the actual PDF colors.

## Usage

Keep the icon square and preserve its alpha channel. Use a dark navy or neutral background when possible, with enough space to show its luminous edges. Keep the cover's proportions and readable margins. Use the monochrome SVG only where a simplified mark is appropriate.

### Interface palette

Interactive accents share `--blue` (`#174191`), with `#2052AB` hover and `#123371` pressed states. This remains recognizably blue while feeling deeper than bright cobalt. Primary buttons are rounded and 46 px tall with 13 px vertical padding. Secondary selections use neutral gray fills (`#F1F2F4`) and quiet gray borders (`#C7C9D2`), with dark blue text; avoid bright blue selection cards. The metric strip stays white with neutral separators and an accented reduction value, while the loaded PDF canvas is exactly `#1E1E1E`. All dialogs use a full-width bottom sheet with the Pluma icon centered above the title, a fade/translate entrance and a subtle exit. Respect reduced-motion preferences. These tokens affect interface chrome only, never the rendered PDF.

## Community cover

The cover uses one blue circular gradient on a white field, with generous margins and two flat white text lines in the dark center: “Pluma PDF” and “Lighter PDFs. Native detail.” Keep it circular; do not stretch it into an ellipse or add a rendered object, embossed type, badges or performance claims.

One built-in image_gen edit of the first blue-gradient direction produced the 1672 × 941 source. A uniform resize to 1440 × 810 followed by centered white padding prepared the 1920 × 1080 PNG, preserving the circle's proportions and creating ample white space. The original remains in the local production outputs. The WebP export is used in the README. No client content is present. These assets are prepared for upload; this repository does not publish the plugin on Figma Community.

The empty document preview follows the same color direction using one local CSS radial gradient on a white base. It expands eightfold over eight seconds, then breathes gently over a 30-second cycle. The circular artwork extends beyond the preview and is clipped by its bounds. Its cyan edge fades to transparency without a white ring or a separate blue background layer. Motion starts after the startup screen, stops when hidden and is disabled for reduced-motion preferences. Loaded PDF previews retain their neutral `#1E1E1E` background. Public interface screenshots use English and synthetic content. All dialogs share the logo and animated bottom-sheet presentation.

### Cover prompt

```text
Use case: precise-object-edit.
Asset type: one targeted refinement of the supplied Pluma PDF blue-gradient cover into a very airy minimalist editorial cover, landscape 16:9, intended 1920 x 1080 pixels.
Input image roles: Image 1 is the existing blue-gradient-v3 cover to edit. Image 2 is the authoritative guide for the circular radial color progression and calm centered feeling only. Do not copy its word or brackets.
Primary correction: the old gradient is MUCH TOO LARGE and oval/full-bleed. Replace it with ONE SMALL TRUE CIRCLE in the exact center of a very wide, clean WHITE canvas. Most of the cover must be blank white. The circular gradient must be isotropic: its width and height in actual pixels are equal. Do not stretch a circle into an ellipse to fit a landscape frame.
Geometry: on the intended 1920 x 1080 canvas, center the orb at x=960, y=540. Its entire soft halo diameter should be approximately 560–620 pixels, ideally 600 pixels, INCLUDING the pale outer fade. That is only about 31 percent of the canvas width and 56 percent of its height. Leave around 650 pixels or more of clean white margin to both left and right, and at least 200 pixels of white above and below. Keep the whole halo comfortably away from every edge. Preserve a perfectly round appearance, not a pill, horizontal oval, vertical oval, full-screen wash or cropped halo.
Background: true clean white #FFFFFF, especially across the huge outer margins and all four corners. No pale blue wash across the full canvas. Only the small central circle contains color. Its pale outer fade dissolves invisibly into white without any hard border.
Radial gradient palette, center outward: dark center #171839; inner navy #15275a; deep blue #144ea9; blue #1c6ccc; cobalt #3195e5; cyan #55bcf5; light cyan #88d8fc; pale blue #bbe9fd and #dcf2fe; then seamless pure white. Smooth soft transitions like the second reference, no distinct concentric outlines and no banding. The central dark navy area must be large enough to hold both text lines with excellent contrast. Very subtle fine grain is allowed only if nearly invisible; no coarse noise or simulated material.
Text (verbatim, exactly two lines):
"Pluma PDF"
"Lighter PDFs. Native detail."
Typography: keep both lines centered INSIDE the small orb, as a compact group around its center. Use a refined clean flat white contemporary sans serif. Main title tasteful medium weight, about 42–46 pixels tall at 1920 width, much smaller than the v3 title. Tagline plain regular weight, about 17–19 pixels, with comfortable line spacing. The full wording of both lines must fit inside the dark core, without spilling onto bright cyan or white. The tagline must not approach the edge of the circle. Exact spelling, capitalization and punctuation. Crisp white flat ink only: no extrusion, bevel, outline, chrome, gradient, emboss, glow, shadow, 3D or ornamental letterforms.
Overall feeling: a quiet white editorial page with a small blue orb, lots and lots of whitespace, deliberate proportion, calm human typography and no extraneous artwork. The restrained scale is essential.
Constraints: one circle, two text lines, otherwise blank white. No paper sculpture, feather, icon, tile, mockup, rendered object, diagrams, orbital lines, UI, badge, prices, metrics, extra words, watermark or reference branding. Do not enlarge the orb to fill the frame. Deliver one polished 16:9 cover.
```
