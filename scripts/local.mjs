import { access, readFile, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
  if (!supportsNode()) throw new Error(`Node.js ${MIN_NODE} or later is required; you have ${process.versions.node}. Install it from https://nodejs.org/ and reopen this window.`);
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
    child.once('error', error => reject(new Error(`Could not run ${command}: ${error.message}`)));
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(signal ? `The process was interrupted (${signal}).` : `The process exited with code ${code ?? 1}.`));
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
    if (args.some(arg => !permitted.has(arg))) throw new Error('Unsupported npm arguments.');
    return { command: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `npm ${args.join(' ')}`] };
  }
  return { command: 'npm', args };
}

export function dependenciesReady(root = ROOT) {
  try {
    // Avoid caching failed package resolutions before npm installs missing tools.
    for (const name of ['pdf-lib', 'pdfjs-dist', 'sharp', 'esbuild']) {
      if (!existsSync(join(root, 'node_modules', name, 'package.json'))) return false;
    }
    const require = createRequire(join(root, 'package.json'));
    require.resolve('pdf-lib');
    require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    require.resolve('esbuild');
    return Boolean(require('sharp').versions.vips);
  } catch {
    return false;
  }
}

export async function ensureDependencies({ root = ROOT, force = false, ready = dependenciesReady, run = runProcess, log = console.log } = {}) {
  if (!force && ready(root)) return;
  log('Installing Pluma PDF dependencies. This initial download requires internet access…');
  const npm = await npmCommand(['ci', '--include=dev', '--include=optional', '--no-fund', '--no-audit']);
  try {
    await run(npm.command, npm.args, { root });
  } catch (error) {
    throw new Error(`Installation did not complete. Check your internet connection and that Node.js includes npm, then run the installer again. ${error.message}`);
  }
  if (!ready(root)) throw new Error('Dependencies could not load on this computer. Do not copy node_modules from another computer: run the installer on this computer instead.');
}

function isInside(root, path) {
  const remainder = relative(root, path);
  return remainder !== '' && remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
}

/** Check the manifest's actual entry points without changing any files. */
export async function pluginReadiness(root = ROOT) {
  const targets = [];
  const issues = [];
  const rootPath = resolve(root);
  let manifest;
  let physicalRoot;
  try {
    [manifest, physicalRoot] = await Promise.all([
      readFile(join(rootPath, 'manifest.json'), 'utf8').then(JSON.parse),
      realpath(rootPath),
    ]);
  } catch (error) {
    return { ready: false, targets, issues: [`Cannot read manifest.json: ${error.message}`] };
  }
  const entries = [{ field: 'main', path: manifest?.main }];
  if (manifest?.ui && typeof manifest.ui === 'object' && !Array.isArray(manifest.ui)) {
    const interfaces = Object.entries(manifest.ui);
    if (!interfaces.length) issues.push('manifest.ui must contain at least one entry point.');
    for (const [key, path] of interfaces) entries.push({ field: `ui.${key}`, path });
  } else entries.push({ field: 'ui', path: manifest?.ui });
  for (const entry of entries) {
    if (typeof entry.path !== 'string' || !entry.path.trim() || entry.path.includes('\0')) {
      issues.push(`manifest.${entry.field} must be a relative file path.`);
      continue;
    }
    const path = entry.path.replaceAll('\\', '/');
    const absolutePath = resolve(rootPath, path);
    targets.push({ field: entry.field, path });
    if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || !isInside(rootPath, absolutePath)) {
      issues.push(`${path} (${entry.field}) must stay inside the plugin folder.`);
      continue;
    }
    try {
      const [info, physicalPath] = await Promise.all([stat(absolutePath), realpath(absolutePath)]);
      if (!isInside(physicalRoot, physicalPath)) issues.push(`${path} (${entry.field}) resolves outside the plugin folder.`);
      else if (!info.isFile()) issues.push(`${path} (${entry.field}) is not a regular file.`);
      else if (info.size === 0) issues.push(`${path} (${entry.field}) is empty.`);
    } catch (error) {
      issues.push(`${path} (${entry.field}) is ${error.code === 'ENOENT' ? 'missing' : 'not readable'}.`);
    }
  }
  return { ready: issues.length === 0, targets, issues };
}

