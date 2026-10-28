import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, realpath, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { supportsNode, probeService, startService, dependenciesReady, ensureDependencies, ensureBuild, npmCommand, pluginReadiness, main } from '../scripts/local.mjs';

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
async function pluginFixture(t, { mainPath = 'dist/code.js', ui = 'dist/ui.html', bundles = true } = {}) {
  const folder = await temporary(t);
  await writeFile(join(folder, 'package.json'), JSON.stringify({ version: '1.0.1' }));
  await writeFile(join(folder, 'manifest.json'), JSON.stringify({ main: mainPath, ui }));
  if (bundles) await writeBundles(folder, [mainPath, ...(typeof ui === 'string' ? [ui] : Object.values(ui))]);
  return folder;
}
async function writeBundles(folder, paths = ['dist/code.js', 'dist/ui.html']) {
  for (const path of paths) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), `generated ${path}`);
  }
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

test('runtime-only dependencies trigger installation of the missing esbuild tool needed to repair bundles', async t => {
  const folder = await pluginFixture(t, { bundles: false });
  const packages = {
    'node_modules/sharp/package.json': JSON.stringify({ main: 'index.cjs' }),
    'node_modules/sharp/index.cjs': 'module.exports = { versions: { vips: "synthetic" } };',
    'node_modules/pdf-lib/package.json': JSON.stringify({ main: 'index.cjs' }),
    'node_modules/pdf-lib/index.cjs': 'module.exports = {};',
    'node_modules/pdfjs-dist/package.json': JSON.stringify({ type: 'module' }),
    'node_modules/pdfjs-dist/legacy/build/pdf.mjs': 'export {};',
  };
  for (const [path, content] of Object.entries(packages)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), content);
  }
  assert.equal(dependenciesReady(folder), false, 'runtime libraries alone cannot rebuild a source installation');
  let installs = 0;
  await ensureDependencies({
    root: folder, log: () => {},
    run: async (_command, args) => {
      installs++;
      assert.ok(args.includes('--include=dev'));
      assert.ok(args.includes('--include=optional'));
      await mkdir(join(folder, 'node_modules/esbuild'));
      await writeFile(join(folder, 'node_modules/esbuild/package.json'), JSON.stringify({ main: 'index.cjs' }));
      await writeFile(join(folder, 'node_modules/esbuild/index.cjs'), 'module.exports = {};');
    },
  });
  assert.equal(installs, 1);
  assert.equal(dependenciesReady(folder), true);
});

test('a complete distribution keeps its bundles; a source-only download builds in its own folder', async t => {
  const folder = await pluginFixture(t, { bundles: false });
  const commands = [];
  const run = async (...args) => { commands.push(args); await writeBundles(folder); };
  await ensureBuild({ root: folder, run });
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0][1], ['scripts/build.mjs']);
  assert.equal(commands[0][2].root, folder);
  await ensureBuild({ root: folder, run });
  assert.equal(commands.length, 1);
  await writeFile(join(folder, 'dist/ui.html'), '');
  await ensureBuild({ root: folder, run });
  assert.equal(commands.length, 2);
});

test('readiness follows actual manifest entry points, including named UI files', async t => {
  const folder = await pluginFixture(t, { mainPath: 'output/controller.js', ui: { panel: 'output/panel.html', settings: 'output/settings.html' } });
  const ready = await pluginReadiness(folder);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.targets.map(target => target.path), ['output/controller.js', 'output/panel.html', 'output/settings.html']);
  await ensureBuild({ root: folder, run: async () => assert.fail('valid manifest targets do not require rebuilding') });
  await writeFile(join(folder, 'output/panel.html'), '');
  await rm(join(folder, 'output/settings.html'));
  await mkdir(join(folder, 'output/settings.html'));
  const invalid = await pluginReadiness(folder);
  assert.equal(invalid.ready, false);
  assert.ok(invalid.issues.some(issue => /panel.html.*empty/.test(issue)));
  assert.ok(invalid.issues.some(issue => /settings.html.*not a regular file/.test(issue)));
});

test('readiness rejects relative, absolute and symlink escapes from the plugin folder', async t => {
  const folder = await pluginFixture(t);
  for (const path of ['../outside.js', '/outside.js', 'C:\\outside.js']) {
    await writeFile(join(folder, 'manifest.json'), JSON.stringify({ main: path, ui: 'dist/ui.html' }));
    const invalid = await pluginReadiness(folder);
    assert.equal(invalid.ready, false, path);
    assert.ok(invalid.issues.some(issue => /must stay inside/.test(issue)), path);
  }
  if (process.platform !== 'win32') {
    const external = await temporary(t);
    await writeFile(join(external, 'outside.js'), 'external code');
    await symlink(external, join(folder, 'linked'));
    await writeFile(join(folder, 'manifest.json'), JSON.stringify({ main: 'linked/outside.js', ui: 'dist/ui.html' }));
    assert.match((await pluginReadiness(folder)).issues.join(' '), /resolves outside/);
  }
});

