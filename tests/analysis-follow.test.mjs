import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { build } from 'esbuild';

const source = await readFile(new URL('../src/ui.ts', import.meta.url), 'utf8');
const code = (await build({
  stdin: { contents: source + `\n(globalThis as any).__ui = { onMessage, startAnalysis, demoPreview: (message: any) => { demoPdf = async () => new Uint8Array([80, 99]); return demoMessage(message); }, select: (id: string) => { activeFrameId = id; render(); }, original: (id: string, bytes: Uint8Array) => { frames.find(frame => frame.id === id)!.original = bytes; }, include: (id: string, selected: boolean) => { frames.find(frame => frame.id === id)!.selected = selected; }, state: () => ({ activeFrameId, busy, job, output, previewReady, displayedPreviewFrameId, frames, framePreviews, framePreviewRequest }) };`, resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'iife', target: 'es2020',
  plugins: [{ name: 'synthetic-ui-dependencies', setup(builder) {
    builder.onResolve({ filter: /^(pdf-lib|\.\/pdf-preview|\.\/visual-diff)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'pdf-lib' ? 'export const PDFDocument=globalThis.__pdf; export const rgb=()=>({});' : args.path === './pdf-preview' ? 'export const renderPdf=(...args)=>globalThis.__renderPdf(...args);' : 'export const compareRenderedImages=async()=>({identical:true});' }));
  } }],
})).outputFiles[0].text;

async function eventually(check, label) {
  for (let step = 0; step < 100; step++) { if (check()) return; await nextTurn(); }
  assert.fail(`Did not settle: ${label}`);
}
function deferred() { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; }
function response(bytes) { return { ok: true, headers: { get: () => '0' }, json: async () => ({ name: 'Pluma PDF', engine: 'sharp' }), arrayBuffer: async () => Uint8Array.from(bytes).buffer }; }

