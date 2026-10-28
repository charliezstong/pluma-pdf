import { access, readFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MIN_NODE = '22.13.0';
export const ENGINE_PORT = 3847;
export const PREVIEW_PORT = 3848;

export function supportsNode(version = process.versions.node) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) return false;
  const current = version.split(/[.-]/).slice(0, 3).map(Number);
  const minimum = MIN_NODE.split('.').map(Number);
  for (let index = 0; index < minimum.length; index++) {
    if (current[index] !== minimum[index]) return current[index] > minimum[index];
  }
  return true;
}

function requireNode() {
  if (!supportsNode()) throw new Error(`Necesitas Node.js ${MIN_NODE} o posterior; tienes ${process.versions.node}. Instálalo desde https://nodejs.org/ y vuelve a abrir esta ventana.`);
}

export async function readPackage(root = ROOT) {
  return JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
}

/** The health check retains at most 4 KiB and never kills another process. */
export function probeService({ port, name = 'Pluma PDF', engine = 'sharp', version, timeoutMs = 1200 } = {}) {
  return new Promise(resolveProbe => {
    let settled = false;
    let request;
    const timer = setTimeout(() => {
      finish({ state: 'occupied' });
      request?.destroy();
    }, timeoutMs);
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProbe(result);
    };
    request = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: timeoutMs }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        if (Buffer.byteLength(body) + Buffer.byteLength(chunk) > 4096) {
          finish({ state: 'occupied' });
          response.destroy();
        } else body += chunk;
      });
      response.on('end', () => {
        try {
          const info = JSON.parse(body);
          const ready = response.statusCode === 200 && info.name === name && info.engine === engine
            && typeof info.version === 'string' && (!version || info.version === version);
          finish({ state: ready ? 'ready' : 'occupied', info: ready ? info : undefined });
        } catch {
          finish({ state: 'occupied' });
        }
      });
      response.on('error', () => finish({ state: 'occupied' }));
      response.on('aborted', () => finish({ state: 'occupied' }));
    });
    request.on('timeout', () => {
      finish({ state: 'occupied' });
      request.destroy();
    });
    request.on('error', error => finish({ state: error.code === 'ECONNREFUSED' ? 'absent' : 'occupied' }));
  });
}

export function runProcess(command, args, { root = ROOT, stdio = 'inherit', ...options } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio, ...options });
    child.once('error', error => reject(new Error(`No se pudo ejecutar ${command}: ${error.message}`)));
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(signal ? `El proceso se interrumpió (${signal}).` : `El proceso terminó con código ${code ?? 1}.`));
    });
  });
}

/** Prefer npm's JS entry point so paths with spaces do not go through a shell. */
export async function npmCommand(args, { platform = process.platform, execPath = process.execPath, env = process.env } = {}) {
  const candidates = [
    env.npm_execpath,
    join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(dirname(execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (!candidate || !candidate.endsWith('npm-cli.js')) continue;
    try {
      await access(candidate);
      return { command: execPath, args: [candidate, ...args] };
    } catch { /* Fall back to npm on PATH for version managers. */ }
  }
  if (platform === 'win32') {
    // All arguments are fixed by this file; no paths or user values enter cmd.exe.
    const permitted = new Set(['ci', '--include=dev', '--include=optional', '--no-fund', '--no-audit']);
    if (args.some(arg => !permitted.has(arg))) throw new Error('Argumentos de npm no permitidos.');
    return { command: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `npm ${args.join(' ')}`] };
  }
  return { command: 'npm', args };
}

export function dependenciesReady(root = ROOT) {
  try {
    const require = createRequire(join(root, 'package.json'));
    require.resolve('pdf-lib');
    require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    return Boolean(require('sharp').versions.vips);
  } catch {
    return false;
  }
}

export async function ensureDependencies({ root = ROOT, force = false, ready = dependenciesReady, run = runProcess, log = console.log } = {}) {
  if (!force && ready(root)) return;
  log('Instalando las dependencias de Pluma PDF. Esta primera descarga necesita internet…');
  const npm = await npmCommand(['ci', '--include=dev', '--include=optional', '--no-fund', '--no-audit']);
  try {
    await run(npm.command, npm.args, { root });
  } catch (error) {
    throw new Error(`La instalación no terminó. Comprueba tu conexión y que Node.js incluye npm; después vuelve a abrir Instalar Pluma PDF. ${error.message}`);
  }
  if (!ready(root)) throw new Error('Las dependencias no cargan para este equipo. No copies node_modules de otro ordenador: vuelve a ejecutar Instalar Pluma PDF en este equipo.');
}

export async function ensureBuild({ root = ROOT, force = false, run = runProcess } = {}) {
  if (!force) {
    try {
      await Promise.all(['dist/code.js', 'dist/ui.html'].map(path => access(join(root, path))));
      return;
    } catch { /* Source downloads may not yet contain the generated bundles. */ }
  }
  await run(process.execPath, ['build.mjs'], { root });
}

function portError(port) {
  return new Error(`El puerto ${port} está ocupado por otra aplicación o una versión distinta de Pluma PDF. Cierra esa aplicación y vuelve a iniciar Pluma. No se ha detenido ningún proceso.`);
}

export async function startService({ port, version, name = 'Pluma PDF', engine = 'sharp', create, probe = probeService, log = console.log } = {}) {
  const expected = { port, version, name, engine };
  const before = await probe(expected);
  if (before.state === 'ready') {
    log(`Pluma PDF ya está abierto en http://127.0.0.1:${port}. Puedes volver a Figma; no hace falta abrir otro motor.`);
    return { reused: true, server: null };
  }
  if (before.state !== 'absent') throw portError(port);
  const server = await create();
  try {
    await new Promise((resolveListen, reject) => {
      const onError = error => reject(error);
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError);
        resolveListen();
      });
    });
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    const after = await probe(expected);
    if (after.state === 'ready') {
      log(`Pluma PDF ya está abierto en http://127.0.0.1:${port}.`);
      return { reused: true, server: null };
    }
    throw portError(port);
  }
  return { reused: false, server };
}

