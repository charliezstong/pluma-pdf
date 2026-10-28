import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { setImmediate as nextTurn } from 'node:timers/promises';

// Test the exact bundle Figma imports. Run npm run build before this suite.
const controllerCode = process.env.PLUMA_TEST_CONTROLLER_SOURCE === '1'
  ? (await build({ entryPoints: ['src/plugin.ts'], bundle: true, write: false, format: 'iife', target: 'es2017' })).outputFiles[0].text
  : await readFile(new URL('../dist/code.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

async function eventually(check, description) {
  for (let turn = 0; turn < 100; turn++) {
    const result = check();
    if (result) return result;
    await nextTurn();
  }
  assert.fail(`No se recibió: ${description}`);
}

function harness() {
  let sequence = 0, started = false;
  const messages = [], exports = [], mutations = [], showUI = [], focused = [];
  const registry = new Map(), events = new Map(), timers = new Set();
  const root = { id: 'document', type: 'DOCUMENT', name: 'Documento de prueba', parent: null };
  function mutation(api) { mutations.push(api); throw new Error(`Document write forbidden: ${api}`); }

  function container(type, id, name, parent = root) {
    const node = {
      id, type, name, parent, children: [], selection: [], visible: true, removed: false,
      appendChild(child) {
        if (started) mutation('appendChild');
        const previous = child.parent;
        if (previous?.children) previous.children.splice(previous.children.indexOf(child), 1);
        child.parent = this;
        this.children.push(child);
      },
    };
    registry.set(id, node);
    return node;
  }

  const page = container('PAGE', 'page', 'Página de prueba');
  function scene(options = {}, parent = page) {
    const node = container(options.type || 'FRAME', options.id || `node-${++sequence}`, options.name || 'Frame', null);
    const fills = copy(options.fills ?? []);
    const transform = copy(options.transform || [[1, 0, 20], [0, 1, 40]]);
    Object.assign(node, {
      width: options.width ?? 400, height: options.height ?? 300, visible: options.visible ?? true,
      clone() { mutation('clone'); }, resize() { mutation('resize'); }, remove() { mutation('remove'); },
      async exportAsync(settings) {
        exports.push({ node: this, settings: copy(settings) });
        if (options.exportHook) return options.exportHook(this, settings);
        return new Uint8Array(settings.format === 'PDF' ? [37, 80, 68, 70] : [137, 80, 78, 71]);
      },
    });
    Object.defineProperty(node, 'fills', { get: () => fills, set: () => mutation('fills') });
    Object.defineProperty(node, 'relativeTransform', { get: () => transform, set: () => mutation('relativeTransform') });
    Object.defineProperty(node, 'absoluteTransform', { get: () => transform });
    Object.defineProperty(node, 'absoluteBoundingBox', {
      configurable: true,
      get: () => options.bounds || ({ x: 20, y: 40, width: node.width, height: node.height }),
    });
    if (parent) parent.appendChild(node);
    return node;
  }
  function snapshot(node = page) {
    return copy({
      id: node.id, type: node.type, name: node.name, width: node.width, height: node.height,
      fills: node.fills, transform: node.absoluteTransform, removed: node.removed,
      children: node.children?.map(child => snapshot(child)),
    });
  }

  const figma = {
    root, currentPage: page, mixed: Symbol('mixed'), ui: { onmessage: null, postMessage: message => messages.push(message) },
    showUI: (html, options) => showUI.push({ html, options }), on: (event, callback) => events.set(event, callback),
    viewport: { scrollAndZoomIntoView: nodes => focused.push(nodes.map(node => node.id)) },
    getNodeByIdAsync: async id => registry.get(id) || null,
    getImageByHash() { mutation('getImageByHash: unnecessary source-asset access'); },
    createImage() { mutation('createImage'); }, createFrame() { mutation('createFrame'); },
  };
  const context = vm.createContext({
    figma, __html__: '<html></html>', Uint8Array, ArrayBuffer, console,
    setTimeout(callback, delay) { const timer = setTimeout(callback, delay); timers.add(timer); return timer; },
    clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
  });
  return {
    figma, page, root, messages, exports, mutations, showUI, focused, scene, container, snapshot,
    boot() { started = true; vm.runInContext(controllerCode, context, { filename: 'dist/code.js' }); },
    send(message) { figma.ui.onmessage(message); },
    emit(event) { events.get(event)?.(); },
    find(type, jobId) { return messages.find(message => message.type === type && (!jobId || message.jobId === jobId)); },
    wait(type, jobId) { return eventually(() => this.find(type, jobId), `${type} (${jobId})`); },
    close() { events.get('close')?.(); for (const timer of timers) clearTimeout(timer); },
  };
}

const request = (jobId, ids, mode = 'native', overrides = {}) => ({
  type: 'export', jobId, ids, mode, scale: 2, quality: 82, ...overrides,
});
const acknowledge = (h, jobId, index) => h.send({ type: 'page-ack', jobId, index });

test('canvas selection changes do not discard the reviewed page scope', t => {
  const h = harness(); t.after(() => h.close());
  const a = h.scene({ id: 'a' }), b = h.scene({ id: 'b' });
  h.page.selection = [a]; h.boot();
  h.send({ type: 'refresh', scope: 'page' });
  const before = h.messages.length;
  h.page.selection = [b]; h.emit('selectionchange');
  assert.equal(h.messages.length, before);
  h.send({ type: 'refresh', scope: 'selection' });
  assert.deepEqual(copy(h.messages.at(-1).frames).map(f => f.id), ['b']);
  h.page.selection = [a]; h.emit('selectionchange');
  assert.deepEqual(copy(h.messages.at(-1).frames).map(f => f.id), ['a']);
});

// This contract is the safety boundary: optimization operates on exported bytes.
test('native and hybrid export source PDF bytes without any Figma document writes or image access', async t => {
  const h = harness(); t.after(() => h.close());
  const layout = h.scene({ id: 'auto-layout', width: 1600 });
  const frame = h.scene({ id: 'source', name: 'Presentación', fills: [
    { type: 'IMAGE', imageHash: 'original-photo', scaleMode: 'FILL' },
    { type: 'IMAGE', imageHash: 'cropped-photo', scaleMode: 'CROP', imageTransform: [[1, 0, 0.2], [0, 1, 0.3]] },
  ] }, layout);
  h.scene({ id: 'text', type: 'TEXT', name: 'Texto original', width: 100, height: 20 }, frame);
  h.figma.currentPage.selection = [frame];
  const before = h.snapshot(); h.boot();
  assert.equal(h.showUI[0].options.width, 460);
  assert.equal(h.showUI[0].options.height, 800);
  for (const mode of ['native', 'hybrid']) {
    h.send(request(mode, [frame.id], mode));
    const page = await h.wait('page', mode);
    assert.equal(page.id, frame.id);
    assert.equal(page.name, 'Presentación');
    assert.equal(page.format, 'pdf');
    assert.deepEqual([...page.bytes], [37, 80, 68, 70]);
    assert.equal(h.exports.at(-1).node, frame, 'export must use the original node directly');
    assert.equal(h.exports.at(-1).settings.format, 'PDF');
    assert.deepEqual(h.snapshot(), before);
    acknowledge(h, mode, 0); await h.wait('done', mode);
    assert.deepEqual(h.snapshot(), before);
  }
  assert.deepEqual(h.mutations, []);
  assert.equal(h.messages.some(message => message.type === 'optimize-image'), false);
});

test('native export serializes pages and ignores stale/out-of-order ACKs and overlapping jobs', async t => {
  const h = harness(); t.after(() => h.close());
  const first = h.scene({ id: 'first', name: 'Primera' });
  const second = h.scene({ id: 'second', name: 'Segunda' }); h.boot();
  h.send(request('serial', [first.id, second.id]));
  const page0 = await h.wait('page', 'serial');
  assert.equal(page0.index, 0); assert.equal(page0.total, 2);
  assert.deepEqual(h.exports.map(item => item.node.id), ['first']);
  h.send({ type: 'page-ack', jobId: 'stale', index: 0 }); acknowledge(h, 'serial', 1);
  h.send(request('overlap', ['second']));
  assert.match((await h.wait('error', 'overlap')).message, /en curso/);
  await nextTurn(); assert.equal(h.exports.length, 1);
  acknowledge(h, 'serial', 0);
  await eventually(() => h.messages.find(message => message.type === 'page' && message.index === 1), 'segunda página');
  assert.deepEqual(h.exports.map(item => item.node.id), ['first', 'second']);
  acknowledge(h, 'serial', 1); await h.wait('done', 'serial');
  assert.deepEqual(h.mutations, []);
});

test('compact compatibility caps decoded pixels, preserves the source and surfaces ACK errors', async t => {
  const h = harness(); t.after(() => h.close());
  const node = h.scene({ id: 'huge', width: 20_000, height: 12_000 });
  const before = h.snapshot(); h.boot();
  h.send(request('compact', [node.id], 'compact', { scale: 4 }));
  const page = await h.wait('page', 'compact');
  const settings = h.exports[0].settings;
  assert.equal(settings.format, 'PNG'); assert.equal(page.format, 'png');
  assert.ok(Math.ceil(node.width * settings.constraint.value) <= 8192);
  assert.ok(Math.ceil(node.width * settings.constraint.value) * Math.ceil(node.height * settings.constraint.value) <= 24_000_000);
  assert.equal(page.width, 20_000); assert.deepEqual(h.snapshot(), before);
  h.send({ type: 'page-ack', jobId: 'compact', index: 0, error: 'No se pudo ensamblar el PDF.' });
  assert.match((await h.wait('error', 'compact')).message, /ensamblar/);
  h.send(request('retry', [node.id]));
  await h.wait('page', 'retry'); acknowledge(h, 'retry', 0); await h.wait('done', 'retry');
  assert.deepEqual(h.mutations, []);
});

test('cancellation while waiting for ACK stops the remaining pages and releases the export lock', async t => {
  const h = harness(); t.after(() => h.close());
  const first = h.scene({ id: 'cancel-first' }); const second = h.scene({ id: 'cancel-second' });
  const before = h.snapshot(); h.boot(); h.send(request('cancel', [first.id, second.id]));
  await h.wait('page', 'cancel'); h.send({ type: 'cancel', jobId: 'cancel' });
  await h.wait('cancelled', 'cancel');
  acknowledge(h, 'cancel', 0); await nextTurn();
  assert.equal(h.exports.length, 1); assert.deepEqual(h.snapshot(), before);
  h.send(request('after-cancel', [second.id]));
  await h.wait('page', 'after-cancel'); acknowledge(h, 'after-cancel', 0); await h.wait('done', 'after-cancel');
});

test('cancellation during Figma export suppresses its late bytes and never edits the document', async t => {
  const h = harness(); t.after(() => h.close());
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const node = h.scene({ id: 'slow', exportHook: async () => pending });
  const before = h.snapshot(); h.boot(); h.send(request('slow-job', [node.id]));
  await eventually(() => h.exports.length === 1, 'inicio del export nativo');
  h.send({ type: 'cancel', jobId: 'slow-job' });
  finish(new Uint8Array([37, 80, 68, 70]));
  await h.wait('cancelled', 'slow-job');
  assert.equal(h.find('page', 'slow-job'), undefined);
  assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.mutations, []);
});

test('Figma export failures leave originals unchanged and permit retry', async t => {
  const h = harness(); t.after(() => h.close()); let fail = true;
  const node = h.scene({ id: 'failure', exportHook: async () => {
    if (fail) throw new Error('Figma no pudo exportar esta capa.');
    return new Uint8Array([37, 80, 68, 70]);
  } });
  const before = h.snapshot(); h.boot(); h.send(request('failure', [node.id], 'hybrid'));
  assert.match((await h.wait('error', 'failure')).message, /Figma no pudo/);
  assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.mutations, []);
  fail = false; h.send(request('after-failure', [node.id]));
  await h.wait('page', 'after-failure'); acknowledge(h, 'after-failure', 0); await h.wait('done', 'after-failure');
});

