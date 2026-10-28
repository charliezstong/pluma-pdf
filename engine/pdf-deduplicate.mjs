import { createHash } from 'node:crypto';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import { MAX_PDF_BYTES, PDFError } from './pdf-optimize.mjs';

const name = value => PDFName.of(value);

/** Deduplicate only byte-identical encoded image streams with equivalent full
 * dictionaries. Resolve known mask/ICC relationships; all unknown references
 * must already be identical. Page operators and resource names are unchanged.
 */
export function deduplicateImageStreams(context, observeAliases) {
  const representatives = new Map();
  const aliases = new Map();
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  function valueKey(value) {
    if (value instanceof PDFRef) return ['ref', value.toString()];
    if (value instanceof PDFArray) return Array.from({ length: value.size() }, (_, index) => valueKey(value.get(index)));
    if (value instanceof PDFDict) return value.entries().map(([key, item]) => [key.toString(), valueKey(item)]).sort(([a], [b]) => a.localeCompare(b));
    return value?.toString() ?? null;
  }
  function colourSpaceKey(value) {
    if (value instanceof PDFRef) value = context.lookup(value);
    if (value instanceof PDFArray && value.size() === 2 && value.lookup(0)?.toString() === '/ICCBased') {
      const profile = value.lookup(1);
      if (profile instanceof PDFRawStream) return ['ICCBased', sha(profile.contents), dictionaryKey(profile.dict, new Set())];
    }
    return valueKey(value);
  }
  function dictionaryKey(dict, seen) {
    return dict.entries().filter(([key]) => key.toString() !== '/Length').map(([key, value]) => {
      const keyText = key.toString();
      if (keyText === '/ColorSpace') return [keyText, colourSpaceKey(value)];
      if (keyText === '/SMask' && value instanceof PDFRef) {
        const mask = context.lookup(value);
        if (mask instanceof PDFRawStream && mask.dict.lookup(name('Subtype'))?.toString() === '/Image' && !seen.has(mask)) {
          return [keyText, imageKey(mask, new Set([...seen, mask]))];
        }
      }
      return [keyText, valueKey(value)];
    }).sort(([a], [b]) => a.localeCompare(b));
  }
  function imageKey(image, seen = new Set([image])) {
    return [sha(image.contents), dictionaryKey(image.dict, seen)];
  }
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.lookup(name('Subtype'))?.toString() !== '/Image') continue;
    try {
      const signature = JSON.stringify(imageKey(object));
      if (representatives.has(signature)) aliases.set(ref.toString(), { from: ref, to: representatives.get(signature) });
      else representatives.set(signature, ref);
    } catch { /* Refuse uncertain or cyclic structures. */ }
  }
  if (!aliases.size) return 0;
  if (observeAliases) observeAliases([...aliases.values()]);
  function replacement(value) {
    return value instanceof PDFRef ? aliases.get(value.toString())?.to ?? value : value;
  }
  function rewrite(object, seen) {
    if (!object || object instanceof PDFRef || seen.has(object)) return;
    seen.add(object);
    if (object instanceof PDFRawStream) rewrite(object.dict, seen);
    else if (object instanceof PDFDict) for (const [key, value] of object.entries()) {
      const updated = replacement(value);
      if (updated !== value) object.set(key, updated);
      else rewrite(value, seen);
    }
    else if (object instanceof PDFArray) for (let index = 0; index < object.size(); index += 1) {
      const value = object.get(index), updated = replacement(value);
      if (updated !== value) object.set(index, updated);
      else rewrite(value, seen);
    }
  }
  for (const [, object] of context.enumerateIndirectObjects()) rewrite(object, new Set());
  for (const { from } of aliases.values()) context.delete(from);
  return aliases.size;
}

/** Lossless final pass after per-frame PDFs are merged. No pixels are decoded
 * or re-encoded: only equivalent encoded XObjects share an existing reference.
 */
export async function deduplicatePDF(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw new PDFError('EMPTY_PDF', 'Envía un PDF para optimizarlo.', 400);
  if (input.length > MAX_PDF_BYTES) throw new PDFError('BODY_TOO_LARGE', 'El PDF supera el límite de 300 MiB.', 413);
  if (!input.subarray(0, Math.min(input.length, 1024)).includes(Buffer.from('%PDF-'))) throw new PDFError('INVALID_PDF', 'El archivo no es un PDF válido.');
  let document;
  try {
    document = await PDFDocument.load(input, { updateMetadata: false });
  } catch {
    throw new PDFError('INVALID_PDF', 'No se pudo leer el PDF. Los documentos cifrados no son compatibles.');
  }
  let deduplicatedImages = deduplicateImageStreams(document.context);
  let output = input;
  if (deduplicatedImages > 0) {
    const candidate = Buffer.from(await document.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false }));
    if (candidate.length < input.length) output = candidate;
    else deduplicatedImages = 0;
  }
  const stats = { deduplicatedImages, optimizedImages: 0, skippedImages: 0, keptOriginal: output === input };
  return { buffer: output, contentType: 'application/pdf', originalBytes: input.length, bytes: output.length,
    savedBytes: input.length - output.length, ...stats, stats };
}
