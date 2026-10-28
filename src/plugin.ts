import { cappedRasterSize } from './geometry';
import { auditImageLayers, type AuditNode } from './occlusion';
import { isLanguagePreference, isPluginLocale, pluginText, translateKnownPluginMessage, type LanguagePreference, type PluginLocale, type PluginTextKey } from './plugin-i18n';

declare const __html__: string;

type Scope = 'selection' | 'page';
type ExportMode = 'compact' | 'hybrid' | 'native';
type ExportNode = SceneNode & ExportMixin & LayoutMixin;
type Message = Record<string, unknown>;

interface ExportStats {
  optimizedImages: number;
  skippedImages: number;
  originalImageBytes: number;
  optimizedImageBytes: number;
  warnings: string[];
}

interface PendingReply {
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Job {
  id: string;
  page: PageNode;
  cancelled: boolean;
  pending: Map<string, PendingReply>;
  stats: ExportStats;
}

class CancelledError extends Error {
  constructor() {
    super(text('cancelled'));
    this.name = 'CancelledError';
  }
}

const MAX_PAGES = 200;
const REPLY_TIMEOUT_MS = 180_000;
const MAX_WARNINGS = 16;
const PAGE_ROOT_TYPES = new Set(['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET']);
let activeJob: Job | null = null;
let scope: Scope = 'selection';
let activeAuditRequest: string | null = null;
let activeAuditGeneration = 0;
let pendingFocusSelection: string | null = null;
let locale: PluginLocale = 'en';
let languagePreference: LanguagePreference = 'auto';
let languagePreferenceLoaded = false;
let languagePreferenceRevision = 0;
let languageWrites: Promise<void> = Promise.resolve();
const LANGUAGE_STORAGE_KEY = 'pluma-language';
const jpegOpacityCache = new Map<string, Promise<boolean>>();

figma.showUI(__html__, { width: 460, height: 800, themeColors: true });

function post(message: Message): void {
  figma.ui.postMessage(message);
}

function record(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(key: PluginTextKey, values: Record<string, string | number> = {}): string {
  return pluginText(locale, key, values);
}

function messageError(error: unknown): string {
  return translateKnownPluginMessage(locale, error instanceof Error ? error.message : String(error));
}

function warn(job: Job, warning: string): void {
  if (job.stats.warnings.length < MAX_WARNINGS && !job.stats.warnings.includes(warning)) {
    job.stats.warnings.push(warning);
  }
}

function isExportNode(node: BaseNode): node is ExportNode {
  return node.type !== 'DOCUMENT' && node.type !== 'PAGE' && node.type !== 'SECTION'
    && 'exportAsync' in node && 'absoluteTransform' in node && 'width' in node && 'height' in node
    && Number.isFinite(node.width) && Number.isFinite(node.height) && node.width > 0 && node.height > 0;
}

function expandSections(nodes: readonly SceneNode[], pageScope: boolean): ExportNode[] {
  const result: ExportNode[] = [];
  const stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (node.removed || (pageScope && !node.visible)) continue;
    if (node.type === 'SECTION') {
      for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
    }
    else if (isExportNode(node) && (!pageScope || PAGE_ROOT_TYPES.has(node.type))) result.push(node);
  }
  return result;
}

function withoutAncestorDuplicates(nodes: ExportNode[]): ExportNode[] {
  const ids = new Set(nodes.map(node => node.id));
  const emitted = new Set<string>();
  return nodes.filter(node => {
    if (emitted.has(node.id)) return false;
    emitted.add(node.id);
    let parent = node.parent;
    while (parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') {
      if (ids.has(parent.id)) return false;
      parent = parent.parent;
    }
    return true;
  });
}

function canvasPosition(node: ExportNode): { x: number; y: number } {
  const bounds = node.absoluteBoundingBox;
  if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) return { x: bounds.x, y: bounds.y };
  // Hidden layers may have no bounds. Translation remains in page coordinates.
  const transform = node.absoluteTransform;
  return { x: transform[0][2], y: transform[1][2] };
}

