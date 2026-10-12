import { build } from 'vite';
import { resolve } from 'node:path';
import { writeExtensionLicenses, bundledComponents, EXTENSION_COMPONENTS, EXTENSION_BANNER } from './licenses.mjs';

await writeExtensionLicenses();
const application = await build({
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        library: resolve('library.html'),
        popup: resolve('popup.html'),
        background: resolve('src/background.ts'),
      },
      output: { entryFileNames: '[name].js', banner: EXTENSION_BANNER, comments: { legal: true } },
    },
  },
});
const content = await build({
  publicDir: false,
  build: {
    emptyOutDir: false,
    lib: { entry: resolve('src/content.ts'), name: 'XBookmarkReader', formats: ['iife'], fileName: () => 'content.js' },
    rollupOptions: { output: { banner: EXTENSION_BANNER, comments: { legal: true } } },
  },
});
const included = bundledComponents([application, content].flat(), EXTENSION_COMPONENTS);
if (included.join(',') !== EXTENSION_COMPONENTS.join(',')) throw new Error('Extension components changed; review the generated license inventory');
console.log(`Bundled extension licenses: ${included.join(', ')}`);
