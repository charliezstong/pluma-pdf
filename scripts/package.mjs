import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIN_NODE, supportsNode } from './local.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'manifest.json', 'package.json', 'package-lock.json', 'tsconfig.json',
  'README.md', 'AGENTS.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE',
  'docs/INSTALL.md', 'docs/PRIVACY.md', 'docs/ARCHITECTURE.md', 'docs/CONTRIBUTING.md', 'docs/BRAND.md',
];
const DIRECTORIES = {
  dist: ['.js', '.html'], engine: ['.mjs'], src: ['.ts', '.html', '.css'],
  scripts: ['.mjs', '.command', '.cmd'], tests: ['.mjs'], licenses: ['.md', '.txt'],
  assets: ['.png', '.jpg', '.jpeg', '.webp', '.svg'],
};
const OPTIONAL = new Set(['LICENSE', 'assets', 'docs/ARCHITECTURE.md', 'docs/CONTRIBUTING.md']);
const FORBIDDEN = new Set(['node_modules', 'work', 'release', '.git', '.DS_Store']);
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Explicit allowlist: no user PDFs, working files, node_modules or symlinks. */
export async function collectReleaseFiles(root = ROOT) {
  const files = [];
  let totalBytes = 0;
  async function add(path) {
    const info = await lstat(join(root, path));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Only regular files can be packaged: ${path}`);
    const bytes = await readFile(join(root, path));
    totalBytes += bytes.length;
    if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('Package source files exceed 128 MiB. Review the files before distributing the package.');
    files.push({ path: path.split('\\').join('/'), bytes, mode: path.endsWith('.command') ? 0o100755 : 0o100644 });
  }
  async function visit(directory, extensions) {
    const info = await lstat(join(root, directory));
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`The directory cannot be a symlink: ${directory}`);
    const children = await readdir(join(root, directory), { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of children) {
      if (FORBIDDEN.has(entry.name) || entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlinks cannot be distributed: ${path}`);
      if (entry.isDirectory()) await visit(path, extensions);
      else if (entry.isFile() && extensions.includes(extname(entry.name).toLowerCase())) await add(path);
    }
  }
  for (const file of FILES) {
    try { await add(file); }
    catch (error) { if (!OPTIONAL.has(file) || error.code !== 'ENOENT') throw error; }
  }
  for (const [directory, extensions] of Object.entries(DIRECTORIES)) {
    try { await visit(directory, extensions); }
    catch (error) { if (!OPTIONAL.has(directory) || error.code !== 'ENOENT') throw error; }
  }
  const paths = new Set(files.map(file => file.path));
  for (const required of [
    'dist/code.js', 'dist/ui.html', 'engine/server.mjs', 'docs/INSTALL.md',
    'scripts/local.mjs', 'scripts/build.mjs', 'scripts/preview.mjs',
    'scripts/macos/install.command', 'scripts/macos/start-engine.command', 'scripts/macos/preview.command',
    'scripts/windows/install.cmd', 'scripts/windows/start-engine.cmd', 'scripts/windows/preview.cmd',
  ]) {
    if (!paths.has(required)) throw new Error(`Missing ${required}. Run the checks and build before packaging.`);
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

/** Small, reproducible ZIP with UTF-8 names and executable macOS launchers. */
export function createZIP(files, prefix) {
  if (!/^[A-Za-z0-9._-]+\/$/.test(prefix)) throw new Error('Invalid ZIP prefix.');
  if (files.length > 65535) throw new Error('The package contains too many files.');
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const file of files) {
    if (file.path.includes('..') || file.path.startsWith('/') || file.path.includes('\\')) throw new Error('Invalid ZIP path.');
    const name = Buffer.from(prefix + file.path, 'utf8');
    const compressed = deflateRawSync(file.bytes, { level: 9 });
    const crc = crc32(file.bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x5021, 12); // 2020-01-01: reproducible archives.
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(file.bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    parts.push(header, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x5021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((file.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += header.length + name.length + compressed.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directoryBytes, end]);
}

export async function packageRelease({ root = ROOT, outDir = join(root, 'release') } = {}) {
  if (!supportsNode()) throw new Error(`Node.js ${MIN_NODE} or later is required.`);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version)) throw new Error('The package version is invalid.');
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  if (lock.packages?.['']?.version !== pkg.version) throw new Error('package.json and package-lock.json have different versions.');
  const files = await collectReleaseFiles(root);
  const inventory = {
    name: 'Pluma PDF', version: pkg.version, minimumNode: MIN_NODE,
    dependenciesIncluded: false,
    install: 'node scripts/local.mjs install',
    files: files.map(file => ({ path: file.path, bytes: file.bytes.length, sha256: digest(file.bytes) })),
  };
  files.push({ path: 'RELEASE.json', bytes: Buffer.from(JSON.stringify(inventory, null, 2) + '\n'), mode: 0o100644 });
  const filename = `PlumaPDF-${pkg.version}.zip`;
  const archive = createZIP(files, `PlumaPDF-${pkg.version}/`);
  const sha256 = digest(archive);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, filename), archive);
  await writeFile(join(outDir, filename + '.sha256'), `${sha256}  ${filename}\n`);
  await writeFile(join(outDir, filename + '.files.json'), JSON.stringify(inventory, null, 2) + '\n');
  return { path: join(outDir, filename), bytes: archive.length, sha256, files: files.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const valid = args.length === 0 || (args.length === 2 && args[0] === '--out');
  if (!valid) { console.error('Usage: node scripts/package.mjs [--out directory]'); process.exitCode = 1; }
  else packageRelease({ outDir: args.length ? resolve(args[1]) : undefined }).then(result => {
    console.log(`Package ready: ${result.path}\n${result.files} files · ${result.bytes.toLocaleString('en')} bytes\nSHA-256: ${result.sha256}`);
    console.log('Installed dependencies and PDFs are excluded. Run the installer on the destination computer.');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