function canvasOrdered(nodes: ExportNode[]): Array<{ node: ExportNode; x: number; y: number }> {
  // Figma documents native multi-page PDFs as top-left to bottom-right:
  // https://www.figma.com/blog/our-path-to-creating-the-highest-quality-pdf-exporter/
  // Compare absolute top, then left. Do not invent fuzzy row grouping: exact
  // rows match the brandbook, and ties preserve the source list's stable order.
  return nodes.map((node, index) => ({ node, index, ...canvasPosition(node) }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index);
}

function publishFrames(): void {
  if (activeJob) return;
  const nodes = scope === 'selection' ? figma.currentPage.selection : figma.currentPage.children;
  const frames = canvasOrdered(withoutAncestorDuplicates(expandSections(nodes, scope === 'page')));
  post({
    type: 'frames',
    frames: frames.map(({ node, x, y }) => ({ id: node.id, name: node.name, width: node.width, height: node.height, x, y })),
    documentName: figma.root.name,
    pageName: figma.currentPage.name,
    orderPolicy: 'canvas-top-to-bottom-left-to-right',
  });
}

function ensureActive(job: Job): void {
  if (job.cancelled || activeJob !== job) throw new CancelledError();
}

function cancel(job: Job): void {
  job.cancelled = true;
  for (const pending of job.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new CancelledError());
  }
  job.pending.clear();
}

function waitForReply(job: Job, key: string, outgoing: Message): Promise<Message> {
  ensureActive(job);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      job.pending.delete(key);
      reject(new Error(text('replyTimeout')));
    }, REPLY_TIMEOUT_MS);
    job.pending.set(key, { resolve, reject, timer });
    try {
      post(outgoing);
    } catch (error) {
      clearTimeout(timer);
      job.pending.delete(key);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function resolveReply(message: Message): void {
  const job = activeJob;
  if (!job || job.cancelled || message.jobId !== job.id) return;
  if (message.type !== 'page-ack' || !Number.isInteger(message.index)) return;
  const key = `page:${message.index}`;
  const pending = job.pending.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  job.pending.delete(key);
  if (typeof message.error === 'string' && message.error.length) pending.reject(new Error(message.error));
  else pending.resolve(message);
}

function progress(job: Job, messageKey: PluginTextKey, messageParams: Record<string, string | number>, current: number, total: number): void {
  ensureActive(job);
  post({ type: 'progress', jobId: job.id, label: text(messageKey, messageParams), messageKey, messageParams, current, total });
}

function pageOf(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current?.type === 'PAGE' ? current : null;
}

function exportDimensions(node: ExportNode): { width: number; height: number } {
  // useAbsoluteBounds exports the bounding rectangle after rotation. Use the
  // same rectangle for the raster PDF page so a rotated layer is not stretched.
  const bounds = node.absoluteBoundingBox;
  if (bounds && bounds.width > 0 && bounds.height > 0) return { width: bounds.width, height: bounds.height };
  return { width: node.width, height: node.height };
}

function validatedRequest(message: Message): { ids: string[]; mode: ExportMode; scale: number; quality: number } {
  if (!Array.isArray(message.ids) || !message.ids.length || message.ids.length > MAX_PAGES
    || !message.ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128)) {
    throw new Error(text('pageCount', { max: MAX_PAGES }));
  }
  if (message.mode !== 'compact' && message.mode !== 'hybrid' && message.mode !== 'native') {
    throw new Error(text('invalidMode'));
  }
  if (typeof message.scale !== 'number' || !Number.isFinite(message.scale) || message.scale <= 0 || message.scale > 8) {
    throw new Error(text('invalidScale'));
  }
  if (typeof message.quality !== 'number' || !Number.isInteger(message.quality) || message.quality < 40 || message.quality > 100) {
    throw new Error(text('invalidQuality'));
  }
  return { ids: [...new Set(message.ids as string[])], mode: message.mode, scale: message.scale, quality: message.quality };
}

