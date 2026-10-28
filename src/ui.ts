import { PDFDocument, rgb } from 'pdf-lib';
import { renderPdf } from './pdf-preview';
import { compareRenderedImages, type RenderedImageDiff } from './visual-diff';

type Mode = 'hybrid' | 'compact' | 'native';
type View = 'before' | 'after' | 'compare';
type SortOrder = 'canvas' | 'name' | 'manual';
type Settings = { mode: Mode; quality: number; maxEdge: number };
type Variant = { bytes: Uint8Array; optimized: number; skipped: number; unchanged: boolean };
type Frame = { id: string; name: string; width: number; height: number; selected: boolean; original?: Uint8Array; variants: Map<string, Variant>; thumb?: string };
type Job = { id: string; ids: string[]; missingIds: string[]; settings: Settings; key: string; abort: AbortController; cancelled: boolean; controllerActive: boolean; processed: number; finalizing: boolean };
type Output = { bytes: Uint8Array; originalBytes: number; ids: string[]; key: string; optimized: number; skipped: number };
type Preview = { before: string; after?: string; diff?: RenderedImageDiff };
type LayerCandidate = { id: string; coverId: string; frameId: string; frameName: string; name: string; coverName: string; reason: string; confidence: string };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const demo = parent === window;
const presets = { share: { maxEdge: 1920, quality: 68 }, balanced: { maxEdge: 2560, quality: 82 }, crisp: { maxEdge: 3840, quality: 92 } };
let frames: Frame[] = [];
let canvasIds: string[] = [];
let manualIds: string[] = [];
let sortOrder: SortOrder = 'canvas';
let scope: 'selection' | 'page' = 'selection';
let mode: Mode = 'hybrid';
let activeFrameId = '';
let engine = false;
let busy = false;
let review = false;
let job: Job | null = null;
let output: Output | null = null;
let outputUrl = '';
let view: View = 'compare';
let previewGeneration = 0;
let previewKey = '';
let previewReady = false;
let previewHasAfter = false;
let sourceGeneration = 0;
let thumbnailQueue = Promise.resolve();
let visibleDiff: RenderedImageDiff | undefined;
let layerRequestId = '';
let layerRequestTimer: ReturnType<typeof setTimeout> | undefined;
let layerCandidates: LayerCandidate[] = [];
const previews = new Map<string, Preview>();
const thumbnailPending = new Set<string>();
const MAX_CACHE_BYTES = 450 * 1024 * 1024;
const MAX_VARIANTS_PER_FRAME = 2;
function cacheBytes(extra?: Uint8Array): number {
  const seen = new Set<ArrayBufferLike>(); let total = 0;
  const add = (bytes: Uint8Array | undefined) => { if (bytes && !seen.has(bytes.buffer)) { seen.add(bytes.buffer); total += bytes.buffer.byteLength; } };
  frames.forEach(frame => { add(frame.original); frame.variants.forEach(variant => add(variant.bytes)); });
  add(extra); return total;
}
function guardCache(extra: Uint8Array): void { if (cacheBytes(extra) > MAX_CACHE_BYTES) throw new Error('Esta selección supera el límite de memoria de 450 MB. Actualiza con ↻ y analiza un grupo más pequeño de páginas.'); }
function storeVariant(frame: Frame, key: string, variant: Variant): void {
  while (frame.variants.size >= MAX_VARIANTS_PER_FRAME && !frame.variants.has(key)) { const oldest = [...frame.variants.keys()].find(value => value !== key); if (!oldest) break; frame.variants.delete(oldest); }
  guardCache(variant.bytes); frame.variants.set(key, variant);
}

