import { getDocument, OPS, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

export const MAX_PLACEMENT_PAGES = 200;
export const MAX_PLACEMENT_TIME_MS = 90_000;
const MAX_INPUT_BYTES = 300 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_OPERATORS = 2_000_000;
const IDENTITY = [1, 0, 0, 1, 0, 0];

export class PlacementError extends Error {
  constructor(code, message) { super(message); this.name = 'PlacementError'; this.code = code; }
}

/** PDF.js uses 9079R / 9079R2; pdf-lib uses the canonical 9079 0 R form. */
export function normalizeImageRef(value) {
  if (value && typeof value === 'object' && Number.isSafeInteger(value.num) && Number.isSafeInteger(value.gen)
    && value.num > 0 && value.gen >= 0) return `${value.num} ${value.gen} R`;
  if (typeof value !== 'string') return undefined;
  const match = /^(\d+)R(\d+)?$/.exec(value) || /^(\d+)\s+(\d+)\s+R$/.exec(value);
  if (!match) return undefined;
  const num = Number(match[1]), gen = Number(match[2] ?? 0);
  return Number.isSafeInteger(num) && num > 0 && Number.isSafeInteger(gen) && gen >= 0 ? `${num} ${gen} R` : undefined;
}

function matrix(value) {
  return (Array.isArray(value) || ArrayBuffer.isView(value)) && value.length === 6
    && Array.from(value).every(Number.isFinite);
}
function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function identity(value) { return matrix(value) && IDENTITY.every((n, index) => Math.abs(value[index] - n) < 1e-10); }

function mergeRecord(records, incoming) {
  const previous = records.get(incoming.ref);
  if (!previous) { records.set(incoming.ref, incoming); return; }
  if (previous.sourceWidth !== incoming.sourceWidth || previous.sourceHeight !== incoming.sourceHeight) {
    previous.blockedReasons.add('inconsistentSourceDimensions');
  }
  previous.requiredWidth = Math.max(previous.requiredWidth, incoming.requiredWidth);
  previous.requiredHeight = Math.max(previous.requiredHeight, incoming.requiredHeight);
  previous.uses += incoming.uses;
  for (const page of incoming.pages) previous.pages.add(page);
  for (const reason of incoming.blockedReasons) previous.blockedReasons.add(reason);
}

/**
 * Inspect the logical PDF CTM, not a renderer's scratch-canvas coordinates.
 * This low-level entrypoint permits tests without decoding PDF image buffers.
 */
export async function inspectImageOperatorList(list, {
  pageNumber = 1, pageWidth, pageHeight, maxEdge = 2560, resolveImage,
  checkBudget = () => {}, forcedReason, depth = 0,
} = {}) {
  if (!(pageWidth > 0 && pageHeight > 0 && Number.isFinite(pageWidth) && Number.isFinite(pageHeight))) throw new TypeError('Invalid page dimensions');
  if (!Number.isInteger(maxEdge) || maxEdge < 512 || maxEdge > 8192 || typeof resolveImage !== 'function') throw new TypeError('Invalid placement options');
  if (!list || !Array.isArray(list.fnArray) || !Array.isArray(list.argsArray) || list.fnArray.length !== list.argsArray.length
    || list.fnArray.length > MAX_OPERATORS || depth > 8) throw new PlacementError('UNSUPPORTED_OPERATOR_LIST', 'La lista de operadores no es compatible.');
  const records = new Map();
  const stack = [];
  const scale = maxEdge / Math.max(pageWidth, pageHeight);
  let ctm = [...IDENTITY], reasons = forcedReason ? new Set([forcedReason]) : new Set();
  let unresolvedImages = 0, unknownState = false, operatorCount = list.fnArray.length;
  const push = kind => { stack.push({ kind, ctm: [...ctm], reasons: new Set(reasons) }); };
  const pop = kind => {
    const previous = stack.pop();
    if (!previous || previous.kind !== kind) { unknownState = true; reasons.add('unbalancedGraphicsState'); return; }
    ctm = previous.ctm; reasons = previous.reasons;
  };
  const observe = async (id, blocked) => {
    checkBudget();
    const info = await resolveImage(id);
    const ref = normalizeImageRef(info?.ref);
    if (!ref || !(Number.isSafeInteger(info?.width) && Number.isSafeInteger(info?.height)
      && info.width > 0 && info.height > 0 && info.width * info.height <= MAX_IMAGE_PIXELS)) { unresolvedImages++; return; }
    const blockedReasons = new Set(reasons);
    if (blocked) blockedReasons.add(blocked);
    if (unknownState) blockedReasons.add('unknownGraphicsState');
    const width = Math.hypot(ctm[0], ctm[1]) * scale;
    const height = Math.hypot(ctm[2], ctm[3]) * scale;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) blockedReasons.add('degenerateTransform');
    mergeRecord(records, {
      ref, sourceWidth: info.width, sourceHeight: info.height,
      requiredWidth: Number.isFinite(width) ? width : 0, requiredHeight: Number.isFinite(height) ? height : 0,
      uses: 1, pages: new Set([pageNumber]), blockedReasons,
    });
  };
  for (let index = 0; index < list.fnArray.length; index++) {
    if (index % 256 === 0) checkBudget();
    const fn = list.fnArray[index], args = list.argsArray[index] || [];
    if (fn === OPS.save) push('save');
    else if (fn === OPS.restore) pop('save');
    else if (fn === OPS.transform) {
      if (matrix(args)) ctm = multiply(ctm, args);
      else { unknownState = true; reasons.add('invalidTransform'); }
    } else if (fn === OPS.paintFormXObjectBegin) {
      push('form');
      if (args[0] != null) {
        if (matrix(args[0])) ctm = multiply(ctm, args[0]);
        else { unknownState = true; reasons.add('invalidFormMatrix'); }
      }
    } else if (fn === OPS.paintFormXObjectEnd) pop('form');
    else if (fn === OPS.beginGroup) {
      push('group');
      const group = args[0];
      // PDF.js uses group.matrix for bounds/clip, then FormBegin applies the
      // content matrix. Never multiply both. Ambiguous compositing falls back.
      if (!group || (group.matrix && !identity(group.matrix)) || group.smask || group.knockout || group.isGray || group.needsIsolation) {
        reasons.add('complexGroup');
      }
    } else if (fn === OPS.endGroup) pop('group');
    else if (fn === OPS.beginAnnotation) { push('annotation'); reasons.add('annotation'); unknownState = true; }
    else if (fn === OPS.endAnnotation) pop('annotation');
    else if (fn === OPS.paintImageXObject) await observe(args[0]);
    else if (fn === OPS.paintImageXObjectRepeat) await observe(args[0], 'repeat');
    else if (fn === OPS.paintInlineImageXObject || fn === OPS.paintInlineImageXObjectGroup) {
      // Inline images are not indirect objects and are never candidates in the
      // PDF optimizer. If PDF.js retained a ref, block that ref conservatively.
      if (args[0]?.ref) await observe(args[0], 'inlineOrGroupedImage');
    } else if (fn === OPS.setFillColorN || fn === OPS.setStrokeColorN) {
      if (args[0] === 'TilingPattern') {
        const nested = await inspectImageOperatorList(args[2], {
          pageNumber, pageWidth, pageHeight, maxEdge, resolveImage, checkBudget, forcedReason: 'tilingPattern', depth: depth + 1,
        });
        operatorCount += nested.operatorCount; unresolvedImages += nested.unresolvedImages;
        if (operatorCount > MAX_OPERATORS) throw new PlacementError('OPERATOR_LIMIT', 'Demasiados operadores PDF.');
        for (const record of nested.images.values()) mergeRecord(records, record);
      }
    }
  }
  if (stack.length || unknownState) for (const record of records.values()) record.blockedReasons.add('unknownGraphicsState');
  return { images: records, unresolvedImages, operatorCount };
}

