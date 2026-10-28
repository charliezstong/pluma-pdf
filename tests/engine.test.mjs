import test from 'node:test';
import { readFileSync } from 'node:fs';
const expectedVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
import assert from 'node:assert/strict';
import http from 'node:http';
import sharp from 'sharp';
import { createServer } from '../engine/server.mjs';
import { optimizeImage } from '../engine/optimize.mjs';

async function withServer(options, run) {
  const server = createServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const imagePath = '/image?width=100&height=100&quality=80&flatten=0';
const clientHeaders = { 'X-Pluma-Client': '1', 'Content-Type': 'application/octet-stream' };

test('health is local, uncached and has the plugin discovery contract', async () => {
  await withServer({}, async base => {
    const response = await fetch(`${base}/health`, { headers: { Origin: 'null' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'null');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { name: 'Pluma PDF', version: expectedVersion, engine: 'sharp' });
  });
});

test('POST requires the custom client header and rejects untrusted origins', async () => {
  await withServer({}, async base => {
    const missing = await fetch(base + imagePath, { method: 'POST', body: 'bad' });
    assert.equal(missing.status, 403);
    assert.equal((await missing.json()).error.code, 'CLIENT_HEADER_REQUIRED');
    for (const origin of ['https://example.com', 'https://figma.com.evil.test', 'http://figma.com']) {
      const rejected = await fetch(base + imagePath, { method: 'POST', headers: { ...clientHeaders, Origin: origin }, body: 'bad' });
      assert.equal(rejected.status, 403);
      assert.equal(rejected.headers.get('access-control-allow-origin'), null);
    }
  });
});

test('loopback host validation rejects DNS rebinding domains', async () => {
  await withServer({}, async base => {
    const response = await new Promise((resolve, reject) => {
      const req = http.request(`${base}/health`, { headers: { Host: 'attacker.example:3847' } }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'HOST_NOT_ALLOWED');
  });
});

test('preflight allows only known local or Figma origins and headers, including private-network access', async () => {
  await withServer({}, async base => {
    for (const origin of ['null', 'https://www.figma.com', 'https://figma.com', 'http://localhost:3848']) {
      const response = await fetch(base + imagePath, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-pluma-client', 'Access-Control-Request-Private-Network': 'true' },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('access-control-allow-private-network'), 'true');
    }
    const blocked = await fetch(base + imagePath, { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Headers': 'Authorization' } });
    assert.equal(blocked.status, 403);
  });
});

test('invalid, repeated and unknown image options fail before native decoding', async () => {
  const queries = [
    'width=0&height=100', 'width=8193&height=100', 'width=10.5&height=100',
    'width=010&height=100', 'width=10&height=100&quality=39',
    'width=10&height=100&quality=101', 'width=10&height=100&flatten=true',
    'width=10&height=100&width=20', 'width=10&height=100&filename=hello', 'height=100',
  ];
  await withServer({}, async base => {
    for (const query of queries) {
      const response = await fetch(`${base}/image?${query}`, { method: 'POST', headers: clientHeaders, body: 'bad' });
      assert.equal(response.status, 400, query);
      assert.equal((await response.json()).error.code, 'INVALID_QUERY');
    }
    const invalid = await fetch(base + imagePath, { method: 'POST', headers: clientHeaders, body: 'not an image' });
    assert.equal(invalid.status, 415);
    const damaged = await fetch(base + imagePath, { method: 'POST', headers: clientHeaders, body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]) });
    assert.equal(damaged.status, 422);
    const empty = await fetch(base + imagePath, { method: 'POST', headers: clientHeaders, body: Buffer.alloc(0) });
    assert.equal(empty.status, 400);
  });
});

test('body limit rejects declared and chunked oversized bodies with structured errors', async () => {
  await withServer({ maxBodyBytes: 16 }, async base => {
    const response = await fetch(base + imagePath, { method: 'POST', headers: clientHeaders, body: Buffer.alloc(17) });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, 'BODY_TOO_LARGE');
    const chunked = await new Promise((resolve, reject) => {
      const req = http.request(base + imagePath, { method: 'POST', headers: clientHeaders }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      });
      req.on('error', reject);
      req.write(Buffer.alloc(10));
      req.end(Buffer.alloc(10));
    });
    assert.equal(chunked.status, 413);
    assert.equal(chunked.body.error.code, 'BODY_TOO_LARGE');
  });
});

test('resize preserves transparency, aspect ratio and avoids upscaling small sources', async () => {
  const input = await sharp({ create: { width: 240, height: 120, channels: 4, background: { r: 24, g: 140, b: 90, alpha: 0.5 } } }).png().toBuffer();
  await withServer({}, async base => {
    const response = await fetch(`${base}/image?width=80&height=80&quality=82&flatten=0`, { method: 'POST', headers: clientHeaders, body: input });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('x-pluma-width'), '80');
    assert.equal(response.headers.get('x-pluma-height'), '40');
    const result = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(result).metadata();
    assert.equal(metadata.width, 80);
    assert.equal(metadata.height, 40);
    assert.equal(metadata.hasAlpha, true);
    const { data } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[3] >= 126 && data[3] <= 129, 'alpha survives processing');
  });
  const small = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#f08040' } }).png().toBuffer();
  const optimized = await optimizeImage(small, { width: 100, height: 100, quality: 80 });
  assert.equal(optimized.contentType, 'image/jpeg');
  assert.equal(optimized.width, 8);
  assert.equal(optimized.height, 6);
  assert.equal((await sharp(optimized.buffer).metadata()).format, 'jpeg');
});

test('flatten composites transparency over white and produces JPEG bytes', async () => {
  const input = await sharp({ create: { width: 20, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const result = await optimizeImage(input, { width: 20, height: 10, quality: 95, flatten: true });
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(metadata.hasAlpha, false);
  const { data } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] >= 250 && data[1] >= 250 && data[2] >= 250, 'white matte is applied');
});

test('an opaque RGBA PNG uses JPEG while a genuinely transparent image stays PNG', async () => {
  const input = await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 24, g: 140, b: 90, alpha: 1 } } }).png().toBuffer();
  assert.equal((await sharp(input).metadata()).hasAlpha, true, 'fixture has an alpha channel');
  const result = await optimizeImage(input, { width: 20, height: 20, quality: 82 });
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(result.alphaPreserved, false);
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 20);
  assert.equal(metadata.height, 10);
  assert.equal(metadata.hasAlpha, false);

  const translucent = await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 24, g: 140, b: 90, alpha: 0.99 } } }).png().toBuffer();
  const withAlpha = await optimizeImage(translucent, { width: 20, height: 20, quality: 82 });
  assert.equal(withAlpha.contentType, 'image/png');
  assert.equal(withAlpha.alphaPreserved, true);
});

test('concurrency is bounded and capacity is released after completion', async () => {
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  await withServer({ maxConcurrent: 1, processImage: async () => {
    started();
    await gate;
    return { buffer: Buffer.from([1]), contentType: 'image/png', width: 1, height: 1 };
  } }, async base => {
    const pending = fetch(base + imagePath, { method: 'POST', headers: clientHeaders, body: 'a' });
    await entered;
    const busy = await fetch(base + imagePath, { method: 'POST', headers: clientHeaders, body: 'b' });
    assert.equal(busy.status, 429);
    assert.equal((await busy.json()).error.code, 'ENGINE_BUSY');
    release();
    assert.equal((await pending).status, 200);
    const available = await fetch(base + imagePath, { method: 'POST', headers: clientHeaders, body: 'c' });
    assert.equal(available.status, 200);
  });
});
