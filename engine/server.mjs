import http from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ImageError, optimizeImage } from './optimize.mjs';
import { MAX_PDF_BYTES, PDFError, optimizePDF, validatePDFOptions } from './pdf-optimize.mjs';
import { deduplicatePDF } from './pdf-deduplicate.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export const DEFAULT_PORT = 3847;
export const MAX_BODY_BYTES = 40 * 1024 * 1024;

function permittedHost(host) {
  if (typeof host !== 'string') return false;
  const match = /^(?:localhost|127\.0\.0\.1)(?::([1-9]\d{0,4}))?$/i.exec(host);
  return Boolean(match) && (!match[1] || Number(match[1]) <= 65535);
}

function permittedOrigin(origin) {
  if (!origin || origin === 'null') return true;
  if (origin === 'https://www.figma.com' || origin === 'https://figma.com') return true;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1'].includes(url.hostname)
      && url.origin === origin;
  } catch {
    return false;
  }
}

function json(res, status, code, message) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify({ error: { code, message } });
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function parseOptions(searchParams) {
  const names = new Set(['width', 'height', 'quality', 'flatten']);
  for (const [key] of searchParams) {
    if (!names.has(key) || searchParams.getAll(key).length !== 1) {
      throw new ImageError('INVALID_QUERY', 'La consulta contiene parámetros desconocidos o repetidos.', 400);
    }
  }
  function integer(name, min, max, fallback) {
    const raw = searchParams.get(name);
    if (raw === null && fallback !== undefined) return fallback;
    if (raw === null || !/^[1-9]\d*$/.test(raw)) {
      throw new ImageError('INVALID_QUERY', `${name} debe ser un entero entre ${min} y ${max}.`, 400);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new ImageError('INVALID_QUERY', `${name} debe ser un entero entre ${min} y ${max}.`, 400);
    }
    return value;
  }
  const flatten = searchParams.get('flatten') ?? '0';
  if (flatten !== '0' && flatten !== '1') {
    throw new ImageError('INVALID_QUERY', 'flatten debe ser 0 o 1.', 400);
  }
  return {
    width: integer('width', 1, 8192),
    height: integer('height', 1, 8192),
    quality: integer('quality', 40, 100, 82),
    flatten: flatten === '1',
  };
}

async function readBody(req, maxBodyBytes) {
  const declaredLength = req.headers['content-length'];
  if (declaredLength !== undefined && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBodyBytes)) {
    throw new ImageError('BODY_TOO_LARGE', 'El archivo supera el tamaño máximo permitido.', 413);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new ImageError('BODY_TOO_LARGE', 'El archivo supera el tamaño máximo permitido.', 413);
    }
    chunks.push(chunk);
  }
  if (!size) throw new ImageError('EMPTY_BODY', 'Envía los bytes de un archivo.', 400);
  return Buffer.concat(chunks, size);
}

function parsePDFOptions(searchParams) {
  for (const [key] of searchParams) {
    if (!['quality', 'maxEdge'].includes(key) || searchParams.getAll(key).length !== 1) {
      throw new PDFError('INVALID_QUERY', 'La consulta contiene parámetros desconocidos o repetidos.', 400);
    }
  }
  const options = {};
  for (const key of ['quality', 'maxEdge']) {
    if (!searchParams.has(key)) continue;
    const raw = searchParams.get(key);
    if (!/^[1-9]\d*$/.test(raw)) throw new PDFError('INVALID_QUERY', `${key} debe ser un entero.`, 400);
    options[key] = Number(raw);
  }
  return validatePDFOptions(options);
}

