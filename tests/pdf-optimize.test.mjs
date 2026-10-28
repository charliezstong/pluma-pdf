import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, rgb,
} from 'pdf-lib';
import { optimizePDF } from '../engine/pdf-optimize.mjs';
import { createServer } from '../engine/server.mjs';

const name = value => PDFName.of(value);
const imageEntries = document => document.context.enumerateIndirectObjects().filter(([, object]) =>
  object instanceof PDFRawStream && object.dict.lookup(name('Subtype'))?.toString() === '/Image');

function pageOperators(document) {
  return document.getPages().map(page => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index))
      : contents ? [contents] : [];
    return streams.map(stream => Buffer.from(decodePDFRawStream(stream).decode()));
  });
}

async function nativePDF({ png = false, alpha = false } = {}) {
  const width = 1200;
  const height = 700;
  const channels = alpha ? 4 : 3;
  const samples = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      samples[index] = (x * 17 + y * 3) % 256;
      samples[index + 1] = (x * 5 + y * 13) % 256;
      samples[index + 2] = (x * 7 + y * 11) % 256;
      if (alpha) samples[index + 3] = x < width / 2 ? 128 : 255;
    }
  }
  let encoder = sharp(samples, { raw: { width, height, channels } });
  const image = await (png ? encoder.png() : encoder.jpeg({ quality: 99, chromaSubsampling: '4:4:4' })).toBuffer();
  const document = await PDFDocument.create();
  const page = document.addPage([600, 480]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const embedded = png ? await document.embedPng(image) : await document.embedJpg(image);
  page.drawImage(embedded, { x: 10, y: 10, width: 580, height: 340 });
  page.drawText('Native text remains selectable: Pluma PDF 123', { x: 20, y: 430, size: 15, font });
  page.drawRectangle({ x: 20, y: 380, width: 200, height: 20, color: rgb(0.8, 0.2, 0.1) });
  return Buffer.from(await document.save({ useObjectStreams: true }));
}