test('invalid IDs, cross-page IDs, page limits and invalid quality fail before any exports', async t => {
  const h = harness(); t.after(() => h.close());
  const valid = h.scene({ id: 'valid' });
  const otherPage = h.container('PAGE', 'other-page', 'Otra página'); h.scene({ id: 'other' }, otherPage);
  h.boot();
  const invalid = [
    { ids: [] }, { ids: Array.from({ length: 201 }, () => valid.id) }, { ids: [null] },
    { ids: ['valid', 'does-not-exist'] }, { ids: ['other'] }, { ids: ['valid'], quality: 0.82 },
    { ids: ['valid'], quality: 101 }, { ids: ['valid'], scale: Infinity }, { ids: ['valid'], mode: 'unknown' },
  ];
  for (let index = 0; index < invalid.length; index++) {
    const job = `invalid-${index}`; h.send(request(job, [valid.id], 'native', invalid[index])); await h.wait('error', job);
  }
  assert.equal(h.exports.length, 0); assert.deepEqual(h.mutations, []);
  h.send(request('valid-job', [valid.id]));
  await h.wait('page', 'valid-job'); acknowledge(h, 'valid-job', 0); await h.wait('done', 'valid-job');
});

test('selection and page scopes expand sections, skip hidden page roots and deduplicate ancestors', t => {
  const h = harness(); t.after(() => h.close());
  const section = h.scene({ id: 'section', type: 'SECTION' });
  const frame = h.scene({ id: 'frame' }, section);
  const descendant = h.scene({ id: 'descendant', type: 'RECTANGLE' }, frame);
  h.scene({ id: 'hidden', visible: false });
  h.figma.currentPage.selection = [section, frame, descendant, frame]; h.boot();
  assert.deepEqual(copy(h.find('frames').frames).map(node => node.id), ['frame']);
  h.send({ type: 'refresh', scope: 'page' });
  assert.deepEqual(copy(h.messages.filter(message => message.type === 'frames').at(-1).frames).map(node => node.id), ['frame']);
  assert.deepEqual(h.mutations, []);
});

