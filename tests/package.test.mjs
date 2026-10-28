import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { collectReleaseFiles, packageRelease } from '../scripts/package.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pluma package '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    'manifest.json': '{}', 'package.json': JSON.stringify({ version: '1.0.0' }),
    'package-lock.json': JSON.stringify({ packages: { '': { version: '1.0.0' } } }),
    'AGENTS.md': 'instructions', 'docs/BRAND.md': 'brand', 'tests/sample.test.mjs': '// synthetic test',
    'README.md': 'readme', 'THIRD_PARTY_NOTICES.md': 'notices', 'LICENSE': 'license',
    'build.mjs': '// build', 'preview.mjs': '// preview', 'tsconfig.json': '{}',
    'Instalar Pluma PDF.command': '#!/bin/zsh', 'Iniciar motor.command': '#!/bin/zsh', 'Ver interfaz.command': '#!/bin/zsh',
    'Instalar Pluma PDF.cmd': '@echo off', 'Iniciar motor.cmd': '@echo off', 'Ver interfaz.cmd': '@echo off',
    'dist/code.js': '// built', 'dist/ui.html': '<html>preview</html>',
    'engine/server.mjs': '// server', 'src/plugin.ts': '// source', 'scripts/local.mjs': '// local',
    'licenses/library.txt': 'license', 'docs/INSTALL.md': 'install',
    'work/private.pdf': 'PRIVATE PDF', 'node_modules/private.js': 'PRIVATE DEPENDENCY',
    'docs/brandbook.PDF': 'PRIVATE PDF', 'engine/secret.pdf': 'PRIVATE PDF',
    'docs/.env': 'TOKEN', 'docs/private-metrics.json': 'PRIVATE METRICS', 'docs/private-notes.md': 'PRIVATE NOTES',
    'release/old.zip': 'OLD RELEASE', '.git/config': 'PRIVATE GIT',
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

function contents(zip) {
  const result = new Map();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameSize = zip.readUInt16LE(offset + 26);
    const extraSize = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
    const start = offset + 30 + nameSize + extraSize;
    const bytes = zip.subarray(start, start + compressedSize);
    assert.equal(method, 8);
    result.set(name, inflateRawSync(bytes));
    offset = start + compressedSize;
  }
  return result;
}

test('release allowlist includes the installable plugin and excludes PDFs, work, dependencies and hidden files', async t => {
  const root = await fixture(t);
  const files = await collectReleaseFiles(root);
  const paths = files.map(file => file.path);
  for (const required of ['AGENTS.md', 'tsconfig.json', 'tests/sample.test.mjs', 'manifest.json', 'dist/code.js', 'dist/ui.html', 'engine/server.mjs', 'package-lock.json', 'docs/INSTALL.md', 'scripts/local.mjs']) assert.ok(paths.includes(required));
  for (const path of paths) assert.doesNotMatch(path, /\.pdf$|node_modules|work\/|release\/|\.git\/|\.env$|private-metrics|private-notes/i);
  assert.equal(files.find(file => file.path === 'Iniciar motor.command').mode, 0o100755);
});

test('release ZIP is reproducible, independently readable, checksummed and includes a verifiable file inventory', async t => {
  const root = await fixture(t);
  const first = await packageRelease({ root });
  const zip = await readFile(first.path);
  const second = await packageRelease({ root });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.sha256, createHash('sha256').update(zip).digest('hex'));
  assert.equal(await readFile(first.path + '.sha256', 'utf8'), `${first.sha256}  PlumaPDF-1.0.0.zip\n`);
  const entries = contents(zip);
  const inventory = JSON.parse(entries.get('PlumaPDF-1.0.0/RELEASE.json'));
  assert.equal(inventory.dependenciesIncluded, false);
  assert.equal(inventory.minimumNode, '22.13.0');
  for (const file of inventory.files) {
    const bytes = entries.get('PlumaPDF-1.0.0/' + file.path);
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  assert.ok(!zip.includes(Buffer.from('PRIVATE PDF')));
  if (process.platform === 'darwin') {
    const output = execFileSync('/usr/bin/unzip', ['-t', first.path], { encoding: 'utf8' });
    assert.match(output, /No errors detected/);
  }
});

test('missing bundles or a divergent lockfile prevent an incomplete release', async t => {
  const root = await fixture(t);
  await rm(join(root, 'dist/code.js'));
  await assert.rejects(packageRelease({ root }), /dist\/code.js/);
  await writeFile(join(root, 'dist/code.js'), 'restored');
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages: { '': { version: '2.0.0' } } }));
  await assert.rejects(packageRelease({ root }), /versiones diferentes/);
});

test('a symlink cannot pull an external file into the public archive', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t);
  await symlink(join(root, '.git/config'), join(root, 'src/private.ts'));
  await assert.rejects(collectReleaseFiles(root), /enlaces simbólicos/);
});
