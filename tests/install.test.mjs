import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { supportsNode, probeService, startService, ensureDependencies, ensureBuild, npmCommand } from '../scripts/local.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), 'pluma install with spaces '));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function serverFor(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolveClose => { server.close(resolveClose); server.closeAllConnections(); }));
  return { server, port: server.address().port };
}

test('installer enforces the exact Node 22.13 minimum while accepting later LTS versions', () => {
  for (const version of ['20.19.0', '22.12.99', 'garbage', '', '22']) assert.equal(supportsNode(version), false, version);
  for (const version of ['22.13.0', '22.13.1', '22.23.0', '24.0.0', '26.0.0']) assert.equal(supportsNode(version), true, version);
});

test('health check recognizes only the expected Pluma engine and version', async t => {
  const fixture = await serverFor(t, (_req, res) => res.end(JSON.stringify({ name: 'Pluma PDF', version: '1.0.0', engine: 'sharp' })));
  assert.equal((await probeService({ port: fixture.port, version: '1.0.0' })).state, 'ready');
  assert.equal((await probeService({ port: fixture.port, version: '2.0.0' })).state, 'occupied');
  const other = await serverFor(t, (_req, res) => res.end('Another local application'));
  assert.equal((await probeService({ port: other.port })).state, 'occupied');
  const oversized = await serverFor(t, (_req, res) => res.end('x'.repeat(5000)));
  assert.equal((await probeService({ port: oversized.port })).state, 'occupied');
});

test('health checks have a wall-clock deadline for a service that never completes', async t => {
  const fixture = await serverFor(t, (_req, res) => { res.writeHead(200); res.write('{'); });
  const started = Date.now();
  assert.equal((await probeService({ port: fixture.port, timeoutMs: 60 })).state, 'occupied');
  assert.ok(Date.now() - started < 1000);
});

test('starting twice reuses the healthy engine without loading dependencies or creating a server', async () => {
  let created = false;
  const messages = [];
  const result = await startService({ port: 3847, version: '1.0.0', probe: async () => ({ state: 'ready' }), create: () => { created = true; }, log: value => messages.push(value) });
  assert.equal(result.reused, true);
  assert.equal(created, false);
  assert.match(messages.join(), /already running/);
});

test('unrelated listeners fail with an actionable message and are never terminated', async t => {
  const fixture = await serverFor(t, (_req, res) => res.end('not Pluma'));
  await assert.rejects(startService({ port: fixture.port, version: '1.0.0', create: () => { throw new Error('must not create'); } }), /occupied.*another application/);
  assert.equal(fixture.server.listening, true);
});

test('a fresh launcher binds only loopback and serves without spawning a duplicate process', async t => {
  const result = await startService({ port: 0, probe: async () => ({ state: 'absent' }), create: () => http.createServer((_req, res) => res.end('ready')) });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));
  assert.equal(result.reused, false);
  assert.equal(result.server.address().address, '127.0.0.1');
  const response = await fetch(`http://127.0.0.1:${result.server.address().port}`);
  assert.equal(await response.text(), 'ready');
});

test('the EADDRINUSE race rechecks health and reuses only a compatible Pluma instance', async () => {
  const { EventEmitter } = await import('node:events');
  function duplicate() {
    const server = new EventEmitter();
    server.listen = () => queueMicrotask(() => server.emit('error', Object.assign(new Error('occupied'), { code: 'EADDRINUSE' })));
    return server;
  }
  let probes = 0;
  const reused = await startService({ port: 3847, create: duplicate, probe: async () => ({ state: ++probes === 1 ? 'absent' : 'ready' }), log: () => {} });
  assert.equal(reused.reused, true);
  probes = 0;
  await assert.rejects(startService({ port: 3847, create: duplicate, probe: async () => ({ state: ++probes === 1 ? 'absent' : 'occupied' }), log: () => {} }), /No process has been stopped/);
});