function harness({ holdRenders = false } = {}) {
  const nodes = new Map(), timers = new Set(), messages = [], requests = [], renders = [], windowEvents = new Map(), timerCallbacks = new Map(), createdUrls = [], revokedUrls = [];
  let urlSequence = 0;
  function element(tag = 'div') {
    const classes = new Set(), events = new Map(), properties = new Map();
    let src = '', className = '';
    return {
      tagName: tag.toUpperCase(), hidden: false, disabled: false, value: '', dataset: {}, children: [], textContent: '', scrollTop: 0, scrollLeft: 0,
      complete: false, naturalWidth: 0, naturalHeight: 0, clientWidth: 390, clientHeight: 200,
      parentElement: { classList: { toggle() {} } },
      classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name), add: name => classes.add(name) },
      get className() { return className; }, set className(value) { className = value; },
      get src() { return src; }, set src(value) { src = value; this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; },
      style: { setProperty: (name, value) => properties.set(name, value), removeProperty: name => properties.delete(name), getPropertyValue: name => properties.get(name) ?? '' },
      setAttribute() {}, removeAttribute(name) { if (name === 'src') this.src = ''; }, append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; }, remove() {}, click() { this.onclick?.(); },
      addEventListener(type, listener) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(listener); },
      dispatch(type) { for (const listener of events.get(type) ?? []) listener({}); },
      getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight, left: 0 }; },
    };
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, element(id.startsWith('preview-') ? 'img' : 'div')); return nodes.get(id); };
  node('quality').value = '82'; node('max-edge').value = '2560'; node('compare-slider').value = '50'; node('filename').value = 'Synthetic';
  const window = { addEventListener(type, listener) { if (!windowEvents.has(type)) windowEvents.set(type, new Set()); windowEvents.get(type).add(listener); }, dispatchEvent() {} };
  const pdf = {
    async load(bytes) { const count = bytes[0] === 240 ? bytes[1] : 1; return { getPageCount: () => count, getPageIndices: () => Array.from({ length: count }, (_, index) => index), getPage: () => ({ getSize: () => ({ width: 400, height: 300 }) }) }; },
    async create() { const pages = []; return { setTitle() {}, setCreator() {}, copyPages: async (_source, indices) => indices.map(() => ({})), addPage(page) { pages.push(page); }, save: async () => new Uint8Array([240, pages.length]) }; },
  };
  const context = vm.createContext({
    window, parent: { postMessage: message => messages.push(message.pluginMessage) }, navigator: { languages: ['en'], language: 'en' },
    document: { documentElement: {}, getElementById: node, createElement: element, createTextNode: text => ({ textContent: text }), querySelectorAll: () => [], querySelector: selector => selector === '.preview-panel' ? node('panel') : selector === '.brand' ? node('brand') : null, body: element('body') },
    Blob, Uint8Array, AbortController, URLSearchParams, Intl, Date, Math,
    URL: class extends URL { static createObjectURL(blob) { const url = `blob:synthetic-${++urlSequence}`; createdUrls.push({ url, blob }); return url; } static revokeObjectURL(url) { revokedUrls.push(url); } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setTimeout(callback, delay) { const timer = setTimeout(callback, delay); timer.unref(); timers.add(timer); timerCallbacks.set(timer, {callback, delay}); return timer; }, clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); timerCallbacks.delete(timer); },
    __pdf: pdf,
    __renderPdf(bytes, maxWidth) { const wait = deferred(); const render = { bytes: [...bytes], maxWidth, resolve: () => wait.resolve({ dataUrl: `data:synthetic/${bytes[1] ?? bytes[0]}/${maxWidth}`, width: 400, height: 300 }) }; renders.push(render); if (!holdRenders || maxWidth === 120) render.resolve(); return wait.promise; },
    async fetch(url, options) {
      if (url.startsWith('data:')) return response([137, 80, 78, 71, 13, 10, 26, 10, 0]);
      if (url.endsWith('/health')) return response([]);
      if (url.endsWith('/pdf/deduplicate')) return response(new Uint8Array(await options.body.arrayBuffer()));
      const wait = deferred(); requests.push({ resolve: bytes => wait.resolve(response(bytes)), fail: () => wait.resolve({ ok: false, status: 500, json: async () => ({ error: { message: 'Synthetic failure' } }) }) }); return wait.promise;
    },
  });
  vm.runInContext(code, context);
  return {
    ui: context.__ui, node, messages, requests, renders, createdUrls, revokedUrls,
    timeoutPreview() { const [timer, value] = [...timerCallbacks].find(([, value]) => value.delay === 12_000) ?? []; assert.ok(value, 'preview timeout exists'); clearTimeout(timer); timers.delete(timer); timerCallbacks.delete(timer); value.callback(); },
    unload() { for (const listener of windowEvents.get('unload') ?? []) listener(); },
    async frames(ids) { await this.ui.onMessage({ type: 'frames', frames: ids.map(id => ({ id, name: id, width: 400, height: 300 })) }); },
    page(index, bytes = [80, index + 10, 20, 30]) { return this.ui.onMessage({ type: 'page', jobId: this.ui.state().job.id, format: 'pdf', index, bytes }); },
    loadImage(width = 400, height = 300) { const image = node('preview-before'); image.complete = true; image.naturalWidth = width; image.naturalHeight = height; image.dispatch('load'); },
    resize() { for (const listener of windowEvents.get('resize') ?? []) listener(); },
    scanning() { return node('panel').classList.contains('is-analyzing'); },
    close() { for (const timer of timers) clearTimeout(timer); },
  };
}

test('real delivered pages follow processing, scan only loaded pixels, and preserve order/selection/ACKs', async t => {
  const h = harness(); t.after(() => h.close());
  await h.frames(['second', 'first', 'excluded']); h.ui.include('excluded', false);
  await h.ui.startAnalysis(); const active = h.ui.state().job;
  assert.deepEqual(Array.from(h.messages.find(message => message.type === 'export').ids), ['second', 'first']);
  for (let index = 0; index < 2; index++) {
    const pending = h.page(index);
    await eventually(() => h.requests.length > index && h.ui.state().previewReady, 'original preview');
    const id = ['second', 'first'][index];
    assert.equal(h.ui.state().activeFrameId, id); assert.equal(h.node('panel').dataset.processingFrameId, id); assert.equal(h.scanning(), false);
    h.loadImage(); assert.equal(h.scanning(), true);
    assert.equal(h.node('panel').style.getPropertyValue('--scan-width'), `${400 * (200 / 300)}px`);
    assert.equal(h.node('panel').style.getPropertyValue('--scan-height'), '200px');
    h.node('preview-surface').clientWidth = 100; h.resize();
    assert.equal(h.node('panel').style.getPropertyValue('--scan-width'), '100px'); assert.equal(h.node('panel').style.getPropertyValue('--scan-height'), '75px');
    h.node('preview-surface').clientWidth = 0; h.resize(); assert.equal(h.scanning(), false);
    assert.equal(h.node('panel').style.getPropertyValue('--scan-width'), '');
    h.node('preview-surface').clientWidth = 390; h.resize(); assert.equal(h.scanning(), true);
    h.requests[index].resolve([80, index]); await pending;
    assert.equal(h.scanning(), false); assert.equal(h.node('panel').dataset.processingFrameId, undefined);
    assert.equal(h.messages.filter(message => message.type === 'page-ack').at(-1).index, index);
  }
  await h.ui.onMessage({ type: 'done', jobId: active.id });
  assert.equal(h.ui.state().busy, false); assert.equal(h.scanning(), false);
  assert.deepEqual(Array.from(h.ui.state().output.ids), ['second', 'first']);
  assert.deepEqual(Array.from(h.ui.state().frames, frame => [frame.id, frame.selected]), [['second', true], ['first', true], ['excluded', false]]);
});