test('a successful build exit cannot hide missing or empty manifest outputs', async t => {
  const folder = await pluginFixture(t, { bundles: false });
  await assert.rejects(ensureBuild({ root: folder, run: async () => {} }), /did not produce a loadable plugin.*dist\/code.js.*missing/);
  await assert.rejects(ensureBuild({ root: folder, run: async () => { await writeBundles(folder); await writeFile(join(folder, 'dist/ui.html'), ''); } }), /dist\/ui.html.*empty/);
});

test('doctor reports missing bundles and the CLI returns nonzero without starting or probing services', async t => {
  const folder = await pluginFixture(t, { bundles: false });
  const messages = [];
  await assert.rejects(main('check', {
    root: folder, log: value => messages.push(value),
    probe: async () => assert.fail('missing bundles must fail before checking the engine'),
  }), /Run npm run build/);
  assert.match(messages.join('\n'), /Plugin bundles:.*dist\/code.js.*missing.*dist\/ui.html.*missing/);
  await mkdir(join(folder, 'scripts'));
  await copyFile(join(root, 'scripts/local.mjs'), join(folder, 'scripts/local.mjs'));
  const child = spawn(process.execPath, [await realpath(join(folder, 'scripts/local.mjs')), 'check'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { output += bytes; });
  const [status] = await once(child, 'exit');
  assert.equal(status, 1);
  assert.match(output, /Plugin bundles:.*missing/);
  assert.match(output, /Run npm run build/);
});

test('engine startup repairs missing bundles before reusing an already healthy service', async t => {
  const folder = await pluginFixture(t, { bundles: false });
  const events = [];
  const messages = [];
  await main('engine', {
    root: folder, log: value => messages.push(value),
    ensureDeps: async options => { assert.equal(options.root, folder); events.push('dependencies'); },
    ensureBundles: options => ensureBuild({ ...options, run: async () => { events.push('build'); await writeBundles(folder); } }),
    probe: async expected => {
      events.push('probe');
      assert.equal(expected.version, '1.0.1');
      assert.equal((await pluginReadiness(folder)).ready, true);
      return { state: 'ready' };
    },
  });
  assert.deepEqual(events, ['dependencies', 'build', 'probe']);
  assert.match(messages.join('\n'), /already running/);
});

test('engine startup refuses to report a reused engine when its bundle repair fails', async t => {
  const folder = await pluginFixture(t, { bundles: false });
  await assert.rejects(main('engine', {
    root: folder,
    ensureDeps: async () => {},
    ensureBundles: options => ensureBuild({ ...options, run: async () => {} }),
    probe: async () => assert.fail('failed repair must stop before the reuse check'),
    log: () => assert.fail('failed repair must not report that Pluma is running'),
  }), /did not produce a loadable plugin/);
});

test('preview repairs missing UI before reusing an existing demo and opening its browser URL', async t => {
  const folder = await pluginFixture(t);
  await rm(join(folder, 'dist/ui.html'));
  const events = [];
  await main('preview', {
    root: folder, log: () => {},
    ensureDeps: async options => { assert.equal(options.root, folder); events.push('dependencies'); },
    ensureBundles: options => ensureBuild({ ...options, run: async () => { events.push('build'); await writeBundles(folder); } }),
    probe: async expected => {
      events.push('probe');
      assert.equal(expected.name, 'Pluma PDF · Demo');
      assert.equal(expected.engine, 'preview');
      assert.equal(expected.version, '1.0.1');
      assert.equal((await pluginReadiness(folder)).ready, true);
      return { state: 'ready' };
    },
    openPreview: async url => { events.push('browser'); assert.equal(url, 'http://127.0.0.1:3848'); },
  });
  assert.deepEqual(events, ['dependencies', 'build', 'probe', 'browser']);
});

test('preview does not reuse or open a demo when its missing bundles cannot be repaired', async t => {
  const folder = await pluginFixture(t, { bundles: false });
  await assert.rejects(main('preview', {
    root: folder, ensureDeps: async () => {},
    ensureBundles: options => ensureBuild({ ...options, run: async () => {} }),
    probe: async () => assert.fail('failed repair must stop before checking the demo'),
    openPreview: async () => assert.fail('failed repair must not open a browser'),
    log: () => assert.fail('failed repair must not report that the demo is ready'),
  }), /did not produce a loadable plugin/);
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
