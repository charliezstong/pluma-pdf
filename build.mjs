import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/plugin.ts'], bundle: true, outfile: 'dist/code.js', target: 'es2017', format: 'iife' });
const ui = await build({ entryPoints: ['src/ui.ts'], bundle: true, write: false, target: 'es2020', format: 'iife', minify: true });
const html = await readFile('src/ui.html', 'utf8');
const css = await readFile('src/ui.css', 'utf8');
await writeFile('dist/ui.html', html.replace('/* PLUMA_STYLES */', () => css).replace('/* PLUMA_SCRIPT */', () => ui.outputFiles[0].text.replaceAll('</script', '<\\/script')));
console.log('Pluma PDF listo: importa manifest.json en Figma Desktop.');