async function withServer(options, run) {
  const server = createServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('native PDF optimization keeps text/vector operators and the image reference, with real image savings', async () => {
  const input = await nativePDF();
  const before = await PDFDocument.load(input, { updateMetadata: false });
  const result = await optimizePDF(input, { quality: 65, maxEdge: 512 });
  const after = await PDFDocument.load(result.buffer, { updateMetadata: false });
  assert.ok(result.bytes < input.length * 0.8, 'actual image bytes shrink');
  assert.equal(result.optimizedImages, 1);
  assert.equal(result.resizedImages, 1);
  assert.equal(result.totalImages, 1);
  assert.equal(after.getPageCount(), before.getPageCount());
  assert.deepEqual(pageOperators(after), pageOperators(before), 'all text and vector drawing operators are byte-identical');
  assert.match(Buffer.concat(pageOperators(after).flat()).toString('latin1'), /Tj|TJ/, 'native text operators are present');
  const [[beforeRef]] = imageEntries(before);
  const [[afterRef, image]] = imageEntries(after);
  assert.equal(afterRef.toString(), beforeRef.toString(), 'existing XObject reference is preserved');
  const metadata = await sharp(image.contents).metadata();
  assert.ok(metadata.width <= 512 && metadata.width >= 490, 'placement budget fits the visible image within the page cap');
  assert.equal(result.placementAudit.complete, true);
  assert.equal(result.placementLimitedImages, 1);
  assert.ok(metadata.height < 512);
  assert.ok((await sharp(image.contents).stats()).channels.some(channel => channel.stdev > 20), 'the image still contains visible content');
});

test('simple Flate RGB images are replaced with correctly sized JPEG samples', async () => {
  const input = await nativePDF({ png: true });
  const result = await optimizePDF(input, { quality: 70, maxEdge: 512 });
  assert.equal(result.optimizedImages, 1);
  const after = await PDFDocument.load(result.buffer);
  const [, image] = imageEntries(after)[0];
  assert.equal(image.dict.lookup(name('Filter')).toString(), '/DCTDecode');
  assert.equal(image.dict.lookup(name('ColorSpace')).toString(), '/DeviceRGB');
  assert.ok((await sharp(image.contents).metadata()).width <= 512);
});

test('real transparency is resized coherently and cannot produce a larger download', async () => {
  const input = await nativePDF({ png: true, alpha: true });
  const result = await optimizePDF(input, { quality: 60, maxEdge: 512 });
  assert.equal(result.optimizedImages, 1);
  assert.equal(result.optimizedMasks, 1);
  assert.ok(result.bytes < input.length);
  const document = await PDFDocument.load(result.buffer);
  const [, photo] = imageEntries(document).find(([, image]) => image.dict.lookup(name('Filter')).toString().includes('DCTDecode'));
  const mask = photo.dict.lookup(name('SMask'));
  const width = mask.dict.lookup(name('Width')).asNumber(), height = mask.dict.lookup(name('Height')).asNumber();
  assert.equal(width, photo.dict.lookup(name('Width')).asNumber());
  assert.equal(height, photo.dict.lookup(name('Height')).asNumber());
  const alpha = decodePDFRawStream(mask).decode();
  assert.equal(alpha.length, width * height);
  assert.ok(alpha[Math.floor(height / 2) * width + Math.floor(width / 4)] >= 126);
  assert.ok(alpha[Math.floor(height / 2) * width + Math.floor(width / 4)] <= 129);
  assert.ok(alpha[Math.floor(height / 2) * width + Math.floor(width * 3 / 4)] >= 253);
});

test('ambiguous DCT ColorTransform and Flate DecodeParms are skipped without changing the PDF', async () => {
  for (const png of [false, true]) {
    const document = await PDFDocument.load(await nativePDF({ png }));
    const [, image] = imageEntries(document)[0];
    const params = PDFDict.withContext(document.context);
    params.set(name(png ? 'Predictor' : 'ColorTransform'), document.context.obj(png ? 1 : 0));
    image.dict.set(name('DecodeParms'), params);
    const input = Buffer.from(await document.save());
    const result = await optimizePDF(input, { quality: 60, maxEdge: 512 });
    assert.equal(result.optimizedImages, 0);
    assert.equal(result.skippedImages, 1);
    assert.deepEqual(result.buffer, input);
  }
});

test('PDF API validates file input and options before processing', async () => {
  await assert.rejects(optimizePDF(Buffer.from('not a PDF')), { code: 'INVALID_PDF' });
  await assert.rejects(optimizePDF(Buffer.from('%PDF-invalid')), { code: 'INVALID_PDF' });
  await assert.rejects(optimizePDF(Buffer.alloc(0)), { code: 'EMPTY_PDF' });
  for (const options of [{ quality: 39 }, { quality: 101 }, { quality: 50.5 }, { maxEdge: 511 }, { maxEdge: 8193 }]) {
    await assert.rejects(optimizePDF(Buffer.from('x'), options), { code: 'INVALID_QUERY' });
  }
});

test('HTTP PDF route exposes byte/image counts and retains loopback authentication and CORS protections', async () => {
  const input = await nativePDF();
  await withServer({}, async base => {
    const response = await fetch(`${base}/pdf?quality=65&maxEdge=512`, { method: 'POST', headers: { 'X-Pluma-Client': '1', 'Content-Type': 'application/pdf', Origin: 'null' }, body: input });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('x-pluma-original-bytes'), String(input.length));
    assert.equal(response.headers.get('x-pluma-optimized-images'), '1');
    assert.equal(response.headers.get('x-pluma-skipped-images'), '0');
    const output = Buffer.from(await response.arrayBuffer());
    assert.equal(response.headers.get('x-pluma-bytes'), String(output.length));
    assert.equal((await PDFDocument.load(output)).getPageCount(), 1);
    assert.equal((await fetch(`${base}/pdf`, { method: 'POST', body: input })).status, 403);
    for (const query of ['maxEdge=0', 'quality=1000', 'quality=82&quality=80', 'maxEdge=512&file=x', 'maxEdge=0512']) {
      const bad = await fetch(`${base}/pdf?${query}`, { method: 'POST', headers: { 'X-Pluma-Client': '1' }, body: input });
      assert.equal(bad.status, 400, query);
    }
    const preflight = await fetch(`${base}/pdf`, { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-pluma-client,content-type', 'Access-Control-Request-Private-Network': 'true' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
  });
});

test('PDF body limit is separate from the 40 MiB image limit and can be bounded in tests', async () => {
  await withServer({ maxPdfBodyBytes: 16 }, async base => {
    const response = await fetch(`${base}/pdf`, { method: 'POST', headers: { 'X-Pluma-Client': '1' }, body: Buffer.alloc(17) });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, 'BODY_TOO_LARGE');
  });
});

test('real private Figma fixture keeps both photos, native operators, ICC profile and coherent nonopaque alpha', { skip: !process.env.PLUMA_PDF_FIXTURE }, async () => {
  const input = await fs.readFile(process.env.PLUMA_PDF_FIXTURE);
  const before = await PDFDocument.load(input, { updateMetadata: false });
  const result = await optimizePDF(input, { quality: 82, maxEdge: 2400 });
  const after = await PDFDocument.load(result.buffer, { updateMetadata: false });
  assert.ok(result.savedBytes > 0, 'the private opt-in fixture has nonzero image savings');
  assert.equal(result.optimizedImages, 2);
  assert.equal(result.skippedImages, 0);
  assert.equal(result.totalImages, 2);
  assert.deepEqual(pageOperators(after), pageOperators(before), 'all native page operators survive');
  const originalImages = new Map(imageEntries(before).map(([ref, stream]) => [ref.toString(), stream]));
  const afterImages = new Map(imageEntries(after).map(([ref, stream]) => [ref.toString(), stream]));
  const photoRefs = [...originalImages].filter(([, image]) => image.dict.lookup(name('Filter')).toString().includes('DCTDecode'));
  assert.equal(photoRefs.length, 2);
  let replaced = 0;
  for (const [ref, original] of photoRefs) {
    const current = afterImages.get(ref);
    assert.ok(current, `photo reference ${ref} remains`);
    assert.equal(current.dict.get(name('ColorSpace')).toString(), original.dict.get(name('ColorSpace')).toString(), 'PDF ICC profile reference remains');
    if (!Buffer.from(current.contents).equals(Buffer.from(original.contents))) {
      replaced += 1;
      const metadata = await sharp(current.contents).metadata();
      assert.ok(metadata.width <= 2400);
      assert.ok((await sharp(current.contents).stats()).channels.some(channel => channel.stdev > 10), 'optimized photo is visible');
    }
    const originalMask = original.dict.lookup(name('SMask'));
    const originalAlpha = decodePDFRawStream(originalMask).decode();
    const currentMask = current.dict.lookup(name('SMask'));
    if (originalAlpha.every(sample => sample === 255)) assert.equal(currentMask, undefined, 'only a fully opaque mask is removed');
    else {
      assert.ok(currentMask, 'real transparency remains attached');
      const width = currentMask.dict.lookup(name('Width')).asNumber(), height = currentMask.dict.lookup(name('Height')).asNumber();
      assert.equal(width, current.dict.lookup(name('Width')).asNumber());
      assert.equal(height, current.dict.lookup(name('Height')).asNumber());
      const expected = await sharp(originalAlpha, { raw: { width: originalMask.dict.lookup(name('Width')).asNumber(), height: originalMask.dict.lookup(name('Height')).asNumber(), channels: 1 } })
        .resize({ width, height, fit: 'fill' }).toColourspace('b-w').raw().toBuffer();
      const actual = decodePDFRawStream(currentMask).decode();
      let error = 0;
      for (let index = 0; index < actual.length; index += 1) error += Math.abs(actual[index] - expected[index]);
      assert.ok(error / actual.length < 1, 'lossless alpha samples follow the same resampling geometry');
    }
  }
  assert.equal(replaced, 2);
});
