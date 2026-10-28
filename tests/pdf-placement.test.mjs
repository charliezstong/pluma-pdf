import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { auditPDFPlacements, inspectImageOperatorList, normalizeImageRef } from '../engine/pdf-placement.mjs';

const metadata = { one: { ref: '11R', width: 400, height: 200 }, two: { ref: '12R2', width: 400, height: 200 } };
const list = operations => ({ fnArray: operations.map(([fn]) => fn), argsArray: operations.map(([, args]) => args) });
const inspect = operations => inspectImageOperatorList(list(operations), { pageWidth: 1000, pageHeight: 500, maxEdge: 1000, resolveImage: async id => metadata[id] });

test('PDF.js refs normalize to exact pdf-lib keys, including nonzero generations', () => {
  assert.equal(normalizeImageRef('9079R'), '9079 0 R');
  assert.equal(normalizeImageRef('12R2'), '12 2 R');
  assert.equal(normalizeImageRef('12 2 R'), '12 2 R');
  assert.equal(normalizeImageRef({ num: 12, gen: 2 }), '12 2 R');
  assert.equal(normalizeImageRef('img_p1_1'), undefined);
});

test('save/restore and form matrices retain the maximum placement of reused images', async () => {
  const result = await inspect([
    [OPS.save, []], [OPS.transform, [100, 0, 0, 50, 20, 30]], [OPS.paintImageXObject, ['one']], [OPS.restore, []],
    [OPS.paintFormXObjectBegin, [[0, 2, -2, 0, 10, 10], [0, 0, 100, 100]]],
    [OPS.transform, [120, 0, 0, 60, 0, 0]], [OPS.paintImageXObject, ['one']], [OPS.paintFormXObjectEnd, []],
    [OPS.transform, [20, 0, 0, 10, 0, 0]], [OPS.paintImageXObject, ['two']],
  ]);
  const image = result.images.get('11 0 R');
  assert.equal(image.requiredWidth, 240); assert.equal(image.requiredHeight, 120); assert.equal(image.uses, 2);
  assert.deepEqual([...image.blockedReasons], []);
  assert.equal(result.images.get('12 2 R').requiredWidth, 20, 'form state must restore after exit');
});

test('group matrix is not multiplied twice; complex groups and repeat uses force global fallback', async () => {
  const result = await inspect([
    [OPS.beginGroup, [{ matrix: [2, 0, 0, 2, 0, 0] }]],
    [OPS.paintFormXObjectBegin, [[2, 0, 0, 2, 0, 0], null]],
    [OPS.transform, [100, 0, 0, 50, 0, 0]], [OPS.paintImageXObject, ['one']],
    [OPS.paintFormXObjectEnd, []], [OPS.endGroup, []],
    [OPS.transform, [40, 0, 0, 20, 0, 0]], [OPS.paintImageXObjectRepeat, ['two', 1, 1, [0, 0]]],
  ]);
  assert.equal(result.images.get('11 0 R').requiredWidth, 200);
  assert.ok(result.images.get('11 0 R').blockedReasons.has('complexGroup'));
  assert.ok(result.images.get('12 2 R').blockedReasons.has('repeat'));
});

test('a simple group does not change content CTM and unresolved images invalidate coverage', async () => {
  const result = await inspect([
    [OPS.beginGroup, [{ matrix: null, smask: null, knockout: false, needsIsolation: false }]],
    [OPS.transform, [100, 0, 0, 50, 0, 0]], [OPS.paintImageXObject, ['one']], [OPS.endGroup, []],
    [OPS.paintImageXObject, ['missing']],
  ]);
  assert.equal(result.images.get('11 0 R').requiredWidth, 100);
  assert.deepEqual([...result.images.get('11 0 R').blockedReasons], []);
  assert.equal(result.unresolvedImages, 1);
});

test('an image reused in a tiling pattern is blocked even if its normal use was measurable', async () => {
  const pattern = list([[OPS.paintImageXObject, ['one']]]);
  const result = await inspect([
    [OPS.transform, [100, 0, 0, 50, 0, 0]], [OPS.paintImageXObject, ['one']],
    [OPS.setFillColorN, ['TilingPattern', null, pattern, [1, 0, 0, 1, 0, 0], [0, 0, 100, 100], 100, 100, 1, 1]],
  ]);
  assert.ok(result.images.get('11 0 R').blockedReasons.has('tilingPattern'));
  assert.equal(result.images.get('11 0 R').uses, 2);
});

test('unbalanced graphics state conservatively blocks earlier observations', async () => {
  const result = await inspect([[OPS.transform, [100, 0, 0, 50, 0, 0]], [OPS.paintImageXObject, ['one']], [OPS.restore, []]]);
  assert.ok(result.images.get('11 0 R').blockedReasons.has('unknownGraphicsState'));
});

async function fixture(pages = 1) {
  const pdf = await PDFDocument.create();
  const jpeg = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#123456' } }).jpeg().toBuffer();
  const image = await pdf.embedJpg(jpeg);
  for (let i = 0; i < pages; i++) pdf.addPage([1000, 500]).drawImage(image, { x: 20, y: 20, width: i ? 300 : 100, height: i ? 150 : 50 });
  return pdf.save();
}

test('real PDF audit merges all-page uses, preserves input bytes and returns integer target boxes', async () => {
  const input = await fixture(2), before = Buffer.from(input);
  const result = await auditPDFPlacements(input, { maxEdge: 1000 });
  assert.equal(result.complete, true); assert.equal(result.stats.pagesAudited, 2);
  assert.equal(result.imageLimits.size, 1);
  assert.deepEqual([...result.imageLimits.values()], [{ width: 300, height: 150 }]);
  assert.deepEqual(Buffer.from(input), before);
  assert.equal(result.images[0].uses, 2);
});

test('partial page inspection never provides a production optimization map', async () => {
  const result = await auditPDFPlacements(await fixture(2), { maxEdge: 1000, pageNumbers: [1] });
  assert.equal(result.complete, false); assert.equal(result.imageLimits.size, 0);
  assert.ok(result.warnings.includes('partialPageCoverage'));
});

test('page and option limits are bounded before processing', async () => {
  await assert.rejects(() => auditPDFPlacements(new Uint8Array()), /Expected PDF bytes/);
  await assert.rejects(() => auditPDFPlacements(new Uint8Array([1]), { timeoutMs: 90001 }), /timeoutMs/);
  const result = await auditPDFPlacements(await fixture(2), { maxPages: 1 });
  assert.equal(result.complete, false); assert.equal(result.imageLimits.size, 0);
  assert.ok(result.warnings.includes('PLACEMENT_PAGE_LIMIT'));
});