test('cached-original reanalysis follows real local work without another Figma export', async t => {
  const h = harness(); t.after(() => h.close()); await h.frames(['a', 'b']);
  h.ui.original('a', new Uint8Array([80, 10, 20, 30])); h.ui.original('b', new Uint8Array([80, 11, 20, 30]));
  const pending = h.ui.startAnalysis();
  for (let index = 0; index < 2; index++) {
    await eventually(() => h.requests.length > index && h.ui.state().previewReady, 'cached processing preview');
    assert.equal(h.ui.state().activeFrameId, ['a', 'b'][index]); h.loadImage(); assert.equal(h.scanning(), true);
    h.requests[index].resolve([80, index]);
  }
  await pending;
  assert.equal(h.messages.some(message => message.type === 'export'), false); assert.equal(h.scanning(), false); assert.equal(h.ui.state().busy, false);
});

test('cancel removes scan immediately and a late old job cannot clear the replacement job scan', async t => {
  const h = harness(); t.after(() => h.close()); await h.frames(['a']); h.ui.original('a', new Uint8Array([80, 10, 20, 30]));
  const old = h.ui.startAnalysis(); await eventually(() => h.requests.length === 1 && h.ui.state().previewReady, 'first job');
  h.loadImage(); assert.equal(h.scanning(), true); h.node('cancel').click();
  assert.equal(h.scanning(), false); assert.equal(h.node('panel').dataset.processingFrameId, undefined);
  const replacement = h.ui.startAnalysis(); await eventually(() => h.requests.length === 2, 'replacement job'); h.loadImage(); assert.equal(h.scanning(), true);
  h.requests[0].resolve([80, 1]); await old;
  assert.equal(h.scanning(), true); assert.equal(h.node('panel').dataset.processingFrameId, 'a');
  h.requests[1].resolve([80, 2]); await replacement; assert.equal(h.scanning(), false);
});

test('serial previews coalesce superseded work and a refresh rejects an old pending PDF', async t => {
  const h = harness({ holdRenders: true }); t.after(() => h.close()); await h.frames(['a', 'b', 'c']);
  for (const [index, id] of ['a', 'b', 'c'].entries()) h.ui.original(id, new Uint8Array([80, index + 10]));
  h.ui.select('a'); await eventually(() => h.renders.length === 1, 'first render');
  h.ui.select('b'); h.ui.select('c'); await nextTurn(); assert.equal(h.renders.length, 1, 'only one full-size preview runs');
  h.renders[0].resolve(); await eventually(() => h.renders.length === 2, 'latest render');
  assert.equal(h.renders[1].bytes[1], 12, 'intermediate page is skipped, preserving only the latest request');
  await h.frames(['new']); h.renders[1].resolve(); await nextTurn(); await nextTurn();
  assert.equal(h.ui.state().activeFrameId, 'new'); assert.equal(h.ui.state().displayedPreviewFrameId, '');
  assert.equal(h.node('preview-surface').hidden, true); assert.equal(h.node('preview-empty').hidden, false); assert.equal(h.scanning(), false);
});

test('stale and unknown job messages never redirect the current page or start a scan', async t => {
  const h = harness(); t.after(() => h.close()); await h.frames(['a', 'b']); await h.ui.startAnalysis();
  await h.ui.onMessage({ type: 'progress', jobId: 'stale', frameId: 'b', current: 2, total: 2 });
  await h.ui.onMessage({ type: 'page', jobId: 'stale', index: 1, bytes: [80, 1], format: 'pdf' });
  await h.ui.onMessage({ type: 'progress', jobId: h.ui.state().job.id, frameId: 'unknown', current: 9, total: 9 });
  assert.equal(h.ui.state().activeFrameId, 'a'); assert.equal(h.scanning(), false);
  h.node('cancel').click(); assert.equal(h.scanning(), false);
});