function settings(): Settings { return { mode, quality: Number($<HTMLInputElement>('quality').value), maxEdge: Number($<HTMLSelectElement>('max-edge').value) }; }
function settingsKey(value = settings()): string { return value.mode === 'native' ? 'native' : `${value.mode}:${value.quality}:${value.maxEdge}`; }
function selectedFrames(): Frame[] { return frames.filter(frame => frame.selected); }
function orderByIds(ids: string[]): void {
  const positions = new Map(ids.map((id, index) => [id, index]));
  frames.sort((a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}
function applySort(order: SortOrder): void {
  sortOrder = order;
  if (order === 'name') frames.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  else orderByIds(order === 'canvas' ? canvasIds : manualIds);
  invalidateOutput(); render();
}
function currentFrame(): Frame | undefined { return frames.find(frame => frame.id === activeFrameId) ?? frames[0]; }
function bytesText(bytes: number): string { return bytes < 1_000_000 ? `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB` : `${(bytes / 1_000_000).toFixed(2)} MB`; }
function deltaText(before: number, after: number): string { const value = (1 - after / before) * 100; return `${Math.abs(value) < .05 ? '' : value < 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`; }
function pdfBlob(bytes: Uint8Array): Blob { return new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' }); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function showError(message: string): void { $('error').textContent = message; $('error').hidden = false; }
function clearError(): void { $('error').hidden = true; }
function setStatus(label: string, detail = ''): void { $('status-text').textContent = label; $('status-detail').textContent = detail; }
function send(message: Record<string, unknown>): void { if (demo) void demoMessage(message); else parent.postMessage({ pluginMessage: message }, '*'); }
function ensure(active: Job): void { if (job !== active || active.cancelled) throw new Error('Exportación cancelada.'); }
function revokeOutput(): void { if (outputUrl) URL.revokeObjectURL(outputUrl); outputUrl = ''; output = null; }
function isCurrentOutput(): boolean { return Boolean(output && output.key === settingsKey() && output.ids.join('\0') === selectedFrames().map(frame => frame.id).join('\0')); }
function setMeasuredValue(id: string, bytes?: number): void { const node = $(id); node.replaceChildren(); if (bytes === undefined) { node.textContent = '—'; return; } const [value, unit] = bytesText(bytes).split(' '); node.append(document.createTextNode(value)); const suffix = document.createElement('span'); suffix.className = 'unit'; suffix.textContent = unit; node.append(suffix); }

function renderFrames(): void {
  const container = $('frames');
  const scroll = container.scrollTop;
  const horizontalScroll = container.scrollLeft;
  container.replaceChildren();
  const selected = selectedFrames().length;
  $('page-count').textContent = `${selected} / ${frames.length}`;
  $('selection-summary').textContent = `${selected} página${selected === 1 ? '' : 's'} seleccionada${selected === 1 ? '' : 's'}`;
  $('toggle-all').textContent = selected === frames.length && frames.length ? 'Deseleccionar todas' : 'Seleccionar todas';
  const query = $<HTMLInputElement>('page-search').value.trim().toLocaleLowerCase();
  let shown = 0;
  frames.forEach((frame, index) => {
    if (query && !frame.name.toLocaleLowerCase().includes(query)) return;
    shown++;
    const row = document.createElement('div'); row.className = `frame-row${frame.id === activeFrameId ? ' active' : ''}`;
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = frame.selected; checkbox.disabled = busy; checkbox.setAttribute('aria-label', `Incluir ${frame.name}`);
    checkbox.onchange = () => { frame.selected = checkbox.checked; invalidateOutput(); render(); };
    let thumb: HTMLElement;
    if (frame.thumb) { const image = document.createElement('img'); image.src = frame.thumb; image.alt = ''; image.className = 'frame-thumb'; thumb = image; }
    else { thumb = document.createElement('span'); thumb.className = 'frame-thumb frame-thumb-placeholder'; thumb.textContent = String(index + 1).padStart(2, '0'); }
    const open = document.createElement('button'); open.className = 'frame-open'; open.title = frame.name; open.setAttribute('aria-label', `Previsualizar ${frame.name}`);
    open.onclick = () => { activeFrameId = frame.id; render(); };
    const name = document.createElement('span'); name.className = 'frame-name'; name.textContent = frame.name;
    const detail = document.createElement('span'); detail.className = 'frame-detail';
    const variant = frame.variants.get(settingsKey());
    if (frame.original && variant) { detail.classList.add('measured'); detail.append(document.createTextNode(`${bytesText(frame.original.length)} → ${bytesText(variant.bytes.length)}`)); const saving = document.createElement('span'); saving.className = 'row-saving'; saving.textContent = deltaText(frame.original.length, variant.bytes.length); detail.append(saving); }
    else detail.textContent = frame.original ? `${bytesText(frame.original.length)} · original` : `${Math.round(frame.width)} × ${Math.round(frame.height)}`;
    open.append(name, detail);
    const move = document.createElement('div'); move.className = 'row-move';
    [-1, 1].forEach(direction => { const button = document.createElement('button'); button.textContent = direction < 0 ? '↑' : '↓'; button.setAttribute('aria-label', `${direction < 0 ? 'Subir' : 'Bajar'} ${frame.name}`); button.disabled = busy || index + direction < 0 || index + direction >= frames.length; button.onclick = () => { [frames[index], frames[index + direction]] = [frames[index + direction], frames[index]]; manualIds = frames.map(value => value.id); sortOrder = 'manual'; invalidateOutput(); render(); }; move.append(button); });
    row.append(checkbox, thumb, open, move); container.append(row);
  });
  if (!shown) { const empty = document.createElement('div'); empty.className = 'list-empty'; empty.textContent = frames.length ? 'No hay páginas con ese nombre.' : 'Selecciona tus frames en Figma y pulsa ↻ para cargarlos.'; container.append(empty); }
  container.scrollTop = scroll;
  container.scrollLeft = horizontalScroll;
}

function render(): void {
  renderFrames();
  $<HTMLFieldSetElement>('settings').disabled = busy;
  document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('.scope button,#sort,#toggle-all,#settings-open,#fine-open,#engine-check,#new-export,#layer-check').forEach(control => control.disabled = busy);
  $<HTMLSelectElement>('sort').value = sortOrder;
  $<HTMLInputElement>('page-search').disabled = busy;
  $('settings').hidden = review;
  $('result-note').hidden = !review;
  $('step-label').textContent = review ? '02 / REVISAR' : '01 / PREPARAR';
  $('view-title').textContent = review ? 'Revisa el resultado.' : 'Exporta tus páginas.';
  $('export').hidden = busy || (review && isCurrentOutput());
  $('download').hidden = busy || !review || !isCurrentOutput();
  $('cancel').hidden = !busy || Boolean(job?.cancelled);
  $<HTMLButtonElement>('export').disabled = !selectedFrames().length || busy;
  $('progress-track').hidden = !busy;
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.disabled = busy || mode === 'native');
  $('mode-help').textContent = mode === 'hybrid' ? 'Optimiza las imágenes del PDF. Conserva el texto y los vectores.' : mode === 'compact' ? 'Página como imagen. El texto deja de ser seleccionable.' : 'Une los PDF nativos de Figma. No optimiza sus imágenes.';
  $('profile-help').textContent = mode === 'compact' ? 'Límite por página. Revisa el texto antes de descargar.' : mode === 'native' ? 'La calidad del archivo original permanece intacta.' : 'Límite por imagen. El texto conserva su nitidez.';
  const frame = currentFrame(); const variant = frame?.variants.get(settingsKey());
  $('page-metrics').hidden = !frame?.original;
  setMeasuredValue('metric-original', frame?.original?.length);
  setMeasuredValue('metric-after', variant?.bytes.length);
  $('metric-saving').textContent = frame?.original && variant ? deltaText(frame.original.length, variant.bytes.length) : '—';
  $('metric-saving').parentElement!.classList.toggle('neutral', !frame?.original || !variant || variant.bytes.length >= frame.original.length);
  $('preview-page').textContent = frame ? `PÁGINA ${String(frames.indexOf(frame) + 1).padStart(2, '0')}` : 'VISTA PREVIA';
  $('preview-name').textContent = frame?.name ?? 'Tu diseño, antes y después';
  $('preview-counter').textContent = frame ? `${frames.indexOf(frame) + 1} / ${frames.length}` : '—';
  updatePreview(frame, variant);
}

function invalidateOutput(): void { review = false; revokeOutput(); }
function updateSettings(): void {
  invalidateOutput(); clearError();
  const value = settings();
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => { const preset = presets[button.dataset.preset as keyof typeof presets]; const active = preset.quality === value.quality && preset.maxEdge === value.maxEdge; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  render();
  if (frames.some(frame => frame.original)) setStatus('Ajustes actualizados.', 'Vuelve a analizar. Los PDF originales ya están en memoria.');
}
function setView(next: View): void { view = next; applyCompare(); }
function applyCompare(): void {
  const effective = previewHasAfter ? view : 'before';
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => { const active = button.dataset.view === effective; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); button.disabled = !previewReady || (button.dataset.view !== 'before' && !previewHasAfter); });
  const percent = Number($<HTMLInputElement>('compare-slider').value);
  $('preview-after-layer').style.clipPath = effective === 'after' ? 'inset(0)' : effective === 'before' ? 'inset(0 0 0 100%)' : `inset(0 0 0 ${percent}%)`;
  $('compare-divider').style.left = `${percent}%`;
  $('compare-divider').hidden = !previewReady || effective !== 'compare';
  $('compare-control').hidden = !previewReady || effective !== 'compare';
  $('before-tag').hidden = effective === 'after';
  $('after-tag').hidden = effective === 'before';
}
function updatePreview(frame?: Frame, variant?: Variant): void {
  const key = frame?.original ? `${sourceGeneration}:${frame.id}:${variant ? settingsKey() : 'original'}` : '';
  if (key === previewKey) { applyCompare(); return; }
  previewKey = key; const generation = ++previewGeneration;
  visibleDiff = undefined; $<HTMLButtonElement>('visual-check').disabled = true;
  previewReady = false; previewHasAfter = false; applyCompare();
  $('preview-surface').hidden = true;
  $('preview-empty').hidden = Boolean(frame?.original);
  $('preview-loading').hidden = !frame?.original;
  $('preview-caption').textContent = frame?.original ? 'Renderizando el PDF real…' : 'La comparación aparecerá después del análisis.';
  if (!frame?.original) return;
  const original = frame.original;
  void (async () => {
    try {
      let cached = previews.get(key);
      if (!cached) {
        const before = await renderPdf(original, 1500);
        const after = variant ? variant.bytes === original ? before : await renderPdf(variant.bytes, 1500) : undefined;
        cached = { before: before.dataUrl, after: after?.dataUrl };
        previews.set(key, cached);
        while (previews.size > 5) previews.delete(previews.keys().next().value!);
      }
      if (generation !== previewGeneration) return;
      $<HTMLImageElement>('preview-before').src = cached.before;
      $<HTMLImageElement>('preview-after').src = cached.after ?? cached.before;
      previewReady = true; previewHasAfter = Boolean(cached.after);
      $('preview-empty').hidden = true; $('preview-surface').hidden = false; $('preview-loading').hidden = true;
      $('preview-caption').textContent = variant ? mode === 'compact' ? 'PDF real · página rasterizada / texto no seleccionable' : variant.unchanged ? 'PDF real · esta página se conserva sin reducción' : 'PDF real · desliza para comprobar los detalles' : 'PDF original · esperando el análisis';
      applyCompare();
      if (cached.after) {
        try { cached.diff ??= await compareRenderedImages(cached.before, cached.after); }
        catch { return; /* A failed diagnostic must not hide a valid preview. */ }
        if (generation !== previewGeneration) return;
        visibleDiff = cached.diff; $<HTMLButtonElement>('visual-check').disabled = false;
      }
    } catch (error) {
      if (generation !== previewGeneration) return;
      $('preview-loading').hidden = true; $('preview-empty').hidden = false;
      $('preview-caption').textContent = `No se pudo mostrar la vista: ${errorText(error)}`;
      previewReady = false; applyCompare();
    }
  })();
}
function queueThumbnail(frame: Frame): void {
  if (!frame.original || frame.thumb || thumbnailPending.has(frame.id)) return;
  thumbnailPending.add(frame.id); const generation = sourceGeneration; const original = frame.original;
  thumbnailQueue = thumbnailQueue.then(async () => {
    if (generation !== sourceGeneration || frame.original !== original) return;
    try { frame.thumb = (await renderPdf(original, 120)).dataUrl; if (generation === sourceGeneration) renderFrames(); } catch { /* A thumbnail failure must not discard a valid PDF. */ }
  }).finally(() => thumbnailPending.delete(frame.id));
}

async function fetchLocal(path: string, init: RequestInit = {}, timeout = 5000, active?: Job): Promise<Response> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  active?.abort.signal.addEventListener('abort', cancel, { once: true });
  if (active?.abort.signal.aborted) cancel();
  const timer = setTimeout(cancel, timeout);
  try { return await fetch(`http://localhost:3847${path}`, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); active?.abort.signal.removeEventListener('abort', cancel); }
}
async function checkEngine(silent = false): Promise<boolean> {
  $('engine-status').textContent = 'Conectando…';
  try { const response = await fetchLocal('/health', {}, 3500); const data = await response.json(); engine = response.ok && data.name === 'Pluma PDF' && data.engine === 'sharp'; }
  catch { engine = false; }
  $('engine-dot').classList.toggle('connected', engine);
  $('engine-status').textContent = engine ? 'Motor local conectado' : 'Conectar motor local';
  if (!engine && !silent) showError('Inteligente necesita el motor local. Abre «Iniciar motor.command» en la carpeta PlumaPDF y vuelve a conectar. También puedes usar Original o Compacto.');
  else if (engine) clearError();
  return engine;
}
async function optimizedPdf(original: Uint8Array, active: Job): Promise<Variant> {
  const query = new URLSearchParams({ quality: String(active.settings.quality), maxEdge: String(active.settings.maxEdge) });
  const response = await fetchLocal(`/pdf?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Pluma-Client': '1' }, body: pdfBlob(original) }, 120_000, active);
  ensure(active);
  if (!response.ok) { let message = `El motor devolvió un error (${response.status}).`; try { const body = await response.json(); message = body.error?.message || message; } catch { /* Keep the HTTP message. */ } throw new Error(message); }
  const bytes = new Uint8Array(await response.arrayBuffer()); ensure(active);
  if (!bytes.length) throw new Error('El motor devolvió un PDF vacío.');
  const parsed = await PDFDocument.load(bytes); ensure(active);
  const source = await PDFDocument.load(original); ensure(active);
  if (parsed.getPageCount() !== source.getPageCount()) throw new Error('El resultado cambió el número de páginas. Se conservó el original.');
  const count = (name: string) => Math.max(0, Number(response.headers.get(name)) || 0);
  const unchanged = bytes.length >= original.length;
  return { bytes: unchanged ? original : bytes, optimized: unchanged ? 0 : count('X-Pluma-Optimized-Images'), skipped: count('X-Pluma-Skipped-Images'), unchanged };
}
async function canvasJpeg(dataUrl: string, quality: number): Promise<Uint8Array> {
  const image = new Image(); image.src = dataUrl; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d'); if (!context) throw new Error('No se pudo preparar la página.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0);
  try { const encoded = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo comprimir la página.')), 'image/jpeg', quality / 100)); return new Uint8Array(await encoded.arrayBuffer()); }
  finally { canvas.width = canvas.height = 1; }
}
async function compactPdf(original: Uint8Array, active: Job): Promise<Variant> {
  const source = await PDFDocument.load(original); ensure(active);
  if (source.getPageCount() !== 1) throw new Error('Compacto necesita un PDF de una página por frame.');
  const page = source.getPage(0); const dimensions = page.getSize();
  const rendered = await renderPdf(original, Math.max(1, Math.round(active.settings.maxEdge * dimensions.width / Math.max(dimensions.width, dimensions.height)))); ensure(active);
  const jpeg = await canvasJpeg(rendered.dataUrl, active.settings.quality); ensure(active);
  const document = await PDFDocument.create(); const image = await document.embedJpg(jpeg); ensure(active);
  document.addPage([dimensions.width, dimensions.height]).drawImage(image, { x: 0, y: 0, width: dimensions.width, height: dimensions.height });
  const bytes = await document.save({ useObjectStreams: true }); ensure(active);
  return { bytes, optimized: 0, skipped: 0, unchanged: false };
}
async function processFrame(frame: Frame, active: Job): Promise<void> {
  ensure(active); if (!frame.original) throw new Error('Falta el PDF original de una página.');
  setStatus(`${active.settings.mode === 'native' ? 'Preparando' : 'Analizando'} ${frame.name}`, `${active.processed + 1} de ${active.ids.length} páginas · procesamiento local`);
  if (!frame.variants.has(active.key)) {
    const original = frame.original;
    const variant = active.settings.mode === 'native' ? { bytes: original, optimized: 0, skipped: 0, unchanged: true } : active.settings.mode === 'compact' ? await compactPdf(original, active) : await optimizedPdf(original, active);
    ensure(active); storeVariant(frame, active.key, variant);
  }
  active.processed++; $('progress').style.width = `${Math.max(3, active.processed / active.ids.length * 90)}%`;
  queueThumbnail(frame); render();
}
async function mergePdfs(buffers: Uint8Array[], active: Job): Promise<Uint8Array> {
  const document = await PDFDocument.create(); ensure(active);
  document.setTitle($<HTMLInputElement>('filename').value.trim() || 'Pluma PDF'); document.setCreator('Pluma PDF · Local Studio');
  for (const buffer of buffers) { ensure(active); const source = await PDFDocument.load(buffer); ensure(active); const pages = await document.copyPages(source, source.getPageIndices()); ensure(active); pages.forEach(page => document.addPage(page)); }
  const bytes = await document.save({ useObjectStreams: true }); ensure(active); return bytes;
}
async function finalize(active: Job): Promise<void> {
  if (active.finalizing) return; active.finalizing = true;
  try {
    ensure(active); setStatus('Preparando el PDF final…', 'Uniendo páginas y midiendo el resultado.'); $('progress').style.width = '95%';
    const records = active.ids.map(id => { const frame = frames.find(value => value.id === id); if (!frame?.original || !frame.variants.has(active.key)) throw new Error('No se completaron todas las páginas.'); return frame; });
    const originals = records.map(frame => frame.original!); const variants = records.map(frame => frame.variants.get(active.key)!);
    const before = await mergePdfs(originals, active); let after = active.settings.mode === 'native' ? before : await mergePdfs(variants.map(variant => variant.bytes), active); ensure(active);
    if (active.settings.mode === 'hybrid') {
      setStatus('Reutilizando imágenes repetidas…', 'Conservando todas las apariciones y su calidad.');
      const response = await fetchLocal('/pdf/deduplicate', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Pluma-Client': '1' }, body: pdfBlob(after) }, 180_000, active);
      ensure(active);
      if (!response.ok) throw new Error('No se pudo finalizar la deduplicación. Reinicia el motor local y vuelve a analizar.');
      const deduplicated = new Uint8Array(await response.arrayBuffer()); ensure(active);
      const parsed = await PDFDocument.load(deduplicated); ensure(active);
      if (parsed.getPageCount() !== records.length) throw new Error('La deduplicación cambió el número de páginas.');
      if (deduplicated.length < after.length) after = deduplicated;
    }
    revokeOutput(); output = { bytes: after, originalBytes: before.length, ids: [...active.ids], key: active.key, optimized: variants.reduce((sum, variant) => sum + variant.optimized, 0), skipped: variants.reduce((sum, variant) => sum + variant.skipped, 0) };
    outputUrl = URL.createObjectURL(pdfBlob(after));
    $('result-detail').textContent = active.settings.mode === 'compact' ? 'Páginas convertidas en imágenes. El texto deja de ser seleccionable; revisa la comparación.' : active.settings.mode === 'native' ? 'Salida nativa de Figma. Páginas unidas sin recomprimir imágenes.' : `${output.optimized} ${output.optimized === 1 ? 'imagen optimizada' : 'imágenes optimizadas'}. Texto y vectores conservados.${output.skipped ? ` ${output.skipped} ${output.skipped === 1 ? 'imagen conservada' : 'imágenes conservadas'}.` : ''}`;
    setStatus(`${active.ids.length} página${active.ids.length === 1 ? '' : 's'} · ${bytesText(after.length)}`, `${bytesText(before.length)} → ${bytesText(after.length)} · ${deltaText(before.length, after.length)} respecto al PDF original`);
    review = true; busy = false; job = null; render();
  } catch (error) { failJob(active, error); }
}
function finishCancelled(active: Job): void { if (job !== active) return; busy = false; job = null; review = false; setStatus('Análisis cancelado.', 'Los originales leídos siguen en memoria. Puedes volver a analizar.'); render(); }
function failJob(active: Job, error: unknown): void {
  if (job !== active) return;
  if (active.cancelled) { if (!active.controllerActive) finishCancelled(active); return; }
  active.abort.abort(); if (active.controllerActive) send({ type: 'cancel', jobId: active.id });
  active.controllerActive = false; busy = false; job = null; review = false;
  showError(`No se completó el análisis. ${errorText(error)}`); setStatus('El PDF aún no está listo.', 'Revisa el mensaje y vuelve a analizar.'); render();
}
async function startAnalysis(): Promise<void> {
  if (busy || !selectedFrames().length) return;
  clearError(); revokeOutput(); review = false;
  const active: Job = { id: `pluma-${Date.now()}-${Math.random().toString(16).slice(2)}`, ids: selectedFrames().map(frame => frame.id), missingIds: [], settings: settings(), key: settingsKey(), abort: new AbortController(), cancelled: false, controllerActive: false, processed: 0, finalizing: false };
  job = active; busy = true; $('progress').style.width = '2%'; setStatus('Preparando el análisis…', 'Los originales de Figma no se modifican.'); render();
  try {
    if (active.settings.mode === 'hybrid') { const connected = await checkEngine(true); ensure(active); if (!connected) throw new Error('Abre «Iniciar motor.command» en la carpeta PlumaPDF y pulsa «Conectar motor local». Inteligente necesita ese motor para optimizar tus imágenes.'); }
    for (const id of active.ids) { ensure(active); const frame = frames.find(value => value.id === id)!; if (frame.original) await processFrame(frame, active); else active.missingIds.push(id); }
    ensure(active);
    if (active.missingIds.length) { active.controllerActive = true; send({ type: 'export', jobId: active.id, ids: active.missingIds, mode: 'native', quality: active.settings.quality, scale: 2 }); }
    else await finalize(active);
  } catch (error) { failJob(active, error); }
}
async function onMessage(message: any): Promise<void> {
  if (message.type === 'layer-audit' && message.requestId === layerRequestId) {
    clearTimeout(layerRequestTimer);
    layerRequestId = '';
    $<HTMLButtonElement>('layer-audit-refresh').disabled = false;
    layerCandidates = Array.isArray(message.candidates) ? message.candidates : [];
    const warnings = Array.isArray(message.warnings) ? message.warnings.filter((value: unknown) => typeof value === 'string').slice(0, 4).join(' ') : '';
    $('layer-audit-summary').textContent = message.error ? String(message.error) : `${Number(message.scannedImages) || 0} imágenes revisadas · ${layerCandidates.length} coincidencias para revisar. Las capas originales se conservan. ${warnings}`;
    const list = $('layer-findings'); list.replaceChildren();
    for (const candidate of layerCandidates) {
      const item = document.createElement('article'); item.className = 'layer-finding';
      const title = document.createElement('strong'); title.textContent = `${candidate.frameName} · ${candidate.name}`;
      const label = document.createElement('span'); label.className = 'finding-kind'; label.textContent = candidate.confidence === 'geometry-covered' ? 'Cobertura geométrica verificada' : 'Posible superposición';
      const reason = document.createElement('p'); reason.textContent = `${candidate.reason} Capa superior: ${candidate.coverName}.`;
      const button = document.createElement('button'); button.className = 'secondary-button'; button.textContent = 'Ver capa en Figma';
      button.onclick = () => { send({ type: 'focus-node', id: candidate.id }); $<HTMLDialogElement>('layers-dialog').close(); };
      item.append(title, label, reason, button); list.append(item);
    }
    if (!layerCandidates.length && !message.error) { const empty = document.createElement('p'); empty.textContent = 'No se encontraron pares que cumplan el criterio conservador. Esto no demuestra que no existan otras capas tapadas.'; list.append(empty); }
    return;
  }
  if (message.type === 'frames') {
    if (busy) return;
    clearTimeout(layerRequestTimer); layerRequestId = ''; layerCandidates = [];
    $<HTMLButtonElement>('layer-audit-refresh').disabled = false; $('layer-findings').replaceChildren();
    $('layer-audit-summary').textContent = 'Diseño actualizado. Pulsa «Volver a revisar» para analizar esta selección.';
    sourceGeneration++; previews.clear(); thumbnailPending.clear(); previewKey = ''; revokeOutput(); review = false;
    frames = (message.frames || []).map((frame: any) => ({ id: String(frame.id), name: String(frame.name), width: Number(frame.width), height: Number(frame.height), selected: true, variants: new Map<string, Variant>() }));
    canvasIds = frames.map(frame => frame.id); manualIds = [...canvasIds]; sortOrder = 'canvas';
    activeFrameId = frames[0]?.id ?? ''; $<HTMLInputElement>('page-search').value = '';
    if (message.documentName) $<HTMLInputElement>('filename').value = String(message.documentName);
    setStatus(frames.length ? `${frames.length} página${frames.length === 1 ? '' : 's'} disponible${frames.length === 1 ? '' : 's'}.` : 'Selecciona tus frames en Figma.', 'Analiza para ver el PDF original y el resultado real.'); render(); return;
  }
  const active = job; if (!active || message.jobId !== active.id) return;
  if (message.type === 'progress') { if (!active.cancelled) setStatus(message.label, 'Leyendo el PDF nativo de Figma…'); return; }
  if (message.type === 'page') {
    try {
      ensure(active); if (message.format !== 'pdf') throw new Error('Se esperaba el PDF nativo de Figma.');
      const id = active.missingIds[Number(message.index)]; const frame = frames.find(value => value.id === id); if (!frame) throw new Error('No se encontró la página exportada.');
      const original = new Uint8Array(message.bytes); guardCache(original); frame.original = original; frame.variants.clear();
      await processFrame(frame, active); ensure(active); send({ type: 'page-ack', jobId: active.id, index: message.index });
    } catch (error) { send({ type: 'page-ack', jobId: active.id, index: message.index, error: errorText(error) }); if (!active.cancelled) failJob(active, error); }
    return;
  }
  if (message.type === 'done') { active.controllerActive = false; if (active.cancelled) finishCancelled(active); else await finalize(active); return; }
  if (message.type === 'cancelled') { active.controllerActive = false; finishCancelled(active); return; }
  if (message.type === 'error') { active.controllerActive = false; if (active.cancelled) finishCancelled(active); else failJob(active, new Error(String(message.message))); }
}

function refresh(): void { if (busy) return; clearError(); send({ type: 'refresh', scope }); }
$('scope-selection').onclick = () => { scope = 'selection'; updateScope(); refresh(); };
$('scope-page').onclick = () => { scope = 'page'; updateScope(); refresh(); };
function updateScope(): void { ['selection', 'page'].forEach(value => { const button = $(`scope-${value}`); button.classList.toggle('active', scope === value); button.setAttribute('aria-pressed', String(scope === value)); }); }
$('refresh').onclick = refresh;
$('page-search').oninput = renderFrames;
$('toggle-all').onclick = () => { const selected = !frames.length || !frames.every(frame => frame.selected); frames.forEach(frame => frame.selected = selected); invalidateOutput(); render(); };
$<HTMLSelectElement>('sort').onchange = () => {
  const value = $<HTMLSelectElement>('sort').value;
  if (value === 'canvas' || value === 'name' || value === 'manual') applySort(value);
};
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.onclick = () => { mode = button.dataset.mode as Mode; document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); updateSettings(); });
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.onclick = () => { const preset = presets[button.dataset.preset as keyof typeof presets]; $<HTMLSelectElement>('max-edge').value = String(preset.maxEdge); $<HTMLInputElement>('quality').value = String(preset.quality); $('quality-value').textContent = `${preset.quality}%`; updateSettings(); });
$('quality').oninput = () => { $('quality-value').textContent = `${$<HTMLInputElement>('quality').value}%`; updateSettings(); };
$('max-edge').onchange = updateSettings;
$('filename').onchange = () => { if (output) setStatus(`${output.ids.length} páginas · ${bytesText(output.bytes.length)}`, 'Nombre actualizado. El PDF está listo para descargar.'); };
$('engine-check').onclick = () => void checkEngine();
$('engine-install').onclick = () => send({ type: 'open-install-guide' });
$('export').onclick = () => void startAnalysis();
$('cancel').onclick = () => { const active = job; if (!active) return; active.cancelled = true; active.abort.abort(); setStatus('Cancelando el análisis…', 'Esperando a que termine la lectura en curso.'); if (active.controllerActive) send({ type: 'cancel', jobId: active.id }); else finishCancelled(active); render(); };
$('download').onclick = () => { if (!outputUrl || !isCurrentOutput()) return; const name = $<HTMLInputElement>('filename').value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/\.pdf$/i, '') || 'pluma'; const anchor = document.createElement('a'); anchor.href = outputUrl; anchor.download = `${name}.pdf`; document.body.append(anchor); anchor.click(); anchor.remove(); };
$('new-export').onclick = () => { review = false; render(); setStatus('Ajusta y vuelve a analizar.', 'Los PDF originales ya están en memoria. No hace falta exportarlos otra vez.'); };
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.onclick = () => setView(button.dataset.view as View));
$('compare-slider').oninput = applyCompare;
const stage = $('preview-stage');
function dragCompare(event: PointerEvent): void { const bounds = $('preview-surface').getBoundingClientRect(); if (!bounds.width) return; $<HTMLInputElement>('compare-slider').value = String(Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100))); applyCompare(); }
stage.onpointerdown = event => { if (!previewReady || !previewHasAfter || view !== 'compare') return; event.preventDefault(); stage.setPointerCapture(event.pointerId); dragCompare(event); };
stage.onpointermove = event => { if (stage.hasPointerCapture(event.pointerId)) dragCompare(event); };
stage.onpointerup = event => { if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId); };
$<HTMLImageElement>('preview-before').draggable = false; $<HTMLImageElement>('preview-after').draggable = false;
function openFine(): void { $<HTMLDialogElement>('fine-dialog').showModal(); }
$('fine-open').onclick = openFine; $('settings-open').onclick = openFine;
$('fine-close').onclick = () => $<HTMLDialogElement>('fine-dialog').close(); $('fine-done').onclick = () => $<HTMLDialogElement>('fine-dialog').close();
$('help').onclick = () => $<HTMLDialogElement>('guide').showModal(); $('close-guide').onclick = () => $<HTMLDialogElement>('guide').close();
$('visual-check').onclick = () => {
  if (!visibleDiff) return;
  const d = visibleDiff;
  $('visual-summary').textContent = d.identical ? `Píxeles idénticos a ${d.width} × ${d.height} px.` : `${d.changedPixelsPercent.toFixed(2)}% de píxeles con diferencias mayores a 8/255 · diferencia media ${d.meanAbsoluteError.toFixed(3)}/255.`;
  $('visual-resolution').textContent = `Comparación determinista de las vistas del PDF a ${d.width} × ${d.height} px. Negro = sin diferencias; los cambios se amplifican ×4. JPEG puede cambiar píxeles sin eliminar contenido. Esta vista no certifica calidad de impresión ni píxeles a otras resoluciones.`;
  $<HTMLImageElement>('visual-difference').src = d.differenceDataUrl;
  $<HTMLDialogElement>('visual-dialog').showModal();
};
$('visual-close').onclick = () => $<HTMLDialogElement>('visual-dialog').close();
function auditLayers(): void {
  if (busy || layerRequestId || !selectedFrames().length) return;
  layerRequestId = `layers-${Date.now()}`; $('layer-audit-summary').textContent = 'Revisando posición, tamaño, orden de capas y opacidad…'; $('layer-findings').replaceChildren();
  $<HTMLButtonElement>('layer-audit-refresh').disabled = true;
  const requestId = layerRequestId;
  layerRequestTimer = setTimeout(() => {
    if (layerRequestId !== requestId) return;
    layerRequestId = ''; $<HTMLButtonElement>('layer-audit-refresh').disabled = false;
    $('layer-audit-summary').textContent = 'La revisión tardó demasiado. Puedes volver a intentarlo con menos páginas.';
  }, 20_000);
  send({ type: 'audit-layers', requestId: layerRequestId, ids: selectedFrames().map(frame => frame.id) });
}
$('layer-check').onclick = () => { $<HTMLDialogElement>('layers-dialog').showModal(); auditLayers(); };
$('layer-audit-refresh').onclick = auditLayers;
$('layers-close').onclick = () => $<HTMLDialogElement>('layers-dialog').close();
document.querySelector('.brand')?.addEventListener('click', event => event.preventDefault());
window.addEventListener('message', event => { const message = event.data?.pluginMessage; if (message && typeof message === 'object' && typeof message.type === 'string') void onMessage(message); });
window.addEventListener('unload', () => { job?.abort.abort(); if (outputUrl) URL.revokeObjectURL(outputUrl); });

// Standalone preview only. These are actual generated PDFs, clearly labelled as demo pages.
async function demoPdf(index: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas'); canvas.width = 2200; canvas.height = 1450; const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 2200, 1450); gradient.addColorStop(0, '#acd5e8'); gradient.addColorStop(.5, '#6a88ac'); gradient.addColorStop(1, '#233d65'); context.fillStyle = gradient; context.fillRect(0, 0, 2200, 1450);
  for (let y = 0; y < 1450; y += 3) { const tone = (Math.sin(y * .027) + 1) / 2; context.fillStyle = `rgba(255,255,255,${tone * .06})`; context.fillRect(0, y, 2200, 2); }
  context.fillStyle = '#254865'; context.beginPath(); context.moveTo(0, 1100); context.lineTo(550, 520); context.lineTo(1250, 1270); context.lineTo(1720, 760); context.lineTo(2200, 1150); context.lineTo(2200, 1450); context.lineTo(0, 1450); context.fill();
  const encoded = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png')); const pdfDoc = await PDFDocument.create(); const image = await pdfDoc.embedPng(new Uint8Array(await encoded.arrayBuffer()));
  const page = pdfDoc.addPage([1440, 900]); page.drawRectangle({ x: 0, y: 0, width: 1440, height: 900, color: rgb(.96, .97, .98) }); page.drawImage(image, { x: 620, y: 0, width: 820, height: 900 });
  page.drawText('PLUMA / LOCAL STUDIO', { x: 70, y: 805, size: 12, color: rgb(.08, .2, 1) }); page.drawText(index === 0 ? 'Space to' : index === 1 ? 'Made for' : 'The next', { x: 70, y: 540, size: 64, color: rgb(.12, .14, .18) }); page.drawText(index === 0 ? 'think.' : index === 1 ? 'the detail.' : 'perspective.', { x: 70, y: 465, size: 64, color: rgb(.08, .2, 1) }); page.drawText('A lighter file. The same point of view.', { x: 73, y: 365, size: 15, color: rgb(.5, .54, .62) }); page.drawText(`0${index + 1}  /  DEMO DOCUMENT`, { x: 73, y: 65, size: 10, color: rgb(.5, .54, .62) }); canvas.width = canvas.height = 1; return pdfDoc.save({ useObjectStreams: true });
}
async function demoMessage(message: Record<string, unknown>): Promise<void> {
  if (message.type === 'open-install-guide') { window.open('https://github.com/charliezstong/pluma-pdf/releases/latest', '_blank', 'noopener,noreferrer'); return; }
  if (message.type === 'audit-layers') await onMessage({ type: 'layer-audit', requestId: message.requestId, scannedImages: frames.length, candidates: [] });
  if (message.type === 'refresh') { await onMessage({ type: 'frames', documentName: 'Pluma · Demo', frames: [{ id: 'demo-1', name: '01 · Space to think', width: 1440, height: 900 }, { id: 'demo-2', name: '02 · Made for the detail', width: 1440, height: 900 }, { id: 'demo-3', name: '03 · The next perspective', width: 1440, height: 900 }] }); }
  if (message.type === 'export') { const ids = message.ids as string[]; for (let index = 0; index < ids.length; index++) { if (!job || job.id !== message.jobId || job.cancelled) return; const bytes = await demoPdf(Number(ids[index].slice(-1)) - 1); if (!job || job.id !== message.jobId || job.cancelled) return; await onMessage({ type: 'page', jobId: message.jobId, format: 'pdf', bytes, name: ids[index], index, total: ids.length, width: 1440, height: 900 }); } if (job && job.id === message.jobId && !job.cancelled) await onMessage({ type: 'done', jobId: message.jobId }); }
  if (message.type === 'cancel') await onMessage({ type: 'cancelled', jobId: message.jobId });
}
if (demo) $('demo-note').hidden = false;
render(); refresh(); void checkEngine(true);