function closeOnSignals(server) {
  if (!server) return;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close();
      server.closeIdleConnections();
    });
  }
}

async function openBrowser(url) {
  try {
    if (process.platform === 'darwin') await runProcess('open', [url]);
    else if (process.platform === 'win32') await runProcess(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`]);
    else await runProcess('xdg-open', [url]);
  } catch {
    console.log(`Abre esta dirección en tu navegador: ${url}`);
  }
}

export async function main(command, { root = ROOT } = {}) {
  requireNode();
  const pkg = await readPackage(root);
  if (command === 'install') {
    await ensureDependencies({ root, force: true });
    await ensureBuild({ root, force: true });
    console.log(`\nPluma PDF está instalado.\n1. Abre Iniciar motor.\n2. En Figma Desktop importa este archivo:\n${join(root, 'manifest.json')}\n\nPasos completos: docs/INSTALL.md`);
    return;
  }
  if (command === 'check') {
    console.log(`Node.js ${process.versions.node}: compatible. Dependencias: ${dependenciesReady(root) ? 'listas' : 'pendientes de instalar'}.`);
    const status = await probeService({ port: ENGINE_PORT, version: pkg.version });
    console.log(`Motor local: ${status.state === 'ready' ? 'conectado' : status.state === 'absent' ? 'apagado' : 'puerto ocupado por otro servicio o versión'}.`);
    return;
  }
  if (command === 'engine') {
    const result = await startService({
      port: ENGINE_PORT, version: pkg.version,
      create: async () => {
        await ensureDependencies({ root });
        const { createServer } = await import(pathToFileURL(join(root, 'engine/server.mjs')).href);
        return createServer();
      },
    });
    closeOnSignals(result.server);
    if (!result.reused) {
      console.log(`Pluma PDF · motor local en http://127.0.0.1:${ENGINE_PORT}`);
      console.log('Deja esta ventana abierta mientras usas Inteligente. Ctrl+C detiene el motor.');
      console.log('Los PDFs y las imágenes se procesan en memoria en este equipo.');
    }
    return;
  }
  if (command === 'preview') {
    const result = await startService({
      port: PREVIEW_PORT, version: pkg.version, name: 'Pluma PDF · Demo', engine: 'preview',
      create: async () => {
        await ensureDependencies({ root });
        await ensureBuild({ root });
        return http.createServer(async (req, res) => {
          if (req.method === 'GET' && req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ name: 'Pluma PDF · Demo', engine: 'preview', version: pkg.version }));
            return;
          }
          if (req.method !== 'GET' || !['/', '/index.html'].includes(req.url)) {
            res.writeHead(404); res.end(); return;
          }
          try {
            const html = await readFile(join(root, 'dist/ui.html'));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(html);
          } catch { res.writeHead(503); res.end('Vuelve a ejecutar Instalar Pluma PDF.'); }
        });
      },
    });
    closeOnSignals(result.server);
    console.log('Demo con páginas de ejemplo. Para exportar tu diseño abre el plugin en Figma Desktop.');
    await openBrowser(`http://127.0.0.1:${PREVIEW_PORT}`);
    return;
  }
  throw new Error('Usa: node scripts/local.mjs install | engine | preview | check');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2]).catch(error => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  });
}