test('engine failure stops the scan and retains the original without a successful ACK', async t => {
  const h = harness(); t.after(() => h.close()); await h.frames(['a']); await h.ui.startAnalysis();
  const pending = h.page(0); await eventually(() => h.requests.length === 1 && h.ui.state().previewReady, 'error case preview');
  h.loadImage(); assert.equal(h.scanning(), true); h.requests[0].fail(); await pending;
  assert.equal(h.scanning(), false); assert.equal(h.ui.state().busy, false); assert.equal(h.node('panel').dataset.processingFrameId, undefined);
  assert.deepEqual(Array.from(h.ui.state().frames[0].original), [80, 10, 20, 30]);
  assert.ok(h.messages.find(message => message.type === 'page-ack')?.error);
});

const png = (size = 16) => { const bytes = new Uint8Array(size); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); return bytes; };
const previewRequests = h => h.messages.filter(message => message.type === 'preview-frame');
async function deliverPreview(h, request = previewRequests(h).at(-1), bytes = png()) {
  await h.ui.onMessage({ type: 'frame-preview', requestId: request.requestId, id: request.id, format: 'png', bytes });
}

test('the selected frame requests a separate PNG pane without PDF state, measures, or scan', async t => {
  const h = harness(); t.after(() => h.close()); await h.frames(['a', 'b']);
  assert.equal(previewRequests(h).length, 1); assert.equal(previewRequests(h)[0].id, 'a');
  await deliverPreview(h);
  assert.equal(h.node('frame-preview-surface').hidden, false); assert.equal(h.node('preview-surface').hidden, true);
  assert.equal(h.ui.state().previewReady, false); assert.equal(h.scanning(), false);
  assert.equal(h.ui.state().frames[0].original, undefined); assert.equal(h.ui.state().frames[0].variants.size, 0);
  assert.equal(h.node('page-metrics').hidden, true); assert.match(h.node('preview-caption').textContent, /^Frame preview · Analyze/);
  const originalUrl = h.node('frame-preview-image').src;
  h.ui.select('a'); assert.equal(previewRequests(h).length, 1); assert.equal(h.node('frame-preview-image').src, originalUrl);
  h.ui.select('b'); const second = previewRequests(h).at(-1); assert.equal(second.id, 'b');
  await deliverPreview(h, previewRequests(h)[0]); assert.equal(h.ui.state().framePreviews.size, 1, 'late response cannot populate or redirect another frame');
  await deliverPreview(h, second); assert.equal(h.node('frame-preview-image').src, h.ui.state().framePreviews.get('b').url);
});

test('starting analysis ignores late PNGs and switches the frame pane to the actual PDF', async t => {
  const h = harness(); t.after(() => h.close()); await h.frames(['a']); const request = previewRequests(h)[0];
  await deliverPreview(h, request); const url = h.node('frame-preview-image').src;
  await h.ui.startAnalysis(); assert.equal(h.node('frame-preview-image').src, url, 'cached design may stay while its native PDF is read');
  await deliverPreview(h, request); assert.equal(h.createdUrls.filter(value => value.blob.type === 'image/png').length, 1);
  const pending = h.page(0); await eventually(() => h.requests.length === 1 && h.ui.state().previewReady, 'actual PDF');
  assert.equal(h.node('frame-preview-surface').hidden, true); assert.equal(h.node('preview-surface').hidden, false);
  h.loadImage(); assert.equal(h.scanning(), true); h.requests[0].resolve([80, 1]); await pending;
});

test('refresh invalidates the source generation, revokes pane/thumb URLs, and ignores earlier bytes', async t => {
  const h = harness(); t.after(() => h.close()); await h.frames(['a']); const old = previewRequests(h)[0];
  await deliverPreview(h, old); const oldUrl = h.node('frame-preview-image').src;
  assert.equal(h.ui.state().frames[0].thumb, oldUrl); h.node('refresh').click();
  assert.equal(h.node('frame-preview-surface').hidden, true); assert.equal(h.node('frame-preview-image').src, '');
  assert.ok(h.revokedUrls.includes(oldUrl)); assert.equal(h.ui.state().frames[0].thumb, undefined);
  await h.frames(['a']); const current = previewRequests(h).at(-1); assert.notEqual(current.requestId, old.requestId);
  await deliverPreview(h, old); assert.equal(h.ui.state().framePreviews.size, 0);
  await deliverPreview(h, current); assert.equal(h.ui.state().framePreviews.size, 1);
});

