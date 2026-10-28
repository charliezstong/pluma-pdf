import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(join(root, 'dist'), { recursive: true });
await build({ absWorkingDir: root, entryPoints: ['src/plugin.ts'], bundle: true, outfile: 'dist/code.js', target: 'es2017', format: 'iife' });
const ui = await build({ absWorkingDir: root, entryPoints: ['src/ui.ts'], bundle: true, write: false, target: 'es2020', format: 'iife', minify: true });
const html = await readFile(join(root, 'src/ui.html'), 'utf8');
const css = await readFile(join(root, 'src/ui.css'), 'utf8');
const brandIcon = await readFile(join(root, 'assets/brand/icon-128.png'));
await writeFile(join(root, 'dist/ui.html'), html.replace('__PLUMA_BRAND_ICON__', 'data:image/png;base64,' + brandIcon.toString('base64')).replace('/* PLUMA_STYLES */', () => css).replace('/* PLUMA_SCRIPT */', () => ui.outputFiles[0].text.replaceAll('</script', '<\\/script')));
console.log('Pluma PDF is ready: import manifest.json in Figma Desktop.');
