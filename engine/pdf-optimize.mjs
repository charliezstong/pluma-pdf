import { constants as zlibConstants, deflateSync, inflateSync } from 'node:zlib';
import sharp from 'sharp';
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNull, PDFNumber, PDFRawStream, PDFRef,
} from 'pdf-lib';
import { MAX_INPUT_PIXELS } from './optimize.mjs';
import { deduplicateImageStreams } from './pdf-deduplicate.mjs';
export { deduplicateImageStreams } from './pdf-deduplicate.mjs';

export const MAX_PDF_BYTES = 300 * 1024 * 1024;

export class PDFError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = 'PDFError';
    this.code = code;
    this.status = status;
  }
}

const name = value => PDFName.of(value);
const lookup = (dict, key) => dict.lookup(name(key));
const present = (dict, key) => {
  const value = lookup(dict, key);
  return value !== undefined && value !== PDFNull;
};
const number = (dict, key) => {
  const value = lookup(dict, key);
  return value instanceof PDFNumber ? value.asNumber() : undefined;
};

function filterOf(dict) {
  const filter = lookup(dict, 'Filter');
  if (filter instanceof PDFName) return filter.toString();
  if (filter instanceof PDFArray && filter.size() === 1) {
    const first = filter.lookup(0);
    return first instanceof PDFName ? first.toString() : undefined;
  }
  return undefined;
}

function hasDecodeParameters(dict) {
  const parameters = lookup(dict, 'DecodeParms');
  if (parameters === undefined || parameters === PDFNull) return false;
  if (parameters instanceof PDFArray && parameters.size() === 1 && parameters.lookup(0) === PDFNull) return false;
  // In particular, do not guess DCT ColorTransform or Flate predictors.
  return true;
}

/** Only simple Flate streams; cap inflation before handing samples to sharp. */
function decodeFlate(stream, expectedLength, maxLength = expectedLength) {
  if (filterOf(stream.dict) !== '/FlateDecode' || hasDecodeParameters(stream.dict)) throw new Error('Unsupported Flate stream');
  let decoded;
  try {
    decoded = inflateSync(stream.contents, { maxOutputLength: maxLength });
  } catch (error) {
    // Some native Figma masks have complete samples but omit the zlib trailer.
    // Recover only when the exact expected sample count can still be verified.
    if (error.code !== 'Z_BUF_ERROR' || expectedLength === undefined) throw error;
    decoded = inflateSync(stream.contents, { maxOutputLength: maxLength, finishFlush: zlibConstants.Z_SYNC_FLUSH });
  }
  if (expectedLength !== undefined && decoded.length !== expectedLength) throw new Error('Unexpected image sample length');
  return decoded;
}

function isSRGBProfile(bytes) {
  if (bytes.length < 132 || bytes.toString('ascii', 16, 20) !== 'RGB ' || bytes.toString('ascii', 36, 40) !== 'acsp') return false;
  const count = bytes.readUInt32BE(128);
  if (count > 128 || 132 + count * 12 > bytes.length) return false;
  for (let index = 0; index < count; index += 1) {
    const entry = 132 + index * 12;
    if (bytes.toString('ascii', entry, entry + 4) !== 'desc') continue;
    const offset = bytes.readUInt32BE(entry + 4);
    const length = bytes.readUInt32BE(entry + 8);
    if (length < 12 || offset + length > bytes.length) continue;
    if (bytes.toString('ascii', offset, offset + 4) !== 'desc') continue;
    const textLength = bytes.readUInt32BE(offset + 8);
    if (textLength < 1 || textLength > length - 12) continue;
    if (/\bsrgb\b/i.test(bytes.toString('ascii', offset + 12, offset + 12 + textLength))) return true;
  }
  return false;
}

function colourChannels(dict) {
  const space = lookup(dict, 'ColorSpace');
  if (space instanceof PDFName) {
    if (space.toString() === '/DeviceRGB') return 3;
    if (space.toString() === '/DeviceGray') return 1;
    return undefined;
  }
  if (space instanceof PDFArray && space.size() === 2 && space.lookup(0)?.toString() === '/ICCBased') {
    const profile = space.lookup(1);
    if (!(profile instanceof PDFRawStream) || number(profile.dict, 'N') !== 3) return undefined;
    const bytes = decodeFlate(profile, undefined, 4 * 1024 * 1024);
    return isSRGBProfile(bytes) ? 3 : undefined;
  }
  return undefined;
}

