import { buildFileApp } from './file-app-build.mjs';
await buildFileApp({ entry: 'src/local.tsx', directory: 'local-dist', filename: 'xbookmarkshelf-local.html', title: 'Local library', extraCss: 'src/local.css' });