test('PDF page metadata uses rotated export bounds and preserves requested frame order', async t => {
  const h = harness(); t.after(() => h.close());
  const first = h.scene({ id: 'rotated', width: 400, height: 300, bounds: { x: 0, y: 0, width: 300, height: 400 } });
  const second = h.scene({ id: 'second' }); h.boot();
  h.send(request('order', [second.id, first.id]));
  const page0 = await h.wait('page', 'order'); assert.equal(page0.id, second.id); acknowledge(h, 'order', 0);
  const page1 = await eventually(() => h.messages.find(message => message.type === 'page' && message.index === 1), 'página rotada');
  assert.equal(page1.id, first.id); assert.equal(page1.width, 300); assert.equal(page1.height, 400);
  acknowledge(h, 'order', 1);
  const done = await h.wait('done', 'order');
  assert.deepEqual(copy(done.pageOrder), [
    { index: 0, id: second.id, name: second.name },
    { index: 1, id: first.id, name: first.name },
  ], 'the metadata must record the reviewed input order rather than sort the export again');
});

test('selection and page defaults follow canvas rows instead of layer or name order', t => {
  const h = harness(); t.after(() => h.close());
  const lower = h.scene({ id: 'created-first', name: '1', bounds: { x: -20, y: 400, width: 400, height: 300 } });
  const upperRight = h.scene({ id: 'created-second', name: '2', bounds: { x: 600, y: -100, width: 400, height: 300 } });
  const upperLeft = h.scene({ id: 'created-third', name: '9', bounds: { x: -20, y: -100, width: 400, height: 300 } });
  h.figma.currentPage.selection = [lower, upperRight, upperLeft];
  const before = h.snapshot(); h.boot();
  const expected = ['created-third', 'created-second', 'created-first'];
  const selection = h.find('frames');
  assert.equal(selection.orderPolicy, 'canvas-top-to-bottom-left-to-right');
  assert.deepEqual(copy(selection.frames).map(frame => frame.id), expected);
  assert.deepEqual(copy(selection.frames).map(frame => [frame.x, frame.y]), [[-20, -100], [600, -100], [-20, 400]]);
  h.send({ type: 'refresh', scope: 'page' });
  assert.deepEqual(copy(h.messages.filter(message => message.type === 'frames').at(-1).frames).map(frame => frame.id), expected);
  assert.deepEqual(h.snapshot(), before);
  assert.deepEqual(h.mutations, []);
});

