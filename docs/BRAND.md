# Pluma PDF brand

The primary icon is a sculpted white feather inside a luminous cobalt glass tile. The artistic Community and repository cover uses a sculptural paper feather, monochrome grain and cobalt folds on a pale background. The earlier navy icon-and-type cover remains available as a legacy asset.

## Files

- `assets/brand/icon.png`: full-resolution source icon with transparent exterior.
- `assets/brand/icon-128.png`, `icon-256.png`, `icon-512.png`: delivery sizes exported from that source.
- `assets/brand/mark.svg`: simplified monochrome feather for contexts that require a small vector mark. It does not reproduce the glass rendering.
- `assets/brand/figma-cover.png`: 1920 × 1080 PNG for the Figma Community cover.
- `assets/brand/figma-cover.webp`: smaller web export used by the README.
- `assets/brand/cover.png`: earlier navy repository cover, preserved as a legacy asset.
- `assets/brand/cover.webp`: smaller web export of the earlier navy cover.
- `assets/brand/preview.png`: actual plugin screenshot using its built-in synthetic document.

The plugin header embeds the 128 px icon locally during the build. It does not request a remote brand image. Run `node scripts/brand.mjs` to recreate the delivery sizes after intentionally replacing the source artwork.

## Production

The icon and cover were generated using the built-in image generation tool, guided by the user's reference for blue, depth and frosted glass. The feather is original to Pluma PDF; the reference's flower, lightning bolt and attribution are not part of the result. Delivery exports resize the generated artwork; these are raster assets, not vector reconstructions. No client design imagery is included.

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

Keep the panel vertical at 460 × 800. Use a pale neutral canvas, compact controls, and deep cobalt blue, related to the icon, for the rounded primary action and active choices. The document preview canvas is `#1E1E1E`. Show measured page sizes in one quiet white strip with thin separators after reading the original PDF. Keep empty metrics hidden and let the document preview use the available space. Preserve the actual PDF colors.

## Usage

Keep the icon square and preserve its alpha channel. Use a dark navy or neutral background when possible, with enough space to show its luminous edges. Keep the cover's proportions and readable margins. Use the monochrome SVG only where a simplified mark is appropriate.

### Interface palette

Interactive accents share `--blue` (`#1742B5`), with darker pressed and lighter hover states from the same scale. The metric strip stays white with neutral separators and an accented reduction value, while the PDF canvas is exactly `#1E1E1E`. Surface, control, border and text colors use shared neutral tokens. The primary action is rounded and solid, with stronger visual emphasis than secondary selections. Selected profiles and tabs use soft fills and blue text. Settings open in a full-width bottom sheet with the Pluma icon centered above the title and a fade/translate entrance. Respect reduced-motion preferences; avoid independent blue gradients or per-widget color choices. These tokens affect interface chrome only, never the rendered PDF.

## Artistic Community cover

The new cover is original artwork inspired by the separation between expressive imagery and quiet controls in [Noise & Texture](https://rog.ie/noise-and-texture/) and [FigUI3](https://rog.ie/figui3/). It does not reproduce their artwork, layout or branding. The supplied Pluma icon informed the feather gesture and cobalt accent.

One built-in image_gen generation produced the 1672 × 941 source. A deterministic Sharp Lanczos3 resize and minimal edge crop prepared the 1920 × 1080 PNG; the original remains in the local production outputs. A WebP export is used for the README. No client design imagery is present. The PNG is prepared for upload; adding it to this repository does not publish the plugin on Figma Community.

### Cover prompt

```text
Use case: ads-marketing.
Asset type: a single original artistic cover for the Pluma PDF Figma Community plugin. Landscape 16:9, intended 1920 x 1080 pixels. Create one finished image, not a grid of alternatives.
Input images: Image 1 is the actual Pluma brand icon, supplied only for the recognizable white feather silhouette and electric cobalt brand identity. Preserve that recognizable feather gesture if using it. Image 2 is a reference for tactile fine monochrome grain, decisive art direction and large legible typography ONLY. Do not copy its layout, typography arrangement, subject, texture pattern, interface, icon, logos, or branding.
Primary request: make a beautifully art-directed graphic poster about lightness and native detail. One monumental sculptural feather made from folded sheets of paper occupies the upper and right parts of the composition, with a graceful diagonal upward motion and dramatic curled folds. The pointed feather shape and long curved quill should echo the feather in image 1. Treat it as a crafted paper sculpture, not a photoreal bird feather. Broad white/silver paper planes, deep graphite fold shadows, and a restrained but unmistakable electric cobalt blue inner fold or exposed reverse surface. Let a small part of the sculpture crop beyond the right edge for confident scale. The sculpture is the single visual focus. Do not insert a separate rounded-square app-icon tile.
Scene/backdrop: cool white and very light neutral grey, no cream cast. Beautifully controlled monochrome photographic grain and fine ink-like stippling on the sculpted surfaces and their cast shadow, slightly softer at the outer edges. Keep the typographic area clean enough to read instantly at thumbnail size. Tactile printmaking quality, contemporary experimental editorial poster, premium independent design tool; not a corporate software hero template.
Composition/framing: an original asymmetric 16:9 poster with ample negative space and generous margins. The dominant title sits in the lower-left or left-center, balancing the sculpture, with a refined large bold modern grotesk and exceptionally deliberate kerning. The sculpture and text share one coherent graphic composition. Clear hierarchy, readable from a small thumbnail, no busy decorations or incidental tiny copy. The visual should be striking before reading the text.
Text (verbatim, only these two lines):
"Pluma PDF"
"Lighter PDFs. Native detail."
Text requirements: render the exact spelling, capitalization and punctuation above. Pluma PDF must be the large principal title, almost black or very dark graphite on the pale background. The tagline is a clean, smaller regular-weight line with strong readable contrast. No other text is necessary.
Color palette: overwhelmingly cool white, silver grey, charcoal black and fine monochrome grain; electric cobalt blue matching image 1 as the one purposeful color accent. Avoid rainbows, green, purple, neon haze and warm beige.
Lighting/mood: raking studio light reveals exquisite paper ridges, curvature, folds and microtexture, with sculptural charcoal shadows and clean highlights. Tangible, quiet, inventive, confident.
Constraints: new original artwork; no fake UI, no panels, no screenshots, no client designs, no photos of people, no reference branding, no prices, no compression percentages, no performance claims, no watermark, no extra labels, no badges. Keep all required text well inside safe margins. Do not simply copy the reference poster or the existing icon-plus-text corporate cover. Deliver one polished opaque 16:9 cover.
```
