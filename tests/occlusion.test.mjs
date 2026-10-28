import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['src/occlusion.ts'], bundle: true, format: 'esm', write: false, platform: 'node' });
const { auditImageLayers, collectImageLayers } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const box = (x, y, width, height) => ({ x, y, width, height });
function rectangle(id, bounds, options = {}) {
  return { id, name: id, type: 'RECTANGLE', visible: true, opacity: 1, blendMode: 'NORMAL',
    absoluteBoundingBox: bounds, absoluteTransform: [[1, 0, bounds.x], [0, 1, bounds.y]],
    cornerRadius: 0, strokes: [], effects: [], fills: [{ type: 'IMAGE', imageHash: id, scaleMode: 'FILL', opacity: 1, blendMode: 'NORMAL', rotation: 0 }], ...options };
}
function frame(children) {
  return { id: 'frame', name: 'Frame', type: 'FRAME', visible: true, opacity: 1, blendMode: 'PASS_THROUGH', children,
    absoluteBoundingBox: box(0, 0, 1920, 1080), absoluteTransform: [[1, 0, 0], [0, 1, 0]], effects: [] };
}
const jpeg = async () => true;

test('near positions and identical asset hashes remain possible when opacity is not verified', async () => {
  const lower = rectangle('lower', box(10, 10, 200, 200));
  const upper = rectangle('upper', box(12, 11, 200, 200), { fills: [{ type: 'IMAGE', imageHash: 'lower', scaleMode: 'FILL' }] });
  const result = await auditImageLayers([frame([lower, upper])], { isJpegOpaque: async () => false });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].confidence, 'possible');
  assert.equal(result.candidates[0].sameAsset, true);
  assert.match(result.candidates[0].reason, /no demuestra/);
});

test('a locally positioned mask is covered by a verified opaque JPEG without mutating source', async () => {
  const mask = rectangle('mask', box(60, 44, 379, 425), { isMask: true, maskType: 'ALPHA', cornerRadius: 29, fills: [{ type: 'SOLID', opacity: 1 }] });
  const lower = rectangle('photo-under', box(0, 0, 479, 479));
  const upper = rectangle('photo-over', box(-158, 35, 666, 444));
  const group = { id: 'group', name: 'Mask group', type: 'GROUP', visible: true, opacity: 1, blendMode: 'PASS_THROUGH', effects: [], children: [mask, lower, upper] };
  const original = frame([group]); const before = JSON.stringify(original);
  const result = await auditImageLayers([original], { isJpegOpaque: jpeg });
  assert.equal(result.scannedImages, 2);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.id, 'photo-under'); assert.equal(candidate.coverId, 'photo-over');
  assert.equal(candidate.confidence, 'geometry-covered'); assert.equal(candidate.sameAsset, false);
  assert.deepEqual(candidate.visibleBounds, mask.absoluteBoundingBox); assert.equal(candidate.iou, 1);
  assert.match(candidate.reason, /falta comparar los píxeles/);
  assert.equal(JSON.stringify(original), before);
});

test('far positions and small unrelated overlaps produce no candidate', async () => {
  const result = await auditImageLayers([frame([
    rectangle('left', box(0, 0, 100, 100)), rectangle('right', box(900, 500, 100, 100)), rectangle('edge', box(95, 95, 100, 100)),
  ])], { isJpegOpaque: jpeg });
  assert.equal(result.candidates.length, 0);
});

test('partial coverage, alpha, blend, effects, rounded covers and different parents never become verified coverage', async () => {
  const cases = [
    { bounds: box(2, 2, 200, 200) },
    { opacity: .5 }, { blendMode: 'MULTIPLY' }, { effects: [{ type: 'LAYER_BLUR', visible: true }] },
    { cornerRadius: 20 }, { fills: [{ type: 'IMAGE', imageHash: 'upper', scaleMode: 'FIT' }] },
  ];
  for (const override of cases) {
    const lower = rectangle('lower', box(0, 0, 200, 200));
    const { bounds, ...properties } = override;
    const upper = rectangle('upper', bounds ?? box(0, 0, 200, 200), properties);
    const result = await auditImageLayers([frame([lower, upper])], { isJpegOpaque: jpeg });
    assert.equal(result.candidates[0].confidence, 'possible', JSON.stringify(override));
  }
  const grouped = { id: 'different-parent', name: 'Group', type: 'GROUP', children: [rectangle('upper', box(0, 0, 200, 200))] };
  const result = await auditImageLayers([frame([rectangle('lower', box(0, 0, 200, 200)), grouped])], { isJpegOpaque: jpeg });
  assert.equal(result.candidates[0].confidence, 'possible');
});

test('hidden images are skipped and node/candidate limits stop a broad scan', async () => {
  const source = frame([rectangle('hidden', box(0, 0, 200, 200), { visible: false }), ...Array.from({ length: 30 }, (_, i) => rectangle(`image${i}`, box(0, 0, 200, 200)))]);
  const limitedNodes = collectImageLayers([source], { maxNodes: 3 });
  assert.equal(limitedNodes.scannedNodes, 3); assert.equal(limitedNodes.warnings.length, 1);
  const result = await auditImageLayers([source], { maxCandidates: 5, isJpegOpaque: jpeg });
  assert.equal(result.scannedImages, 30); assert.equal(result.candidates.length, 5); assert.ok(result.warnings.length);
});