test('default order uses rotated absolute bounds rather than local coordinates or transform origin', t => {
  const h = harness(); t.after(() => h.close());
  const straight = h.scene({ id: 'straight', transform: [[1, 0, 0], [0, 1, 0]], bounds: { x: 0, y: 20, width: 400, height: 300 } });
  const rotated = h.scene({ id: 'rotated-first', transform: [[0, -1, 900], [1, 0, 800]], bounds: { x: 200, y: 10, width: 300, height: 400 } });
  h.figma.currentPage.selection = [straight, rotated]; h.boot();
  assert.deepEqual(copy(h.find('frames').frames).map(frame => frame.id), ['rotated-first', 'straight']);
});

test('equal canvas positions retain stable selection order and hidden selected nodes use absolute translation', t => {
  const h = harness(); t.after(() => h.close());
  const first = h.scene({ id: 'tie-a', bounds: { x: 20, y: 40, width: 400, height: 300 } });
  const second = h.scene({ id: 'tie-b', bounds: { x: 20, y: 40, width: 400, height: 300 } });
  const hidden = h.scene({ id: 'hidden-selected', visible: false, transform: [[1, 0, 0], [0, 1, -100]] });
  Object.defineProperty(hidden, 'absoluteBoundingBox', { configurable: true, get: () => null });
  h.figma.currentPage.selection = [second, first, hidden]; h.boot();
  assert.deepEqual(copy(h.find('frames').frames).map(frame => frame.id), ['hidden-selected', 'tie-b', 'tie-a']);
  h.send({ type: 'refresh', scope: 'page' });
  assert.deepEqual(copy(h.messages.filter(message => message.type === 'frames').at(-1).frames).map(frame => frame.id), ['tie-a', 'tie-b']);
});