/** Return safe per-reference target boxes, preserving source ratio and all uses. */
function limitsFor(records, maxEdge) {
  const limits = new Map();
  for (const image of records.values()) {
    if (image.blockedReasons.size) continue;
    const wanted = Math.max(image.requiredWidth / image.sourceWidth, image.requiredHeight / image.sourceHeight);
    const ratio = Math.min(1, wanted, maxEdge / Math.max(image.sourceWidth, image.sourceHeight));
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    limits.set(image.ref, {
      width: Math.max(1, Math.min(maxEdge, Math.ceil(image.sourceWidth * ratio - 1e-9))),
      height: Math.max(1, Math.min(maxEdge, Math.ceil(image.sourceHeight * ratio - 1e-9))),
    });
  }
  return limits;
}

/**
 * Audit only. Does not rewrite the PDF or connect to the production endpoint.
 * A partial/timed-out/unresolved audit returns an empty imageLimits map so an
 * optional caller must retain its existing global cap for every image.
 */
export async function auditPDFPlacements(input, {
  maxEdge = 2560, maxPages = MAX_PLACEMENT_PAGES, timeoutMs = MAX_PLACEMENT_TIME_MS, pageNumbers,
} = {}) {
  if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > MAX_INPUT_BYTES) throw new TypeError('Expected PDF bytes between 1 byte and 300 MiB');
  if (!Number.isInteger(maxEdge) || maxEdge < 512 || maxEdge > 8192) throw new TypeError('maxEdge must be an integer from 512 to 8192');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PLACEMENT_PAGES) throw new TypeError('maxPages must be an integer from 1 to 200');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_PLACEMENT_TIME_MS) throw new TypeError('timeoutMs must be from 1 to 90000');
  if (pageNumbers !== undefined && (!Array.isArray(pageNumbers) || !pageNumbers.length || !pageNumbers.every(n => Number.isInteger(n) && n > 0))) throw new TypeError('Invalid pageNumbers');
  const started = Date.now(), deadline = started + timeoutMs;
  const checkBudget = () => { if (Date.now() >= deadline) throw new PlacementError('PLACEMENT_TIMEOUT', 'La auditoría alcanzó su límite de tiempo.'); };
  const withinBudget = async promise => {
    checkBudget(); let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new PlacementError('PLACEMENT_TIMEOUT', 'La auditoría alcanzó su límite de tiempo.')), Math.max(1, deadline - Date.now()));
      })]);
    } finally { clearTimeout(timer); }
  };
  const records = new Map(), warnings = [];
  const stats = { totalPages: 0, pagesAudited: 0, imageUses: 0, uniqueImages: 0, limitedImages: 0, blockedImages: 0, unresolvedImages: 0, operators: 0, timedOut: false, elapsedMs: 0 };
  let complete = false;
  const task = getDocument({
    data: new Uint8Array(input), verbosity: VerbosityLevel.ERRORS, isEvalSupported: false,
    useWorkerFetch: false, useSystemFonts: false, disableFontFace: true, useWasm: false,
    isOffscreenCanvasSupported: false, isImageDecoderSupported: false, maxImageSize: MAX_IMAGE_PIXELS,
  });
  let document;
  try {
    document = await withinBudget(task.promise);
    stats.totalPages = document.numPages;
    if (document.numPages > maxPages) throw new PlacementError('PLACEMENT_PAGE_LIMIT', 'El PDF supera el límite de páginas de auditoría.');
    const pages = pageNumbers ? [...new Set(pageNumbers)].sort((a, b) => a - b) : Array.from({ length: document.numPages }, (_, index) => index + 1);
    if (pages.some(n => n > document.numPages)) throw new TypeError('pageNumbers contains a missing page');
    for (const number of pages) {
      checkBudget(); let page;
      try {
        page = await withinBudget(document.getPage(number));
        const list = await withinBudget(page.getOperatorList());
        const [left, bottom, right, top] = page.view;
        const metadata = new Map();
        const resolveImage = async id => {
          if (id && typeof id === 'object') return { ref: id.ref, width: id.width, height: id.height };
          if (typeof id !== 'string') return undefined;
          if (!metadata.has(id)) {
            const store = id.startsWith('g_') ? page.commonObjs : page.objs;
            const object = await withinBudget(new Promise(resolve => store.get(id, resolve)));
            metadata.set(id, object ? { ref: object.ref, width: object.width, height: object.height } : undefined);
          }
          return metadata.get(id);
        };
        const inspected = await inspectImageOperatorList(list, {
          pageNumber: number, pageWidth: right - left, pageHeight: top - bottom, maxEdge, resolveImage, checkBudget,
        });
        for (const record of inspected.images.values()) mergeRecord(records, record);
        stats.unresolvedImages += inspected.unresolvedImages;
        stats.operators += inspected.operatorCount;
        stats.pagesAudited++;
      } finally {
        // Keep only ref/size metadata; release decoded pixel buffers each page.
        if (page) page.cleanup();
        try { await document.cleanup(); }
        catch { throw new PlacementError('PLACEMENT_CLEANUP_FAILED', 'No se pudieron liberar los datos de una página.'); }
      }
    }
    complete = pages.length === document.numPages && stats.unresolvedImages === 0;
    if (pages.length !== document.numPages) warnings.push('partialPageCoverage');
    if (stats.unresolvedImages) warnings.push('unresolvedImageUses');
  } catch (error) {
    if (error instanceof PlacementError) {
      stats.timedOut = error.code === 'PLACEMENT_TIMEOUT'; warnings.push(error.code);
    } else throw error;
  } finally {
    await task.destroy();
    stats.elapsedMs = Date.now() - started;
  }
  const imageLimits = complete ? limitsFor(records, maxEdge) : new Map();
  const images = [...records.values()].map(image => ({
    ref: image.ref, sourceWidth: image.sourceWidth, sourceHeight: image.sourceHeight,
    requiredWidth: Math.ceil(image.requiredWidth), requiredHeight: Math.ceil(image.requiredHeight),
    uses: image.uses, pages: [...image.pages].sort((a, b) => a - b), blockedReasons: [...image.blockedReasons],
    target: imageLimits.get(image.ref),
  }));
  stats.uniqueImages = images.length;
  stats.imageUses = images.reduce((sum, image) => sum + image.uses, 0);
  stats.blockedImages = images.filter(image => image.blockedReasons.length).length;
  stats.limitedImages = imageLimits.size;
  return { complete, imageLimits, images, stats, warnings };
}
