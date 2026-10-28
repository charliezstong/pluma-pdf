import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import pdfLib from 'pdf-lib';
import { inflateSync } from 'node:zlib';
import { optimizePDF, deduplicateImageStreams } from '../engine/pdf-optimize.mjs';
const { PDFDocument, PDFRawStream, PDFName, PDFDict } = pdfLib;
const name = value => PDFName.of(value);
const images = document => document.context.enumerateIndirectObjects().filter(([, object]) =>
  object instanceof PDFRawStream && object.dict.lookup(name('Subtype'))?.toString() === '/Image' && object.dict.lookup(name('ColorSpace'))?.toString() === '/DeviceRGB');

async function source({ count = 1, shared = false, skipSecond = false, matte = false, distinct = false } = {}) {
  const width = 1100, height = 700;
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const x = index % width, y = Math.floor(index / width);
    pixels[index * 4] = (x * 17 + y * 3) % 256;
    pixels[index * 4 + 1] = (x * 5 + y * 13) % 256;
    pixels[index * 4 + 2] = (x * 7 + y * 11) % 256;
    pixels[index * 4 + 3] = Math.round(x / (width - 1) * 255);
  }
  const png = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) {
    let imageBytes = png;
    if (distinct && index > 0) {
      const changed = Buffer.from(pixels);
      changed[4000] ^= 31;
      imageBytes = await sharp(changed, { raw: { width, height, channels: 4 } }).png().toBuffer();
    }
    const image = await document.embedPng(imageBytes);
    document.addPage([600, 400]).drawImage(image, { x: 0, y: 0, width: 600, height: 400 });
  }
  const parsed = await PDFDocument.load(await document.save());
  const entries = images(parsed);
  const maskRef = entries[0][1].dict.get(name('SMask'));
  if (shared) {
    parsed.context.delete(entries[1][1].dict.get(name('SMask')));
    entries[1][1].dict.set(name('SMask'), maskRef);
  }
  if (skipSecond) {
    const parameters = PDFDict.withContext(parsed.context);
    parameters.set(name('Predictor'), parsed.context.obj(1));
    entries[1][1].dict.set(name('DecodeParms'), parameters);
  }
  if (matte) parsed.context.lookup(maskRef).dict.set(name('Matte'), parsed.context.obj([0, 0, 0]));
  return { input: Buffer.from(await parsed.save()), pixels, width, height, maskRef };
}

test('resizing premultiplies RGBA and writes an exact lossless alpha plane', async () => {
  const fixture = await source();
  const result = await optimizePDF(fixture.input, { quality: 82, maxEdge: 512 });
  assert.equal(result.optimizedImages, 1, JSON.stringify(result.stats));
  assert.equal(result.optimizedMasks, 1);
  assert.ok(result.bytes < fixture.input.length);
  const output = await PDFDocument.load(result.buffer);
  const [, photo] = images(output)[0];
  const jpeg = await sharp(photo.contents).metadata();
  assert.equal(jpeg.width, 512);
  const mask = photo.dict.lookup(name('SMask'));
  assert.equal(mask.dict.lookup(name('Width')).asNumber(), jpeg.width);
  assert.equal(mask.dict.lookup(name('Height')).asNumber(), jpeg.height);
  const expected = await sharp(fixture.pixels, { raw: { width: fixture.width, height: fixture.height, channels: 4 } })
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const alpha = Buffer.alloc(expected.info.width * expected.info.height);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = expected.data[index * 4 + 3];
  assert.deepEqual(inflateSync(mask.contents), alpha);
  assert.equal(output.context.lookup(fixture.maskRef), undefined, 'unreferenced source mask is removed');
});