test('frame PNG cache bounds count, encoded bytes, individual size, and releases evicted thumbnails', async t => {
  const h = harness(); t.after(() => h.close()); const ids = ['a', 'b', 'c', 'd', 'e', 'f']; await h.frames(ids);
  for (const id of ids) { h.ui.select(id); await deliverPreview(h); }
  assert.equal(h.ui.state().framePreviews.size, 5); assert.equal(h.ui.state().frames[0].thumb, undefined);
  assert.ok(h.revokedUrls.length >= 1);
  await h.frames(ids);
  for (const id of ids.slice(0, 3)) { h.ui.select(id); await deliverPreview(h, undefined, png(8 * 1024 * 1024)); }
  assert.equal(h.ui.state().framePreviews.size, 2);
  assert.ok([...h.ui.state().framePreviews.values()].reduce((sum, value) => sum + value.bytes, 0) <= 20 * 1024 * 1024);
  h.ui.select('d'); await deliverPreview(h, undefined, png(8 * 1024 * 1024 + 1));
  assert.equal(h.ui.state().framePreviews.has('d'), false); assert.match(h.node('preview-caption').textContent, /unavailable/);
  const live = [...h.ui.state().framePreviews.values()].map(value => value.url); h.unload();
  assert.ok(live.every(url => h.revokedUrls.includes(url))); assert.equal(h.ui.state().framePreviews.size, 0);
});

test('PNG timeout and protocol errors are nonblocking and preserve unrelated error messages', async t => {
  const h = harness(); t.after(() => h.close()); await h.frames(['a', 'b']);
  h.node('error').textContent = 'Existing analysis error'; h.node('error').hidden = false; h.timeoutPreview();
  assert.match(h.node('preview-caption').textContent, /unavailable/); assert.equal(h.node('error').textContent, 'Existing analysis error');
  assert.equal(h.ui.state().busy, false); assert.equal(h.node('preview-empty').hidden, false);
  h.ui.select('b'); const request = previewRequests(h).at(-1);
  await h.ui.onMessage({ type: 'frame-preview', requestId: request.requestId, id: request.id, error: 'Unavailable' });
  assert.match(h.node('preview-caption').textContent, /unavailable/); assert.equal(h.node('error').textContent, 'Existing analysis error');
  await h.ui.startAnalysis(); assert.ok(h.messages.find(message => message.type === 'export'));
});

test('preanalysis preview captions retranslate without replacing PNG bytes or requesting Figma again', async t => {
  const h = harness(); t.after(() => h.close()); await h.frames(['a']); await deliverPreview(h);
  const url = h.node('frame-preview-image').src; const count = previewRequests(h).length;
  h.node('language').value = 'es'; h.node('language').onchange(); assert.match(h.node('preview-caption').textContent, /^Vista del frame/);
  h.node('language').value = 'pt'; h.node('language').onchange(); assert.match(h.node('preview-caption').textContent, /^Prévia do frame/);
  assert.equal(h.node('frame-preview-image').src, url); assert.equal(previewRequests(h).length, count);
});


test('standalone demo renders a synthetic PNG and discards a superseded demo render without storing a PDF', async t => {
  const h = harness({ holdRenders: true }); t.after(() => h.close()); await h.frames(['demo-1', 'demo-2']);
  const old = h.ui.demoPreview(previewRequests(h).at(-1)); await eventually(() => h.renders.length === 1, 'old demo PNG render');
  h.ui.select('demo-2'); h.renders[0].resolve(); await old;
  assert.equal(h.ui.state().framePreviews.size, 0, 'superseded demo work is not cached');
  const current = h.ui.demoPreview(previewRequests(h).at(-1)); await eventually(() => h.renders.length === 2, 'current demo PNG render');
  h.renders[1].resolve(); await current;
  assert.equal(h.ui.state().framePreviews.has('demo-2'), true); assert.equal(h.node('frame-preview-surface').hidden, false);
  assert.ok(Array.from(h.ui.state().frames).every(frame => !frame.original && frame.variants.size === 0));
});