export async function ensureBuild({ root = ROOT, force = false, run = runProcess } = {}) {
  const before = await pluginReadiness(root);
  if (!force && before.ready) return;
  await run(process.execPath, ['scripts/build.mjs'], { root });
  const after = await pluginReadiness(root);
  if (!after.ready) throw new Error(`The build did not produce a loadable plugin: ${after.issues.join(' ')} Run npm run install:local to repair the installation.`);
}

function portError(port) {
  return new Error(`Port ${port} is occupied by another application or a different version of Pluma PDF. Close that application and start Pluma again. No process has been stopped.`);
}

export async function startService({ port, version, name = 'Pluma PDF', engine = 'sharp', create, probe = probeService, log = console.log } = {}) {
  const expected = { port, version, name, engine };
  const before = await probe(expected);
  if (before.state === 'ready') {
    log(`Pluma PDF is already running at http://127.0.0.1:${port}. Reusing the existing service; no second instance is needed.`);
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
      log(`Pluma PDF is already running at http://127.0.0.1:${port}.`);
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
    console.log(`Open this address in your browser: ${url}`);
  }
}

export async function main(command, { root = ROOT, ensureDeps = ensureDependencies, ensureBundles = ensureBuild, probe = probeService, log = console.log, openPreview = openBrowser } = {}) {
  requireNode();
  const pkg = await readPackage(root);
  if (command === 'install') {
    await ensureDeps({ root, force: true });
    await ensureBundles({ root, force: true });
    console.log(`\nPluma PDF is installed.\n1. Run npm start, or open scripts/macos/start-engine.command (macOS) or scripts/windows/start-engine.cmd (Windows).\n2. In Figma Desktop, import this manifest:\n${join(root, 'manifest.json')}\n\nFull instructions: docs/INSTALL.md`);
    return;
  }
  if (command === 'check') {
    log(`Node.js ${process.versions.node}: supported. Dependencies: ${dependenciesReady(root) ? 'ready' : 'not installed yet'}.`);
    const bundles = await pluginReadiness(root);
    log(`Plugin bundles: ${bundles.ready ? `ready (${bundles.targets.map(target => target.path).join(', ')})` : bundles.issues.join(' ')}`);
    if (!bundles.ready) throw new Error('Plugin bundles are not ready. Run npm run build, or npm run install:local if dependencies are missing, before importing manifest.json in Figma.');
    const status = await probe({ port: ENGINE_PORT, version: pkg.version });
    log(`Local engine: ${status.state === 'ready' ? 'connected' : status.state === 'absent' ? 'stopped' : 'port occupied by another service or version'}.`);
    return;
  }
  if (command === 'engine') {
    await ensureDeps({ root });
    await ensureBundles({ root });
    const result = await startService({
      port: ENGINE_PORT, version: pkg.version, probe, log,
      create: async () => {
        const { createServer } = await import(pathToFileURL(join(root, 'engine/server.mjs')).href);
        return createServer();
      },
    });
    closeOnSignals(result.server);
    if (!result.reused) {
      console.log(`Pluma PDF · local engine at http://127.0.0.1:${ENGINE_PORT}`);
      console.log('Keep this window open while using Intelligent mode. Press Ctrl+C to stop the engine.');
      console.log('PDFs and images are processed in memory on this computer.');
    }
    return;
  }
  if (command === 'preview') {
    await ensureDeps({ root });
    await ensureBundles({ root });
    const result = await startService({
      port: PREVIEW_PORT, version: pkg.version, name: 'Pluma PDF · Demo', engine: 'preview', probe, log,
      create: async () => {
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
          } catch { res.writeHead(503); res.end('Run the Pluma PDF installer again.'); }
        });
      },
    });
    closeOnSignals(result.server);
    log('Demo with sample pages. To export your design, open the plugin in Figma Desktop.');
    await openPreview(`http://127.0.0.1:${PREVIEW_PORT}`);
    return;
  }
  throw new Error('Usage: node scripts/local.mjs install | engine | preview | check');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2]).catch(error => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  });
}