// Synthetic grid: canvas order, reversed names and shuffled layer order disagree.
const syntheticCanvasFixture = Array.from({ length: 55 }, (_, index) => ({
  id: `slide-${String(index + 1).padStart(2, '0')}`,
  name: `Slide ${String(55 - index).padStart(2, '0')}`,
  x: -40 + (index % 7) * 320,
  y: -60 + Math.floor(index / 7) * 200,
}));
const syntheticLayerFixture = Array.from({ length: 55 }, (_, index) => syntheticCanvasFixture[(index * 17) % 55]);

// Expected IDs are independent of the fixture's creation/layer permutation.
const expectedCanvasIds = Array.from({ length: 55 }, (_, index) => `slide-${String(index + 1).padStart(2, '0')}`);

test('a synthetic 55-frame grid follows canvas order without changing source layers', t => {
  const h = harness(); t.after(() => h.close());
  for (const { id, name, x, y } of syntheticLayerFixture) h.scene({ id, name, width: 300, height: 180, bounds: { x, y, width: 300, height: 180 } });
  const originalLayerIds = h.page.children.map(frame => frame.id);
  const originalBounds = copy(h.page.children.map(frame => frame.absoluteBoundingBox));
  const before = h.snapshot();
  assert.notDeepEqual(originalLayerIds, expectedCanvasIds, 'the fixture must not arrive already sorted');
  h.boot(); h.send({ type: 'refresh', scope: 'page' });
  const listed = copy(h.messages.filter(message => message.type === 'frames').at(-1).frames);
  assert.equal(listed.length, 55);
  assert.deepEqual(listed.map(frame => frame.id), expectedCanvasIds);
  assert.equal(listed[0].name, 'Slide 55', 'frame names cannot determine canvas order');
  assert.equal(listed[54].name, 'Slide 01');
  assert.equal(listed[29].id, 'slide-30');
  assert.equal(listed[53].id, 'slide-54');
  assert.deepEqual(h.page.children.map(frame => frame.id), originalLayerIds, 'sorting must never reorder Figma layers');
  assert.deepEqual(copy(h.page.children.map(frame => frame.absoluteBoundingBox)), originalBounds);
  assert.deepEqual(h.snapshot(), before);
  assert.deepEqual(h.mutations, []);
});