async function exportDocument(message: Message): Promise<void> {
  const jobId = typeof message.jobId === 'string' ? message.jobId : '';
  if (!jobId || jobId.length > 128) {
    post({ type: 'error', jobId, message: text('invalidJobId') });
    return;
  }
  if (activeJob) {
    post({ type: 'error', jobId, message: text('busy') });
    return;
  }
  const job: Job = {
    id: jobId, page: figma.currentPage, cancelled: false, pending: new Map(),
    stats: { optimizedImages: 0, skippedImages: 0, originalImageBytes: 0, optimizedImageBytes: 0, warnings: [] },
  };
  activeJob = job;
  try {
    const { ids, mode, scale } = validatedRequest(message);
    // Resolve and validate the complete snapshot before emitting any page.
    const nodes: ExportNode[] = [];
    for (const id of ids) {
      ensureActive(job);
      const node = await figma.getNodeByIdAsync(id);
      ensureActive(job);
      if (!node || node.removed || !isExportNode(node) || pageOf(node)?.id !== job.page.id) {
        throw new Error(text('missingLayer'));
      }
      nodes.push(node);
    }
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      ensureActive(job);
      if (node.removed) throw new Error(text('removedLayer'));
      progress(job, 'exporting', { name: node.name }, index + 1, nodes.length);
      const dimensions = exportDimensions(node);
      const size = cappedRasterSize(dimensions.width, dimensions.height, scale);
      if (mode === 'compact' && size.scale < scale - 1e-6) {
        warn(job, text('rasterLimit'));
      }
      const bytes = mode === 'compact'
        ? await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: size.scale }, contentsOnly: true, useAbsoluteBounds: true, colorProfile: 'SRGB' })
        : await node.exportAsync({ format: 'PDF', contentsOnly: true, useAbsoluteBounds: true, colorProfile: 'SRGB' });
      ensureActive(job);
      await waitForReply(job, `page:${index}`, {
        type: 'page', jobId: job.id, index, total: nodes.length, id: node.id, name: node.name,
        width: dimensions.width, height: dimensions.height, format: mode === 'compact' ? 'png' : 'pdf', bytes,
      });
    }
    ensureActive(job);
    post({
      type: 'done', jobId: job.id, stats: { ...job.stats, warnings: job.stats.warnings.map(warning => translateKnownPluginMessage(locale, warning)) },
      // IDs arrive in the UI's reviewed order. Never sort them during export.
      pageOrder: nodes.map((node, index) => ({ index, id: node.id, name: node.name })),
    });
  } catch (error) {
    if (error instanceof CancelledError || job.cancelled) post({ type: 'cancelled', jobId: job.id });
    else post({ type: 'error', jobId: job.id, message: messageError(error) });
  } finally {
    for (const pending of job.pending.values()) clearTimeout(pending.timer);
    job.pending.clear();
    if (activeJob === job) activeJob = null;
  }
}

