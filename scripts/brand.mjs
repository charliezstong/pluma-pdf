import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, 'assets/brand');
// Export delivery sizes without changing the generated source artwork.
for (const size of [128, 256, 512]) {
  await sharp(join(directory, 'icon.png')).resize(size, size, { fit: 'contain' }).png().toFile(join(directory, `icon-${size}.png`));
}
await sharp(join(directory, 'cover.png')).webp({ quality: 94 }).toFile(join(directory, 'cover.webp'));
console.log('Brand delivery assets exported from the source PNGs.');
