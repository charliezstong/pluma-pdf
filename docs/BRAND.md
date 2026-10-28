# Pluma PDF brand

The primary icon is a sculpted white feather inside a luminous cobalt glass tile. Covers use that icon as the hero on a deep midnight-navy background, with large white sans-serif type and an icy-blue tagline. The repository cover is panoramic, 3104 × 900 pixels, matching the dimensions requested from the Turbit reference. The reference supplies dimensions only; its artwork is not used.

## Files

- `assets/brand/icon.png`: full-resolution source icon with transparent exterior.
- `assets/brand/icon-128.png`, `icon-256.png`, `icon-512.png`: delivery sizes.
- `assets/brand/mark.svg`: simplified monochrome feather; it does not reproduce the glass rendering.
- `assets/brand/cover.png` and `cover.webp`: 3104 × 900 repository cover; the README uses WebP.
- `assets/brand/figma-cover.png` and `figma-cover.webp`: 1920 × 1080 Community artwork, preserving the original navy icon-and-type direction.
- `assets/brand/preview.png`: 3104 × 1800 horizontal presentation of three real English plugin screens, rendered at 2× using the built-in synthetic document.

The plugin embeds its brand images locally. The startup screen uses the 256 px icon at 96 CSS pixels, with a small animated loading indicator. Startup waits for initial pages and language preferences with bounded fallbacks; it does not wait for the optional engine. Header and bottom sheets use the same actual icon.

## Production

The icon and panoramic cover were made with the built-in image generation tool, using the original Pluma icon and cover as identity references. The panoramic delivery uses a centered proportional crop and resize to exactly 3104 × 900; no stretching. Community artwork proportionally fits the original navy cover into a 1920 × 1080 navy canvas. These are raster assets. No client document imagery is included. The classic plugin has been submitted to Figma Community under ID `1697169100357342944` and is awaiting review. The public listing uses the searchable name “Pluma PDF — Export & Compress”; the artwork and interface retain the Pluma PDF brand.

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

### Panoramic cover prompt

```text
Use case: compositing / ads-marketing.
Edit target: image 1, the original Pluma PDF cover. Supporting identity reference: image 2, the actual Pluma app icon.
Create a refined panoramic GitHub repository cover, EXACT CANVAS 3104 x 900 pixels (3.4489:1). Recover the strong original icon-based composition. Keep the original recognizable blue glass rounded-square icon with its icy-white feather, large on the LEFT, about 690px tall, fully within canvas with comfortable top/bottom breathing room. Keep its beautiful luminous cobalt and cyan rim, layered blue glass, white feather silhouette. A deep midnight-navy background (#030A21), subtle blue light behind and underneath icon, elegant restrained studio glow flowing across the very wide background. No tiny orb. No white poster background.
RIGHT of icon: dominant large straight white sans-serif title, exquisitely typeset like the original, text verbatim "Pluma PDF". Under it, clearly readable light icy-blue sans-serif tagline verbatim "Lighter PDFs. Native detail." Small discreet spaced uppercase line below verbatim "LOCAL · FREE · OPEN SOURCE". Exact original wording. Flat crisp typography, professional kerning, no decorative serif, no bevel or extruded text, no blurry letters. Hierarchy: icon and large title dominate, tagline supports. Fill wide canvas intentionally, don't shrink everything to center. Icon remains hero, not a UI mockup. Keep title and icon fully visible with ~140px horizontal safe margins. No badges, extra icons, panels, screenshots, invented objects, extra slogans, watermarks. Preserve Pluma identity and original visual power; improve balance and adapt layout to requested ultra-wide ratio. Opaque background.
```

## Plugin interface

Keep the panel vertical at 400 × 720. Use a pale neutral canvas, compact controls, and deep cobalt blue, related to the icon, for the rounded primary action and active choices. The document preview canvas is `#1E1E1E`. Show measured page sizes in one quiet white strip with thin separators after reading the original PDF. Keep empty metrics hidden and let the document preview use the available space. Preserve the actual PDF colors.

## Usage

Keep the icon square and preserve its alpha channel. Use a dark navy or neutral background when possible, with enough space to show its luminous edges. Keep the cover's proportions and readable margins. Use the monochrome SVG only where a simplified mark is appropriate.

### Interface palette

Primary buttons share `--primary-gradient`, sampled from the icon’s cobalt, electric blue and cyan direction, with a restrained luminous edge. Keep white text over the deeper center and secondary controls neutral. Other interactive accents share `--blue` (`#174191`), with `#2052AB` hover and `#123371` pressed states. This remains recognizably blue while feeling deeper than bright cobalt. Primary buttons are rounded and 46 px tall with 13 px vertical padding. Secondary selections use neutral gray fills (`#F1F2F4`) and quiet gray borders (`#C7C9D2`), with dark blue text; avoid bright blue selection cards. The metric strip stays white with neutral separators and an accented reduction value, while the loaded PDF canvas is exactly `#1E1E1E`. All dialogs use a full-width bottom sheet with the Pluma icon centered above the title, a fade/translate entrance and a subtle exit. Respect reduced-motion preferences. These tokens affect interface chrome only, never the rendered PDF.

## Empty preview motion

The empty document preview uses one local CSS radial gradient on a white base. It expands eightfold over eight seconds and then breathes gently over a 30-second cycle. The circle extends beyond the preview and is clipped by its bounds. Its cyan edge fades to transparency without a white ring or a separate blue background layer. Motion starts after startup, stops when hidden and is disabled for reduced motion. Loaded documents use the neutral `#1E1E1E` canvas. The empty-state gradient is not the repository cover.
