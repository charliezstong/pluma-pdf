import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFRawStream, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { deduplicatePDF } from '../engine/pdf-deduplicate.mjs';
import { createServer } from '../engine/server.mjs';

const name = value => PDFName.of(value);
const imageEntries = document => document.context.enumerateIndirectObjects().filter(([, object]) =>
  object instanceof PDFRawStream && object.dict.lookup(name('Subtype'))?.toString() === '/Image');
const operators = document => document.getPages().map(page => {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index)) : [contents];
  return streams.filter(Boolean).map(stream => Buffer.from(decodePDFRawStream(stream).decode()));
});

async function duplicateFixture({ differentMask = false, differentICC = false } = {}) {
  const width = 600, height = 300;
  const document = await PDFDocument.create();
  let icc;
  for (let copy = 0; copy < 2; copy += 1) {
    const pixels = Buffer.alloc(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      pixels[index * 4] = index % 251;
      pixels[index * 4 + 1] = index * 13 % 251;
      pixels[index * 4 + 2] = index * 31 % 251;
      pixels[index * 4 + 3] = differentMask && copy ? 255 - index % 255 : index % 255;
    }
    let image;
    if (differentICC) {
      const jpeg = await sharp(pixels, { raw: { width, height, channels: 4 } }).removeAlpha().withIccProfile('srgb').jpeg().toBuffer();
      icc ??= (await sharp(jpeg).metadata()).icc;
      image = await document.embedJpg(jpeg);
    } else {
      image = await document.embedPng(await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer());
    }
    document.addPage([600, 300]).drawImage(image, { x: 0, y: 0, width: 600, height: 300 });
  }
  const parsed = await PDFDocument.load(await document.save());
  if (differentICC) {
    const entries = imageEntries(parsed);
    for (let index = 0; index < entries.length; index += 1) {
      const profile = Buffer.from(icc);
      profile[25] = (profile[25] + index) % 256; // Different valid profile creation year metadata.
      const profileRef = parsed.context.register(parsed.context.flateStream(profile, { N: 3, Alternate: name('DeviceRGB') }));
      entries[index][1].dict.set(name('ColorSpace'), parsed.context.obj([name('ICCBased'), profileRef]));
    }
  }
  return Buffer.from(await parsed.save());
}

test('final PDF deduplication preserves every encoded pixel stream and page operator', async () => {
  const input = await duplicateFixture();
  const before = await PDFDocument.load(input);
  const result = await deduplicatePDF(input);
  const after = await PDFDocument.load(result.buffer);
  assert.ok(result.bytes < input.length);
  assert.equal(result.deduplicatedImages, 2, 'one duplicate image and one duplicate alpha stream');
  assert.equal(after.getPageCount(), 2);
  assert.deepEqual(operators(after), operators(before));
  const originalEncoded = new Set(imageEntries(before).map(([, stream]) => Buffer.from(stream.contents).toString('base64')));
  for (const [, stream] of imageEntries(after)) assert.ok(originalEncoded.has(Buffer.from(stream.contents).toString('base64')));
  assert.equal(imageEntries(after).length, 2);
});

test('equal color bytes with different masks or ICC profile bytes remain distinct', async () => {
  for (const options of [{ differentMask: true }, { differentICC: true }]) {
    const input = await duplicateFixture(options);
    const result = await deduplicatePDF(input);
    assert.equal(result.deduplicatedImages, 0, JSON.stringify(options));
    assert.deepEqual(result.buffer, input);
  }
});

test('HTTP finalization shares PDF authentication, body limits, CORS and byte count headers', async () => {
  const input = await duplicateFixture();
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/pdf/deduplicate`, { method: 'POST', headers: { 'X-Pluma-Client': '1', Origin: 'null' }, body: input });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('x-pluma-deduplicated-images'), '2');
    assert.equal(response.headers.get('x-pluma-original-bytes'), String(input.length));
    const output = await response.arrayBuffer();
    assert.equal(response.headers.get('x-pluma-bytes'), String(output.byteLength));
    assert.match(response.headers.get('access-control-expose-headers'), /X-Pluma-Deduplicated-Images/);
    assert.equal((await fetch(`${base}/pdf/deduplicate`, { method: 'POST', body: input })).status, 403);
    assert.equal((await fetch(`${base}/pdf/deduplicate?quality=80`, { method: 'POST', headers: { 'X-Pluma-Client': '1' }, body: input })).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