test('layer audit reads JPEG evidence only on request, caches the fact and never changes source', async t => {
  const h = harness(); t.after(() => h.close());
  const root = h.scene({ id: 'audit-frame' });
  for (const id of ['under', 'over']) {
    const image = h.scene({ id, type: 'RECTANGLE', bounds: { x: 0, y: 0, width: 100, height: 100 }, fills: [{ type: 'IMAGE', imageHash: id, scaleMode: 'FILL' }] }, root);
    image.cornerRadius = 0;
  }
  let reads = 0;
  h.figma.getImageByHash = hash => ({ getBytesAsync: async () => { reads++; assert.equal(hash, 'over'); return new Uint8Array([255, 216, 255, 1]); } });
  h.boot(); const before = h.snapshot();
  assert.equal(reads, 0);
  for (const requestId of ['audit-one', 'audit-two']) {
    h.send({ type: 'audit-layers', requestId, ids: [root.id] });
    const result = await eventually(() => h.messages.find(message => message.type === 'layer-audit' && message.requestId === requestId), requestId);
    assert.equal(result.scannedImages, 2); assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].confidence, 'geometry-covered');
  }
  assert.equal(reads, 1, 'only the JPEG fact should be cached between audits');
  assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.mutations, []); assert.equal(h.exports.length, 0);
  h.send({ type: 'audit-layers', requestId: 'too-many', ids: Array.from({ length: 201 }, () => root.id) });
  const invalid = await eventually(() => h.messages.find(message => message.type === 'layer-audit' && message.requestId === 'too-many'), 'rejected audit');
  assert.match(invalid.error, /200/);
});

test('focus-node selects and zooms only when requested without rebinding reviewed frame sources', async t => {
  const h = harness(); t.after(() => h.close());
  const frame = h.scene({ id: 'reviewed-frame' }); const child = h.scene({ id: 'review-candidate', type: 'RECTANGLE' }, frame);
  h.figma.currentPage.selection = [frame]; h.boot();
  const initialLists = h.messages.filter(message => message.type === 'frames').length;
  h.send({ type: 'focus-node', id: child.id });
  await eventually(() => h.focused.length === 1, 'focus requested');
  assert.equal(h.figma.currentPage.selection[0], child);
  h.emit('selectionchange');
  assert.equal(h.messages.filter(message => message.type === 'frames').length, initialLists, 'programmatic selection must preserve source PDFs/cache');
  assert.deepEqual(copy(h.focused), [[child.id]]);
  h.send({ type: 'refresh', scope: 'selection' });
  assert.equal(h.messages.filter(message => message.type === 'frames').length, initialLists + 1, 'explicit refresh still reloads selection');
  assert.deepEqual(h.mutations, []);
});
