# Pluma PDF brand

The primary icon is a sculpted white feather inside a luminous cobalt glass tile. The repository cover pairs the same icon with a dark navy background and English typography.

## Files

- `assets/brand/icon.png`: full-resolution source icon with transparent exterior.
- `assets/brand/icon-128.png`, `icon-256.png`, `icon-512.png`: delivery sizes exported from that source.
- `assets/brand/mark.svg`: simplified monochrome feather for contexts that require a small vector mark. It does not reproduce the glass rendering.
- `assets/brand/cover.png`: full-resolution repository cover.
- `assets/brand/cover.webp`: smaller web delivery version used by the README.
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

### Final cover prompt

```text
Use case: ads-marketing.
Asset type: final GitHub repository cover for Pluma PDF, wide landscape 2:1 banner.
Input image: the final Pluma PDF app icon. Preserve the same recognizable white feather, blue glass tile, depth and materials. This icon is the brand asset to feature.
Primary request: create a beautifully art-directed premium software cover. Near-black midnight navy background, generous negative space, the supplied luminous cobalt blue frosted-glass feather app icon on the LEFT, rendered as a dimensional product with soft restrained blue light beneath it. The icon occupies roughly the left third, never cropped. On the RIGHT, large clear white modern sans-serif typography reads exactly "Pluma PDF". Directly below in smaller muted ice-blue typography, exactly "Lighter PDFs. Native detail." At the bottom of that same text column, a very small, carefully spaced line reads exactly "LOCAL · FREE · OPEN SOURCE". The composition is confident, quiet, sophisticated, with the icon providing the saturated blue energy. Keep all text well inside the margins and sharply legible.
Constraints: match the input icon closely; only the three specified text strings; no watermark, no reference branding, no UI mockup, no extra symbols, no badges, no buttons, no decorative charts. Wide landscape 2:1 composition.
```

## Usage

Keep the icon square and preserve its alpha channel. Use a dark navy or neutral background when possible, with enough space to show its luminous edges. Keep the cover's proportions and readable margins. Use the monochrome SVG only where a simplified mark is appropriate.
