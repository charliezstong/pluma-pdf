import sharp from 'sharp';

export const MAX_INPUT_PIXELS = 40_000_000;
export const MAX_OUTPUT_DIMENSION = 8192;

export class ImageError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = 'ImageError';
    this.code = code;
    this.status = status;
  }
}

/** Keep SVG, PDF and other document formats out of the native raster decoder. */
function isRasterImage(input) {
  if (input.length >= 8 && input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return true;
  if (input.length >= 3 && input[0] === 255 && input[1] === 216 && input[2] === 255) return true;
  if (input.length >= 12 && input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP') return true;
  if (input.length >= 16 && input.toString('ascii', 4, 8) === 'ftyp') {
    const brands = input.subarray(8, Math.min(input.length, 64)).toString('ascii');
    return brands.includes('avif') || brands.includes('avis');
  }
  return false;
}

export function validateOptions({ width, height, quality = 82, flatten = false } = {}) {
  for (const [name, value] of Object.entries({ width, height })) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_OUTPUT_DIMENSION) {
      throw new ImageError('INVALID_OPTIONS', `${name} debe ser un entero entre 1 y ${MAX_OUTPUT_DIMENSION}.`, 400);
    }
  }
  if (!Number.isInteger(quality) || quality < 40 || quality > 100) {
    throw new ImageError('INVALID_OPTIONS', 'quality debe ser un entero entre 40 y 100.', 400);
  }
  if (typeof flatten !== 'boolean') {
    throw new ImageError('INVALID_OPTIONS', 'flatten debe ser un booleano.', 400);
  }
  return { width, height, quality, flatten };
}

/** Process bytes in memory. No files, network calls or metadata are retained. */
export async function optimizeImage(input, options) {
  const { width, height, quality, flatten } = validateOptions(options);
  if (!Buffer.isBuffer(input) || input.length === 0) {
    throw new ImageError('EMPTY_IMAGE', 'La imagen está vacía.', 400);
  }
  if (!isRasterImage(input)) {
    throw new ImageError('UNSUPPORTED_IMAGE', 'Usa una imagen PNG, JPEG, WebP o AVIF.', 415);
  }

  try {
    const source = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'warning', sequentialRead: true }).timeout({ seconds: 20 });
    const metadata = await source.metadata();
    if (!metadata.width || !metadata.height) {
      throw new ImageError('INVALID_IMAGE', 'No se pudieron leer las dimensiones de la imagen.');
    }
    if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
      throw new ImageError('IMAGE_TOO_LARGE', 'La imagen supera el límite de 40 megapíxeles.', 413);
    }
    if (metadata.pages && metadata.pages > 1) {
      throw new ImageError('ANIMATED_IMAGE', 'Exporta una imagen estática para optimizarla.', 415);
    }

    // Figma also exports fully opaque pictures as RGBA. Inspect actual pixels so
    // an unused alpha channel does not prevent JPEG compression.
    const preserveAlpha = Boolean(metadata.hasAlpha) && !flatten && !(await source.stats()).isOpaque;
    // rotate() applies EXIF orientation; sharp removes source metadata by default.
    let pipeline = source.rotate().resize({ width, height, fit: 'inside', withoutEnlargement: true });
    if (preserveAlpha) {
      pipeline = pipeline.png({ compressionLevel: 9 });
    } else {
      pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' });
    }
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      buffer: data,
      contentType: preserveAlpha ? 'image/png' : 'image/jpeg',
      width: info.width,
      height: info.height,
      originalBytes: input.length,
      bytes: data.length,
      alphaPreserved: preserveAlpha,
    };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    if (/pixel limit|exceeds.*limit/i.test(error.message)) {
      throw new ImageError('IMAGE_TOO_LARGE', 'La imagen supera el límite de 40 megapíxeles.', 413);
    }
    if (/timeout/i.test(error.message)) {
      throw new ImageError('PROCESSING_TIMEOUT', 'La imagen tardó demasiado en procesarse. Prueba con una resolución menor.', 504);
    }
    // Native decoder errors can include implementation details; keep them local.
    throw new ImageError('INVALID_IMAGE', 'No se pudo procesar la imagen. Comprueba que el archivo no esté dañado.');
  }
}