async function verifiedJpeg(hash: string, deadline: number): Promise<boolean> {
  if (Date.now() >= deadline) return false;
  let cached = jpegOpacityCache.get(hash);
  if (!cached) {
    cached = (async () => {
      try {
        const image = figma.getImageByHash(hash);
        if (!image) return false;
        const bytes = await image.getBytesAsync();
        // JPEG has no alpha channel. Cache only this fact, never the image bytes.
        return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      } catch { return false; }
    })();
    if (jpegOpacityCache.size >= 256) jpegOpacityCache.delete(jpegOpacityCache.keys().next().value!);
    jpegOpacityCache.set(hash, cached);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([cached, new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), Math.max(1, deadline - Date.now()));
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

async function auditLayers(message: Message): Promise<void> {
  const requestId = typeof message.requestId === 'string' ? message.requestId : '';
  if (!requestId || requestId.length > 128) return;
  const generation = ++activeAuditGeneration;
  activeAuditRequest = requestId;
  const pageId = figma.currentPage.id, deadline = Date.now() + 10_000;
  const checkCurrent = (): void => {
    if (activeAuditRequest !== requestId || activeAuditGeneration !== generation || figma.currentPage.id !== pageId) throw new CancelledError();
    if (Date.now() >= deadline) throw new Error(text('auditTimeout'));
  };
  try {
    if (activeJob) throw new Error(text('auditBusy'));
    if (!Array.isArray(message.ids) || !message.ids.length || message.ids.length > MAX_PAGES
      || !message.ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128)) {
      throw new Error(text('auditPageCount'));
    }
    const roots: ExportNode[] = [];
    for (const id of new Set(message.ids as string[])) {
      checkCurrent(); const node = await figma.getNodeByIdAsync(id); checkCurrent();
      if (!node || node.removed || !isExportNode(node) || pageOf(node)?.id !== pageId) throw new Error(text('auditMissingPage'));
      roots.push(node);
    }
    const result = await auditImageLayers(roots as unknown as AuditNode[], { deadline, checkCurrent, isJpegOpaque: verifiedJpeg });
    checkCurrent();
    post({ type: 'layer-audit', requestId, ...result,
      candidates: result.candidates.map(candidate => ({ ...candidate, reason: translateKnownPluginMessage(locale, candidate.reason) })),
      warnings: result.warnings.map(warning => translateKnownPluginMessage(locale, warning)),
    });
  } catch (error) {
    if (activeAuditRequest === requestId && activeAuditGeneration === generation && !(error instanceof CancelledError)) {
      post({ type: 'layer-audit', requestId, candidates: [], scannedImages: 0, error: messageError(error), warnings: [] });
    }
  } finally { if (activeAuditRequest === requestId && activeAuditGeneration === generation) activeAuditRequest = null; }
}

async function focusNode(message: Message): Promise<void> {
  if (activeJob || typeof message.id !== 'string' || message.id.length > 128) return;
  const node = await figma.getNodeByIdAsync(message.id);
  if (!node || node.removed || !isExportNode(node) || pageOf(node)?.id !== figma.currentPage.id) return;
  const selected = figma.currentPage.selection;
  if (selected.length !== 1 || selected[0].id !== node.id) {
    pendingFocusSelection = node.id;
    try { figma.currentPage.selection = [node]; }
    catch { pendingFocusSelection = null; return; }
  }
  figma.viewport.scrollAndZoomIntoView([node]);
}

function setLanguage(message: Message): void {
  if (!isPluginLocale(message.locale)) return;
  locale = message.locale;
  if (!isLanguagePreference(message.preference)) return;
  languagePreference = message.preference;
  languagePreferenceLoaded = true;
  languagePreferenceRevision++;
  const preference = languagePreference;
  // Serialize saves so a slower old write cannot replace the latest choice.
  languageWrites = languageWrites.then(async () => {
    try { await figma.clientStorage.setAsync(LANGUAGE_STORAGE_KEY, preference); }
    catch { /* Storage failures must never block exporting or language use. */ }
  });
}

async function getLanguagePreference(message: Message): Promise<void> {
  if (typeof message.requestId !== 'string' || !message.requestId || message.requestId.length > 128) return;
  const revision = languagePreferenceRevision;
  if (!languagePreferenceLoaded) {
    let stored: unknown;
    try { stored = await figma.clientStorage.getAsync(LANGUAGE_STORAGE_KEY); }
    catch { /* Use automatic detection if storage is unavailable. */ }
    if (revision === languagePreferenceRevision) {
      if (isLanguagePreference(stored)) languagePreference = stored;
      languagePreferenceLoaded = true;
    }
  }
  post({ type: 'language-preference', requestId: message.requestId, preference: languagePreference });
}

figma.ui.onmessage = (message: unknown): void => {
  if (!record(message)) return;
  if (message.type === 'set-language') {
    setLanguage(message);
  } else if (message.type === 'get-language') {
    void getLanguagePreference(message);
  } else if (message.type === 'open-install-guide') {
    figma.openExternal('https://github.com/charliezstong/pluma-pdf/releases/latest');
  } else if (message.type === 'refresh') {
    activeAuditRequest = null;
    if (message.scope === 'selection' || message.scope === 'page') scope = message.scope;
    publishFrames();
  } else if (message.type === 'export') {
    activeAuditRequest = null;
    void exportDocument(message);
  } else if (message.type === 'audit-layers') {
    void auditLayers(message);
  } else if (message.type === 'focus-node') {
    void focusNode(message);
  } else if (message.type === 'page-ack') {
    resolveReply(message);
  } else if (message.type === 'cancel' && activeJob && message.jobId === activeJob.id) {
    cancel(activeJob);
  }
};

figma.on('selectionchange', () => {
  if (pendingFocusSelection) {
    const expected = pendingFocusSelection; pendingFocusSelection = null;
    if (figma.currentPage.selection.length === 1 && figma.currentPage.selection[0].id === expected) return;
  }
  // A canvas selection cannot change page scope. Republishing it would reset
  // reviewed pages and discard their measured PDFs in the UI.
  if (scope === 'selection') publishFrames();
});
figma.on('currentpagechange', () => {
  activeAuditRequest = null; pendingFocusSelection = null;
  if (activeJob) cancel(activeJob);
  else publishFrames();
});
figma.on('close', () => {
  activeAuditRequest = null; pendingFocusSelection = null;
  if (!activeJob) return;
  cancel(activeJob);
});

publishFrames();
