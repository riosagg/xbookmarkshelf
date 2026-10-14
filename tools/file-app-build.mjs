import { build } from 'vite';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { applicationLicense, thirdPartyNotices, bundledComponents, escapeLicense, FILE_BANNER } from './licenses.mjs';

export async function buildFileApp({ entry, directory, filename, title, extraCss }) {
  const result = await build({ configFile: false, publicDir: false, build: {
    target: 'chrome120', write: false, minify: true, sourcemap: false,
    lib: { entry: resolve(entry), name: 'XBookmarkShelfFileApp', formats: ['iife'] },
  }, esbuild: { jsx: 'automatic', jsxImportSource: 'preact' } });
  const outputs = Array.isArray(result) ? result.flatMap(r => r.output) : result.output;
  if (outputs.length !== 1 || outputs[0].type !== 'chunk') throw new Error('File app must have one script and no external assets');
  if (outputs[0].moduleIds.some(id => /(?:\/db\.ts|\/backup\.ts|\/i18n\.tsx|\/theme\.ts)$/.test(id) || id.includes('/node_modules/dexie/'))) throw new Error('File app must not include extension storage modules');
  const included = bundledComponents(result, ['preact']);
  const code = `${FILE_BANNER}\n${outputs[0].code}`.replace(/<\/script/gi, '<\\/script'); const hash = createHash('sha256').update(code).digest('base64');
  let css = await readFile('src/style.css', 'utf8') + '\n' + await readFile('src/viewer.css', 'utf8'); if (extraCss) css += '\n' + await readFile(extraCss, 'utf8');
  const license = await applicationLicense(); const notices = await thirdPartyNotices(included);
  const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data: https://pbs.twimg.com; connect-src http://127.0.0.1:* http://localhost:* https://pbs.twimg.com; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const html = `<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><title>xbookmarkshelf · ${title}</title><style>${css}</style></head>\n<body><div id="app"></div><noscript>JavaScriptを有効にしてください。 / Please enable JavaScript.</noscript>\n<details class="viewer-licenses"><summary>Licenses · MIT · xbookmarkshelf / Preact</summary><pre>${escapeLicense(license)}\n${escapeLicense(notices)}</pre></details>\n<script>${code}</script></body></html>\n`;
  await mkdir(directory, { recursive: true }); await writeFile(`${directory}/${filename}`, html);
  console.log(`Standalone ${title}: ${directory}/${filename} (${Buffer.byteLength(html)} bytes, licenses embedded)`);
}
