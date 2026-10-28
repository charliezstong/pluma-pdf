/**
 * Deterministic comparison of decoded canvas RGBA pixels.
 * Pixel identity is an exact condition; these statistics do not assess design
 * quality or guarantee that two PDF documents have identical semantics.
 */
export const CHANGED_CHANNEL_THRESHOLD = 8;
export const DIFFERENCE_AMPLIFICATION = 4;

export interface PixelDiff {
  identical: boolean;
  width: number;
  height: number;
  /** Mean absolute channel difference, including alpha, on the 0–255 scale. */
  meanAbsoluteError: number;
  /** Pixels with at least one channel difference strictly greater than 8. */
  changedPixelsPercent: number;
  /** Opaque RGBA heatmap. Identical pixels are black; differences are ×4. */
  differencePixels: Uint8ClampedArray;
}

export interface RenderedImageDiff {
  identical: boolean;
  width: number;
  height: number;
  meanAbsoluteError: number;
  changedPixelsPercent: number;
  differenceDataUrl: string;
}

/** Pure comparison: inputs are never modified, and every RGBA byte is compared. */
export function computePixelDiff(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  height: number,
): PixelDiff {
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(pixels) || !Number.isSafeInteger(pixels * 4)) {
    throw new Error('Las dimensiones de la comparación deben ser enteros positivos válidos.');
  }
  if (before.length !== pixels * 4 || after.length !== pixels * 4) {
    throw new Error('Los buffers RGBA no coinciden con las dimensiones de la comparación.');
  }

  const differencePixels = new Uint8ClampedArray(before.length);
  let totalAbsoluteError = 0;
  let changedPixels = 0;
  let identical = true;

  for (let offset = 0; offset < before.length; offset += 4) {
    const red = Math.abs(before[offset] - after[offset]);
    const green = Math.abs(before[offset + 1] - after[offset + 1]);
    const blue = Math.abs(before[offset + 2] - after[offset + 2]);
    const alpha = Math.abs(before[offset + 3] - after[offset + 3]);
    const maximum = Math.max(red, green, blue, alpha);
    totalAbsoluteError += red + green + blue + alpha;
    if (maximum !== 0) identical = false;
    if (maximum > CHANGED_CHANNEL_THRESHOLD) changedPixels++;

    // An alpha difference raises all three channels so it remains visible on
    // the black background; the output itself is always fully opaque.
    differencePixels[offset] = Math.min(255, Math.max(red, alpha) * DIFFERENCE_AMPLIFICATION);
    differencePixels[offset + 1] = Math.min(255, Math.max(green, alpha) * DIFFERENCE_AMPLIFICATION);
    differencePixels[offset + 2] = Math.min(255, Math.max(blue, alpha) * DIFFERENCE_AMPLIFICATION);
    differencePixels[offset + 3] = 255;
  }

  return {
    identical,
    width,
    height,
    meanAbsoluteError: totalAbsoluteError / before.length,
    changedPixelsPercent: changedPixels / pixels * 100,
    differencePixels,
  };
}

interface DecodedImage { width: number; height: number; pixels: Uint8ClampedArray }

async function decodePng(dataUrl: string): Promise<DecodedImage> {
  // The comparison accepts the offline PNGs returned by renderPdf; it never
  // fetches a remote URL or attempts to interpret SVG or other document types.
  if (typeof dataUrl !== 'string' || !/^data:image\/png(?:;[^,]*)?,/i.test(dataUrl)) {
    throw new Error('La comparación necesita vistas PNG locales en formato data URL.');
  }
  const image = new Image();
  image.src = dataUrl;
  try { await image.decode(); }
  catch { throw new Error('No se pudo decodificar una de las vistas PNG.'); }
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('Una vista PNG está vacía.');

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!context) throw new Error('No se pudo crear el lienzo de comparación.');
    context.drawImage(image, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
    };
  } finally {
    canvas.width = canvas.height = 1;
  }
}

/** Compare two already rendered PNGs at exactly the same pixel dimensions. */
export async function compareRenderedImages(beforeDataUrl: string, afterDataUrl: string): Promise<RenderedImageDiff> {
  const [before, after] = await Promise.all([decodePng(beforeDataUrl), decodePng(afterDataUrl)]);
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`Las vistas tienen dimensiones diferentes (${before.width} × ${before.height} y ${after.width} × ${after.height}). Renderiza ambas al mismo tamaño.`);
  }
  const diff = computePixelDiff(before.pixels, after.pixels, before.width, before.height);
  const canvas = document.createElement('canvas');
  canvas.width = diff.width;
  canvas.height = diff.height;
  try {
    const context = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!context) throw new Error('No se pudo crear el mapa de diferencias.');
    const pixels = context.createImageData(diff.width, diff.height);
    pixels.data.set(diff.differencePixels);
    context.putImageData(pixels, 0, 0);
    return {
      identical: diff.identical,
      width: diff.width,
      height: diff.height,
      meanAbsoluteError: diff.meanAbsoluteError,
      changedPixelsPercent: diff.changedPixelsPercent,
      differenceDataUrl: canvas.toDataURL('image/png'),
    };
  } finally {
    canvas.width = canvas.height = 1;
  }
}
