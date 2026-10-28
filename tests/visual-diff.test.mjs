import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Compile only this module in memory. This suite never writes or rebuilds dist.
const compiled = await build({ entryPoints: ['src/visual-diff.ts'], bundle: true, format: 'esm', write: false, platform: 'node' });
const { computePixelDiff, compareRenderedImages, CHANGED_CHANNEL_THRESHOLD, DIFFERENCE_AMPLIFICATION } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const rgba = values => new Uint8ClampedArray(values);

test('exact equality includes all RGBA bytes and creates an opaque black heatmap', () => {
  const input = rgba([14, 35, 202, 255, 99, 18, 60, 0]);
  const result = computePixelDiff(input, input.slice(), 2, 1);
  assert.equal(result.identical, true);
  assert.equal(result.meanAbsoluteError, 0);
  assert.equal(result.changedPixelsPercent, 0);
  assert.equal(result.width, 2);
  assert.equal(result.height, 1);
  assert.deepEqual(result.differencePixels, rgba([0, 0, 0, 255, 0, 0, 0, 255]));
});

test('a one-byte change is not identical even when below the reporting threshold', () => {
  const result = computePixelDiff(rgba([0, 0, 0, 255]), rgba([1, 0, 0, 255]), 1, 1);
  assert.equal(result.identical, false);
  assert.equal(result.meanAbsoluteError, 0.25);
  assert.equal(result.changedPixelsPercent, 0);
  assert.deepEqual(result.differencePixels, rgba([4, 0, 0, 255]));
});

test('threshold 8 counts a pixel once only when some channel differs by more than 8', () => {
  assert.equal(CHANGED_CHANNEL_THRESHOLD, 8);
  const result = computePixelDiff(rgba([0, 0, 0, 255, 0, 0, 0, 255]), rgba([8, 8, 8, 255, 9, 50, 0, 255]), 2, 1);
  assert.equal(result.identical, false);
  assert.equal(result.changedPixelsPercent, 50);
  assert.equal(result.meanAbsoluteError, 83 / 8);
});

test('alpha alone affects equality, the error metric, and the visible heatmap', () => {
  const result = computePixelDiff(rgba([0, 0, 0, 0]), rgba([0, 0, 0, 255]), 1, 1);
  assert.equal(result.identical, false);
  assert.equal(result.meanAbsoluteError, 63.75);
  assert.equal(result.changedPixelsPercent, 100);
  assert.deepEqual(result.differencePixels, rgba([255, 255, 255, 255]));
});

test('hidden RGB differences still invalidate exact RGBA identity', () => {
  const result = computePixelDiff(rgba([0, 0, 0, 0]), rgba([10, 0, 0, 0]), 1, 1);
  assert.equal(result.identical, false);
  assert.equal(result.changedPixelsPercent, 100);
  assert.equal(result.meanAbsoluteError, 2.5);
});

test('the heatmap amplifies each difference by four and clamps at 255', () => {
  assert.equal(DIFFERENCE_AMPLIFICATION, 4);
  const result = computePixelDiff(rgba([1, 2, 3, 255]), rgba([3, 18, 103, 255]), 1, 1);
  assert.deepEqual(result.differencePixels, rgba([8, 64, 255, 255]));
});

test('mean absolute error uses every channel and changed percentage uses every pixel', () => {
  const result = computePixelDiff(rgba([255, 255, 255, 255, 24, 50, 70, 255]), rgba([0, 0, 0, 255, 24, 50, 70, 255]), 2, 1);
  assert.equal(result.meanAbsoluteError, 95.625);
  assert.equal(result.changedPixelsPercent, 50);
});

test('a missing photograph replaced by a purple placeholder is detected', () => {
  const width = 13, height = 9;
  const photo = new Uint8ClampedArray(width * height * 4);
  const missing = new Uint8ClampedArray(photo.length);
  for (let index = 0; index < width * height; index++) {
    photo.set([(index * 37 + 11) % 256, (index * 61 + 34) % 256, (index * 17 + 79) % 256, 255], index * 4);
    missing.set([155, 90, 195, 255], index * 4);
  }
  const result = computePixelDiff(photo, missing, width, height);
  assert.equal(result.identical, false);
  assert.equal(result.changedPixelsPercent, 100);
  assert.ok(result.meanAbsoluteError > 50);
  assert.ok(result.differencePixels.some((value, index) => index % 4 !== 3 && value > 0));
});

test('comparison is deterministic and does not mutate either input', () => {
  const before = rgba([1, 2, 3, 4, 88, 99, 111, 255]);
  const after = rgba([11, 22, 33, 44, 88, 100, 110, 250]);
  const originalBefore = before.slice(), originalAfter = after.slice();
  const first = computePixelDiff(before, after, 1, 2);
  const second = computePixelDiff(before, after, 1, 2);
  assert.deepEqual(first, second);
  assert.deepEqual(before, originalBefore);
  assert.deepEqual(after, originalAfter);
  assert.notEqual(first.differencePixels, before);
});

test('invalid dimensions and inconsistent RGBA buffers are rejected', () => {
  for (const [width, height] of [[0, 1], [-1, 2], [1.5, 2], [1, Infinity], [NaN, 1], [Number.MAX_SAFE_INTEGER, 2]]) {
    assert.throws(() => computePixelDiff(rgba([]), rgba([]), width, height), /dimensiones/);
  }
  assert.throws(() => computePixelDiff(rgba([1, 2, 3]), rgba([1, 2, 3, 4]), 1, 1), /buffers RGBA/);
  assert.throws(() => computePixelDiff(rgba([1, 2, 3, 4]), rgba([1, 2, 3, 4]), 2, 1), /buffers RGBA/);
});

test('the browser adapter rejects remote URLs and non-PNG sources before decoding', async () => {
  await assert.rejects(compareRenderedImages('https://example.com/image.png', 'data:image/png;base64,eA=='), /PNG locales/);
  await assert.rejects(compareRenderedImages('data:image/svg+xml,<svg/>', 'data:image/png;base64,eA=='), /PNG locales/);
});