test('a shared source mask remains intact for another skipped photo', async () => {
  const fixture = await source({ count: 2, shared: true, skipSecond: true });
  const before = await PDFDocument.load(fixture.input);
  const originalMask = before.context.lookup(fixture.maskRef);
  const result = await optimizePDF(fixture.input, { quality: 82, maxEdge: 512 });
  assert.equal(result.optimizedImages, 1, JSON.stringify(result.stats));
  assert.equal(result.skippedImages, 1);
  const after = await PDFDocument.load(result.buffer);
  const outputImages = images(after);
  assert.equal(outputImages[1][1].dict.get(name('SMask')).toString(), fixture.maskRef.toString());
  assert.deepEqual(after.context.lookup(fixture.maskRef).contents, originalMask.contents);
  assert.notEqual(outputImages[0][1].dict.get(name('SMask')).toString(), fixture.maskRef.toString());
});

test('each changed photo receives its own mask and no shared reference is mutated', async () => {
  const fixture = await source({ count: 2, shared: true, distinct: true });
  const result = await optimizePDF(fixture.input, { quality: 82, maxEdge: 512 });
  assert.equal(result.optimizedImages, 2, JSON.stringify(result.stats));
  assert.equal(result.optimizedMasks, 2);
  const after = await PDFDocument.load(result.buffer);
  const refs = images(after).map(([, image]) => image.dict.get(name('SMask')).toString());
  assert.equal(new Set(refs).size, 2);
  assert.equal(after.context.lookup(fixture.maskRef), undefined);
});

test('a Matte mask remains unsupported and the original PDF is returned unchanged', async () => {
  const fixture = await source({ matte: true });
  const result = await optimizePDF(fixture.input, { quality: 82, maxEdge: 512 });
  assert.equal(result.optimizedImages, 0);
  assert.deepEqual(result.buffer, fixture.input);
});

test('exact image and equivalent mask streams deduplicate without changing operators', async () => {
  const fixture = await source({ count: 2 });
  const document = await PDFDocument.load(fixture.input);
  const beforeOps = document.getPages().map(page => page.node.Contents().asArray().map(ref => document.context.lookup(ref).contents));
  assert.equal(deduplicateImageStreams(document.context), 2, 'one image plus its equivalent mask');
  const afterOps = document.getPages().map(page => page.node.Contents().asArray().map(ref => document.context.lookup(ref).contents));
  assert.deepEqual(afterOps, beforeOps);
  assert.equal(images(document).length, 1);
  const resources = document.getPages().map(page => page.node.Resources().lookup(name('XObject')));
  assert.equal(resources[0].values()[0].toString(), resources[1].values()[0].toString());
});

test('optional placement pixel limits override the global cap without upscaling', async () => {
  const fixture = await source();
  const document = await PDFDocument.load(fixture.input);
  const [ref] = images(document)[0];
  const result = await optimizePDF(fixture.input, { quality: 82, maxEdge: 2560, imageLimits: new Map([[ref.toString(), { width: 192, height: 192 }]]) });
  const output = await PDFDocument.load(result.buffer);
  const [, photo] = images(output)[0];
  const metadata = await sharp(photo.contents).metadata();
  assert.equal(metadata.width, 192);
  assert.ok(metadata.height <= 192);
  assert.equal(result.placementLimitedImages, 1);
});

test('deduplicated images retain the largest placement across their original aliases', async () => {
  const fixture = await source({ count: 2 });
  const document = await PDFDocument.load(fixture.input);
  const refs = images(document).map(([ref]) => ref.toString());
  const result = await optimizePDF(fixture.input, { quality: 82, maxEdge: 2560,
    imageLimits: new Map([[refs[0], { width: 192, height: 192 }], [refs[1], { width: 512, height: 512 }]]) });
  const output = await PDFDocument.load(result.buffer);
  assert.equal((await sharp(images(output)[0][1].contents).metadata()).width, 512);
});

test('a complete Flate sample plane with a missing trailer is safely recovered', async () => {
  const fixture = await source();
  const document = await PDFDocument.load(fixture.input);
  const [, photo] = images(document)[0];
  const mask = photo.dict.lookup(name('SMask'));
  mask.contents = mask.contents.subarray(0, mask.contents.length - 4);
  const input = Buffer.from(await document.save());
  const result = await optimizePDF(input, { quality: 82, maxEdge: 512 });
  assert.equal(result.optimizedImages, 1, JSON.stringify(result.stats));
  assert.equal(result.optimizedMasks, 1);
});