/** A loopback-only server when started below. Tests may listen on an ephemeral port. */
export function createServer({ maxBodyBytes = MAX_BODY_BYTES, maxPdfBodyBytes = MAX_PDF_BYTES, maxConcurrent = 2, processImage = optimizeImage, processPDF = optimizePDF, processDeduplicatePDF = deduplicatePDF } = {}) {
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > MAX_BODY_BYTES) throw new TypeError('Invalid body limit');
  if (!Number.isSafeInteger(maxPdfBodyBytes) || maxPdfBodyBytes < 1 || maxPdfBodyBytes > MAX_PDF_BYTES) throw new TypeError('Invalid PDF body limit');
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 2) throw new TypeError('Invalid concurrency limit');
  let active = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    if (!permittedHost(req.headers.host)) {
      req.resume();
      json(res, 403, 'HOST_NOT_ALLOWED', 'Usa localhost o 127.0.0.1 para acceder al motor local.');
      return;
    }
    const origin = req.headers.origin;
    if (!permittedOrigin(origin)) {
      req.resume();
      json(res, 403, 'ORIGIN_NOT_ALLOWED', 'Este origen no puede usar el motor local.');
      return;
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Expose-Headers', 'X-Pluma-Width, X-Pluma-Height, X-Pluma-Original-Bytes, X-Pluma-Bytes, X-Pluma-Optimized-Images, X-Pluma-Skipped-Images, X-Pluma-Deduplicated-Images');

    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      req.resume();
      json(res, 400, 'INVALID_URL', 'La dirección no es válida.');
      return;
    }

    if (req.method === 'OPTIONS') {
      if (!['/image', '/pdf', '/pdf/deduplicate', '/health'].includes(url.pathname)) {
        json(res, 404, 'NOT_FOUND', 'Ruta no disponible.');
        return;
      }
      const requestMethod = req.headers['access-control-request-method'];
      const requestHeaders = (req.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      if ((requestMethod && !['GET', 'POST'].includes(requestMethod))
        || requestHeaders.some(header => !['x-pluma-client', 'content-type'].includes(header))) {
        json(res, 403, 'PREFLIGHT_NOT_ALLOWED', 'La solicitud CORS no está permitida.');
        return;
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'X-Pluma-Client, Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      if (req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      const body = JSON.stringify({ name: 'Pluma PDF', version: VERSION, engine: 'sharp' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (!['/image', '/pdf', '/pdf/deduplicate'].includes(url.pathname)) {
      req.resume();
      json(res, 404, 'NOT_FOUND', 'Ruta no disponible.');
      return;
    }
    if (req.method !== 'POST') {
      req.resume();
      res.setHeader('Allow', 'POST, OPTIONS');
      json(res, 405, 'METHOD_NOT_ALLOWED', 'Usa POST para optimizar el archivo.');
      return;
    }
    if (req.headers['x-pluma-client'] !== '1') {
      req.resume();
      json(res, 403, 'CLIENT_HEADER_REQUIRED', 'Falta el encabezado X-Pluma-Client: 1.');
      return;
    }
    if (active >= maxConcurrent) {
      req.resume();
      res.setHeader('Retry-After', '1');
      json(res, 429, 'ENGINE_BUSY', 'El motor está ocupado. Inténtalo de nuevo en un momento.');
      return;
    }

    active += 1;
    try {
      const deduplicate = url.pathname === '/pdf/deduplicate';
      const pdf = url.pathname === '/pdf' || deduplicate;
      if (pdf) res.setTimeout(180_000);
      if (deduplicate && [...url.searchParams].length > 0) throw new PDFError('INVALID_QUERY', 'La deduplicación no acepta parámetros.', 400);
      const options = pdf ? (deduplicate ? {} : parsePDFOptions(url.searchParams)) : parseOptions(url.searchParams);
      const input = await readBody(req, pdf ? maxPdfBodyBytes : maxBodyBytes);
      const result = await (deduplicate ? processDeduplicatePDF(input) : pdf ? processPDF(input, options) : processImage(input, options));
      if (res.destroyed || res.writableEnded) return;
      const headers = {
        'Content-Type': result.contentType,
        'Content-Length': result.buffer.length,
        'X-Pluma-Original-Bytes': String(input.length),
        'X-Pluma-Bytes': String(result.buffer.length),
      };
      if (pdf) {
        headers['X-Pluma-Optimized-Images'] = String(result.optimizedImages);
        headers['X-Pluma-Skipped-Images'] = String(result.skippedImages);
        if (deduplicate) headers['X-Pluma-Deduplicated-Images'] = String(result.deduplicatedImages);
      } else {
        headers['X-Pluma-Width'] = String(result.width);
        headers['X-Pluma-Height'] = String(result.height);
      }
      res.writeHead(200, headers);
      res.end(result.buffer);
    } catch (error) {
      if (error instanceof ImageError || error instanceof PDFError) {
        if (error.status === 413) res.setHeader('Connection', 'close');
        json(res, error.status, error.code, error.message);
      } else {
        json(res, 500, 'PROCESSING_FAILED', 'El motor no pudo completar la operación.');
      }
      req.resume();
    } finally {
      active -= 1;
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 3_000;
  server.maxHeadersCount = 30;
  server.setTimeout(35_000, socket => socket.destroy());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? `El puerto ${DEFAULT_PORT} ya está ocupado. Cierra la otra instancia de Pluma PDF.`
      : 'No se pudo iniciar el motor local.');
    process.exitCode = 1;
  });
  server.listen(DEFAULT_PORT, '127.0.0.1', () => {
    console.log(`Pluma PDF · motor local en http://127.0.0.1:${DEFAULT_PORT}`);
    console.log('Las imágenes se procesan en memoria y no se guardan. Deja esta ventana abierta.');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close();
      server.closeIdleConnections();
    });
  }
}
