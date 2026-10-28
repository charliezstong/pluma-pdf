/** Limits apply to decoded pixels, before the PDF is assembled. */
export const MAX_RASTER_EDGE = 8192;
export const MAX_RASTER_PIXELS = 24_000_000;

export interface RasterSize {
  width: number;
  height: number;
  /** Uniform scale to pass to Figma's SCALE export constraint. */
  scale: number;
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} debe ser un número positivo.`);
  }
  return value;
}

/** Preserve aspect ratio while bounding the longest edge and decoded pixel count. */
export function cappedRasterSize(
  width: number,
  height: number,
  requestedScale: number,
  maxEdge = MAX_RASTER_EDGE,
  maxPixels = MAX_RASTER_PIXELS,
): RasterSize {
  positive(width, 'El ancho');
  positive(height, 'El alto');
  positive(requestedScale, 'La escala');
  positive(maxEdge, 'El límite de lado');
  positive(maxPixels, 'El límite de píxeles');
  // The square-root expression avoids overflowing width * height for bad input.
  const pixelScale = Math.sqrt(maxPixels) / Math.sqrt(width) / Math.sqrt(height);
  let scale = Math.min(requestedScale, maxEdge / width, maxEdge / height, pixelScale);
  // Figma rounds raster dimensions up. Leave room for that last partial pixel.
  let rasterWidth = Math.max(1, Math.ceil(width * scale));
  let rasterHeight = Math.max(1, Math.ceil(height * scale));
  if (rasterWidth * rasterHeight > maxPixels || rasterWidth > maxEdge || rasterHeight > maxEdge) {
    scale = Math.min(
      scale,
      Math.max(1, Math.floor(width * scale)) / width,
      Math.max(1, Math.floor(height * scale)) / height,
    );
    rasterWidth = Math.max(1, Math.ceil(width * scale - 1e-9));
    rasterHeight = Math.max(1, Math.ceil(height * scale - 1e-9));
  }
  return { width: rasterWidth, height: rasterHeight, scale };
}

/**
 * Resize the complete source image, keeping its ratio. FILL needs enough pixels
 * to cover both axes; FIT needs enough for the axis that fits inside the layer.
 * Never upscale. Crop and tile modes intentionally have no implementation here.
 */
export function targetImageSize(
  sourceWidth: number,
  sourceHeight: number,
  displayWidth: number,
  displayHeight: number,
  scale: number,
  mode: 'FILL' | 'FIT',
): { width: number; height: number } {
  positive(sourceWidth, 'El ancho de imagen');
  positive(sourceHeight, 'El alto de imagen');
  positive(displayWidth, 'El ancho visible');
  positive(displayHeight, 'El alto visible');
  positive(scale, 'La escala');
  if (mode !== 'FILL' && mode !== 'FIT') throw new Error('Modo de imagen no compatible.');
  const fit = mode === 'FILL' ? Math.max : Math.min;
  const desiredScale = Math.min(1, fit(displayWidth / sourceWidth, displayHeight / sourceHeight) * scale);
  const target = cappedRasterSize(sourceWidth, sourceHeight, desiredScale);
  return {
    width: Math.min(Math.ceil(sourceWidth), target.width),
    height: Math.min(Math.ceil(sourceHeight), target.height),
  };
}