function simpleImage(stream, allowDefaultGrayDecode = false) {
  if (!(stream instanceof PDFRawStream) || lookup(stream.dict, 'Subtype')?.toString() !== '/Image') return undefined;
  const width = number(stream.dict, 'Width');
  const height = number(stream.dict, 'Height');
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_INPUT_PIXELS) return undefined;
  const decode = lookup(stream.dict, 'Decode');
  const defaultGrayDecode = allowDefaultGrayDecode && decode instanceof PDFArray && decode.size() === 2
    && decode.lookup(0) instanceof PDFNumber && decode.lookup(0).asNumber() === 0
    && decode.lookup(1) instanceof PDFNumber && decode.lookup(1).asNumber() === 1;
  if (number(stream.dict, 'BitsPerComponent') !== 8 || (present(stream.dict, 'Decode') && !defaultGrayDecode) || present(stream.dict, 'Mask')
    || present(stream.dict, 'ImageMask') || present(stream.dict, 'Matte') || present(stream.dict, 'SMaskInData')
    || hasDecodeParameters(stream.dict)) return undefined;
  return { width, height };
}

function inspectSoftMask(stream, width, height) {
  const mask = lookup(stream.dict, 'SMask');
  if (mask === undefined || mask === PDFNull || mask.toString() === '/None') return { supported: true, remove: false };
  const size = simpleImage(mask, true);
  if (!size || size.width !== width || size.height !== height || lookup(mask.dict, 'ColorSpace')?.toString() !== '/DeviceGray'
    || present(mask.dict, 'SMask')) return { supported: false };
  const samples = decodeFlate(mask, width * height);
  // A gray image's stats.isOpaque describes an alpha channel, not its values.
  // Here every sample must be 255 before removing the soft-mask relationship.
  const ref = stream.dict.get(name('SMask'));
  for (const sample of samples) if (sample !== 255) return { supported: true, remove: false, mask, samples, ref, hasTransparency: true };
  return { supported: true, remove: true, mask, ref };
}

/** Count references without dereferencing: each indirect object's own dictionary
 * is visited once by the outer enumeration. Only replaced mask refs are eligible.
 */
function removeUnreferencedMasks(context, candidates) {
  const referenced = new Set();
  function visit(value, seen) {
    if (value instanceof PDFRef) { referenced.add(value.toString()); return; }
    if (!value || seen.has(value)) return;
    seen.add(value);
    if (value instanceof PDFRawStream) visit(value.dict, seen);
    else if (value instanceof PDFDict) for (const [, child] of value.entries()) visit(child, seen);
    else if (value instanceof PDFArray) for (let index = 0; index < value.size(); index += 1) visit(value.get(index), seen);
  }
  for (const [, object] of context.enumerateIndirectObjects()) visit(object, new Set());
  let removed = 0;
  for (const ref of candidates.values()) if (!referenced.has(ref.toString())) { context.delete(ref); removed += 1; }
  return removed;
}

export function validatePDFOptions({ quality = 82, maxEdge = 2400 } = {}) {
  if (!Number.isInteger(quality) || quality < 40 || quality > 100) throw new PDFError('INVALID_QUERY', 'quality debe ser un entero entre 40 y 100.', 400);
  if (!Number.isInteger(maxEdge) || maxEdge < 512 || maxEdge > 8192) throw new PDFError('INVALID_QUERY', 'maxEdge debe ser un entero entre 512 y 8192.', 400);
  return { quality, maxEdge };
}

/**
 * Replaces compatible image XObjects at their original references. Text,
 * vectors, page content streams and fonts remain intact. Compatible gray soft
 * masks are resized losslessly together with premultiplied color samples.
 * Unsupported mask encodings, Matte and decoding parameters stay untouched.
 */