test('dependency install runs frozen npm ci with optional binaries only when needed', async t => {
  const folder = await temporary(t);
  let installed = false;
  const commands = [];
  const ready = () => installed;
  const run = async (command, args, options) => { commands.push({ command, args, options }); installed = true; };
  await ensureDependencies({ root: folder, ready, run, log: () => {} });
  await ensureDependencies({ root: folder, ready, run, log: () => {} });
  assert.equal(commands.length, 1);
  assert.ok(commands[0].args.includes('ci'));
  assert.ok(commands[0].args.includes('--include=dev'));
  assert.ok(commands[0].args.includes('--include=optional'));
  assert.equal(commands[0].options.root, folder);
  await ensureDependencies({ root: folder, force: true, ready, run, log: () => {} });
  assert.equal(commands.length, 2);
  await assert.rejects(ensureDependencies({ root: folder, ready: () => false, run: async () => { throw new Error('offline'); }, log: () => {} }), /Check your internet connection/);
});

test('a complete distribution keeps its bundles; a source-only download builds in its own folder', async t => {
  const folder = await temporary(t);
  const commands = [];
  const run = async (...args) => commands.push(args);
  await ensureBuild({ root: folder, run });
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0][1], ['scripts/build.mjs']);
  assert.equal(commands[0][2].root, folder);
  await mkdir(join(folder, 'dist'));
  await writeFile(join(folder, 'dist/code.js'), 'code');
  await writeFile(join(folder, 'dist/ui.html'), 'ui');
  await ensureBuild({ root: folder, run });
  assert.equal(commands.length, 1);
});

test('npm Windows fallback contains only fixed arguments and never interpolates a folder path', async t => {
  const folder = await temporary(t);
  const options = { platform: 'win32', execPath: join(folder, 'node.exe'), env: { ComSpec: 'cmd.exe' } };
  assert.deepEqual(await npmCommand(['ci', '--include=optional', '--no-fund', '--no-audit'], options), {
    command: 'cmd.exe', args: ['/d', '/s', '/c', 'npm ci --include=optional --no-fund --no-audit'],
  });
  await assert.rejects(npmCommand(['ci', '& echo injected'], options), /Unsupported npm arguments/);
  const cli = join(folder, 'npm-cli.js');
  await writeFile(cli, '// fixture');
  assert.deepEqual(await npmCommand(['ci'], { ...options, env: { npm_execpath: cli } }), { command: options.execPath, args: [cli, 'ci'] });
});

test('macOS wrappers resolve their own folder with spaces and preserve command/exit status', { skip: process.platform !== 'darwin' }, async t => {
  const folder = await temporary(t);
  await mkdir(join(folder, 'scripts/macos'), { recursive: true });
  await writeFile(join(folder, 'scripts/local.mjs'), 'process.stdout.write(JSON.stringify({cwd:process.cwd(),command:process.argv[2]}));process.exitCode=7;');
  for (const [filename, command] of [['install.command', 'install'], ['start-engine.command', 'engine'], ['preview.command', 'preview']]) {
    const path = join('scripts/macos', filename);
    await copyFile(join(root, path), join(folder, path));
    const child = spawn('/bin/zsh', [join(folder, path)], { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    const [status] = await once(child, 'exit');
    assert.equal(status, 7);
    assert.deepEqual(JSON.parse(output), { cwd: await realpath(folder), command });
  }
});

test('Windows wrapper source anchors paths to its folder and preserves Node exit codes', async () => {
  for (const [filename, command] of [['install.cmd', 'install'], ['start-engine.cmd', 'engine'], ['preview.cmd', 'preview']]) {
    const source = await readFile(join(root, 'scripts/windows', filename), 'utf8');
    assert.ok(source.includes('cd /d "%~dp0..\\.."'));
    assert.ok(source.includes(`node scripts\\local.mjs ${command}`));
    assert.match(source, /set "PLUMA_EXIT=%ERRORLEVEL%"/);
    assert.match(source, /exit \/b %PLUMA_EXIT%/);
  }
});