export async function optimizePDF(input, options = {}) {
  const { quality, maxEdge } = validatePDFOptions(options);
  const suppliedLimits = options.imageLimits;
  const imageLimits = new Map(suppliedLimits instanceof Map ? suppliedLimits : Object.entries(suppliedLimits ?? {}));
  const validLimit = usage => Number.isInteger(usage?.width) && Number.isInteger(usage?.height)
    && usage.width >= 1 && usage.width <= 8192 && usage.height >= 1 && usage.height <= 8192;
  if (!Buffer.isBuffer(input) || input.length === 0) throw new PDFError('EMPTY_PDF', 'Envía un PDF para optimizarlo.', 400);
  if (input.length > MAX_PDF_BYTES) throw new PDFError('BODY_TOO_LARGE', 'El PDF supera el límite de 300 MiB.', 413);
  if (!input.subarray(0, Math.min(input.length, 1024)).includes(Buffer.from('%PDF-'))) throw new PDFError('INVALID_PDF', 'El archivo no es un PDF válido.');

  let document;
  try {
    document = await PDFDocument.load(input, { updateMetadata: false });
  } catch {
    throw new PDFError('INVALID_PDF', 'No se pudo leer el PDF. Los documentos cifrados no son compatibles.');
  }
  let placementAudit = { attempted: false, complete: false, warnings: [] };
  if (options.imageLimits === undefined && options.placement !== false) {
    try {
      const { auditPDFPlacements } = await import('./pdf-placement.mjs');
      const audit = await auditPDFPlacements(input, { maxEdge, timeoutMs: 30_000 });
      placementAudit = { attempted: true, complete: audit.complete, ...audit.stats, warnings: audit.warnings };
      if (audit.complete) for (const [ref, limit] of audit.imageLimits) imageLimits.set(ref, limit);
    } catch {
      placementAudit = { attempted: true, complete: false, warnings: ['placementUnavailable'] };
    }
  }
  const unboundedAliases = new Set();
  const deduplicatedImageStreams = deduplicateImageStreams(document.context, aliases => {
    // A shared image must satisfy its largest use across all original aliases.
    // One unknown use makes the representative fall back to the global cap.
    for (const { from, to } of aliases) {
      const fromKey = from.toString(), toKey = to.toString();
      const sourceLimit = imageLimits.get(fromKey), targetLimit = imageLimits.get(toKey);
      if (unboundedAliases.has(toKey) || !validLimit(sourceLimit) || !validLimit(targetLimit)) {
        imageLimits.delete(toKey);
        unboundedAliases.add(toKey);
      } else imageLimits.set(toKey, { width: Math.max(sourceLimit.width, targetLimit.width), height: Math.max(sourceLimit.height, targetLimit.height) });
    }
  });
  const objects = document.context.enumerateIndirectObjects();
  const maskObjects = new Set();
  for (const [, object] of objects) {
    if (!(object instanceof PDFRawStream)) continue;
    for (const key of ['SMask', 'Mask']) {
      try {
        const mask = lookup(object.dict, key);
        if (mask instanceof PDFRawStream) maskObjects.add(mask);
      } catch { /* An unsupported indirect mask is never modified. */ }
    }
  }
  const images = objects.filter(([, object]) => object instanceof PDFRawStream
    && lookup(object.dict, 'Subtype')?.toString() === '/Image' && !maskObjects.has(object));
  const stats = { totalImages: images.length, optimizedImages: 0, skippedImages: 0, resizedImages: 0, placementLimitedImages: 0, optimizedMasks: 0, removedUnusedMasks: 0, deduplicatedImageStreams, placementAudit, keptOriginal: false, reasons: {} };
  const replacedMaskRefs = new Map();
  const skip = reason => {
    stats.skippedImages += 1;
    stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
  };
  const started = Date.now();

  for (const [ref, image] of images) {
    if (Date.now() - started > 90_000) { skip('timeBudget'); continue; }
    try {
      const size = simpleImage(image);
      if (!size) { skip('unsupportedImage'); continue; }
      const usage = imageLimits.get(ref.toString());
      const usableLimit = validLimit(usage);
      const targetWidth = usableLimit ? Math.min(maxEdge, usage.width) : maxEdge;
      const targetHeight = usableLimit ? Math.min(maxEdge, usage.height) : maxEdge;
      const channels = colourChannels(image.dict);
      if (!channels) { skip('unsupportedColorSpace'); continue; }
      const softMask = inspectSoftMask(image, size.width, size.height);
      if (!softMask.supported) { skip('transparency'); continue; }
      const filter = filterOf(image.dict);
      let pipeline;
      if (filter === '/DCTDecode') {
        pipeline = sharp(image.contents, { limitInputPixels: MAX_INPUT_PIXELS, ignoreIcc: true, failOn: 'warning' }).timeout({ seconds: 20 });
        const metadata = await pipeline.metadata();
        if (metadata.width !== size.width || metadata.height !== size.height || metadata.channels !== channels
          || metadata.space === 'cmyk' || metadata.depth !== 'uchar') { skip('incompatibleJpeg'); continue; }
      } else if (filter === '/FlateDecode') {
        const samples = decodeFlate(image, size.width * size.height * channels);
        pipeline = sharp(samples, { raw: { ...size, channels }, limitInputPixels: MAX_INPUT_PIXELS }).timeout({ seconds: 20 });
      } else {
        skip('unsupportedFilter');
        continue;
      }
      // Do not auto-rotate: PDF placement uses the encoded sample orientation.
      const resizing = size.width > targetWidth || size.height > targetHeight;
      let newMask;
      let encoded;
      if (softMask.hasTransparency && resizing) {
        // Sharp premultiplies RGBA while resizing, then unpremultiplies the raw
        // result. Resizing straight RGB separately creates dark edge halos.
        // Materialize the joined pixels first: sharp performs joinChannel after
        // resize in one pipeline, regardless of JavaScript call order.
        if (channels === 1) pipeline = pipeline.toColourspace('b-w');
        const joined = await pipeline.joinChannel(softMask.samples, { raw: { ...size, channels: 1 } })
          .raw().toBuffer({ resolveWithObject: true });
        if (joined.info.width !== size.width || joined.info.height !== size.height || joined.info.channels !== channels + 1) throw new Error('Unexpected source alpha layout');
        const resized = await sharp(joined.data, { raw: { width: joined.info.width, height: joined.info.height, channels: joined.info.channels } })
          .timeout({ seconds: 20 }).resize({ width: targetWidth, height: targetHeight, fit: 'inside', withoutEnlargement: true })
          .raw().toBuffer({ resolveWithObject: true });
        if (resized.info.channels !== channels + 1) throw new Error('Unexpected alpha channel layout');
        const pixels = resized.info.width * resized.info.height;
        const alpha = Buffer.alloc(pixels);
        for (let pixel = 0; pixel < pixels; pixel += 1) alpha[pixel] = resized.data[pixel * (channels + 1) + channels];
        newMask = { buffer: deflateSync(alpha, { level: 9 }), width: resized.info.width, height: resized.info.height };
        let colour = sharp(resized.data, { raw: { width: resized.info.width, height: resized.info.height, channels: channels + 1 } }).removeAlpha().timeout({ seconds: 20 });
        if (channels === 1) colour = colour.toColourspace('b-w');
        encoded = await colour.jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer({ resolveWithObject: true });
      } else {
        pipeline = pipeline.resize({ width: targetWidth, height: targetHeight, fit: 'inside', withoutEnlargement: true });
        if (channels === 1) pipeline = pipeline.toColourspace('b-w');
        encoded = await pipeline.jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer({ resolveWithObject: true });
      }
      const { data, info } = encoded;
      const originalMaskBytes = newMask ? softMask.mask.contents.length : 0;
      if (data.length + (newMask?.buffer.length ?? 0) >= image.contents.length + originalMaskBytes) { skip('noSavings'); continue; }
      const dictionary = image.dict.clone(document.context);
      dictionary.set(name('Filter'), name('DCTDecode'));
      dictionary.set(name('Width'), PDFNumber.of(info.width));
      dictionary.set(name('Height'), PDFNumber.of(info.height));
      dictionary.delete(name('DecodeParms'));
      if (softMask.remove) dictionary.delete(name('SMask'));
      if (newMask) {
        const maskDictionary = softMask.mask.dict.clone(document.context);
        maskDictionary.set(name('Width'), PDFNumber.of(newMask.width));
        maskDictionary.set(name('Height'), PDFNumber.of(newMask.height));
        maskDictionary.set(name('Filter'), name('FlateDecode'));
        maskDictionary.delete(name('DecodeParms'));
        const newMaskRef = document.context.register(PDFRawStream.of(maskDictionary, newMask.buffer));
        dictionary.set(name('SMask'), newMaskRef);
        stats.optimizedMasks += 1;
      }
      if ((newMask || softMask.remove) && softMask.ref instanceof PDFRef) replacedMaskRefs.set(softMask.ref.toString(), softMask.ref);
      document.context.assign(ref, PDFRawStream.of(dictionary, data));
      stats.optimizedImages += 1;
      if (info.width !== size.width || info.height !== size.height) stats.resizedImages += 1;
      if (usableLimit && (targetWidth < maxEdge || targetHeight < maxEdge) && resizing) stats.placementLimitedImages += 1;
    } catch (error) {
      // A single unexpected image never prevents a valid native PDF export.
      if (process.env.PLUMA_DEBUG_PDF === '1') console.error(`Skipped image ${ref}: ${error.message}`);
      skip('unsupportedOrDamagedImage');
    }
  }

  let output = input;
  if (stats.optimizedImages > 0 || stats.deduplicatedImageStreams > 0) {
    try {
      stats.removedUnusedMasks = removeUnreferencedMasks(document.context, replacedMaskRefs);
      const candidate = Buffer.from(await document.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false }));
      if (candidate.length < input.length) output = candidate;
    } catch {
      throw new PDFError('PDF_SAVE_FAILED', 'No se pudo guardar el PDF optimizado. Conserva la exportación original.');
    }
  }
  if (output === input) {
    stats.keptOriginal = true;
    stats.deduplicatedImageStreams = 0;
    if (stats.optimizedImages > 0) {
      stats.reasons.documentNotSmaller = stats.optimizedImages;
      stats.optimizedImages = 0;
      stats.resizedImages = 0;
      stats.placementLimitedImages = 0;
      stats.optimizedMasks = 0;
      stats.removedUnusedMasks = 0;
      stats.deduplicatedImageStreams = 0;
      stats.skippedImages = stats.totalImages;
    }
  }
  return {
    buffer: output, contentType: 'application/pdf', originalBytes: input.length, bytes: output.length,
    savedBytes: input.length - output.length, ...stats, stats,
  };
}
