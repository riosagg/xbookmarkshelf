import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXTENSION_COMPONENTS = ['preact', 'dexie', 'vite', 'rolldown'];
export const EXTENSION_BANNER = '/*! xbookmarkshelf application: MIT (LICENSE.txt). Bundled/minified by xbookmarkshelf; third-party licenses and notices: THIRD_PARTY_NOTICES.txt. */';
export const FILE_BANNER = '/*! xbookmarkshelf application: MIT. Bundled/minified by xbookmarkshelf; third-party licenses and notices are in the embedded Licenses section. */';
const catalog = {
  preact: { license: 'MIT', source: 'https://github.com/preactjs/preact', role: 'UI runtime', files: ['LICENSE'] },
  dexie: { license: 'Apache-2.0', source: 'https://github.com/dexie/Dexie.js', role: 'IndexedDB runtime', files: ['NOTICE', 'LICENSE'] },
  vite: { license: 'MIT', source: 'https://github.com/vitejs/vite', role: 'Generated modulepreload polyfill only', files: ['LICENSE.md'] },
  rolldown: { license: 'MIT', source: 'https://github.com/rolldown/rolldown', role: 'Generated bundle runtime helpers only', files: ['LICENSE', 'THIRD-PARTY-LICENSE'] },
};
export const escapeLicense = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export async function applicationLicense() {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  if (pkg.license !== 'MIT' || lock.packages[''].license !== 'MIT') throw new Error('Application license metadata must be MIT');
  const text = await readFile('LICENSE', 'utf8');
  const original = await readFile('node_modules/preact/LICENSE', 'utf8');
  const terms = value => value.slice(value.indexOf('Permission is hereby granted')).trim().replace(/\s+/g, ' ');
  if (!text.startsWith('MIT License\n') || !/Copyright \(c\) \d{4}(?:-\d{4})? \S/.test(text) || !text.includes('Permission is hereby granted') || terms(text) !== terms(original)) throw new Error('Application LICENSE is missing its MIT notice or original terms');
  return text;
}
async function componentNotice(name) {
  const item = catalog[name];
  if (!item) throw new Error(`Unreviewed bundled component: ${name}`);
  const directory = `node_modules/${name}`;
  const pkg = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  if (pkg.name !== name || pkg.license !== item.license || pkg.version !== lock.packages[`node_modules/${name}`]?.version) throw new Error(`License/version mismatch for ${name}`);
  const originals = [];
  for (const filename of item.files) {
    let text = await readFile(`${directory}/${filename}`, 'utf8');
    if (name === 'vite') {
      const boundary = text.indexOf('\n# Licenses of bundled dependencies');
      if (boundary < 0) throw new Error('Vite core license boundary changed; review the bundled helper license');
      text = text.slice(0, boundary);
    }
    originals.push(`${filename}\n${text}`);
  }
  return `${name} ${pkg.version} — ${item.license}\n${item.role}\nSource: ${item.source}\n${'='.repeat(60)}\n${originals.join('\n\n')}`;
}
export async function thirdPartyNotices(names) {
  const blocks = [];
  for (const name of names) blocks.push(await componentNotice(name));
  return `Third-party components bundled in xbookmarkshelf.\n\nThe application is MIT-licensed. Each component retains its own license.\nUpstream source is not edited; distributed code is bundled and minified.\nThe original notices and license terms below are reproduced from the\ninstalled packages matching package-lock.json.\n\n${blocks.join('\n\n')}\n`;
}
export function bundledComponents(result, allowed) {
  const results = Array.isArray(result) ? result : [result];
  const names = new Set();
  for (const chunk of results.flatMap(r => r.output).filter(o => o.type === 'chunk')) {
    for (const raw of chunk.moduleIds) {
      const id = raw.replace(/\\/g, '/'); let name;
      const nodeModules = id.lastIndexOf('/node_modules/');
      if (nodeModules >= 0) {
        const parts = id.slice(nodeModules + '/node_modules/'.length).split('/');
        name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      } else if (id.startsWith('\0vite/')) name = 'vite';
      else if (id === '\0rolldown/runtime.js') name = 'rolldown';
      else if (id.startsWith('\0')) throw new Error('Unreviewed virtual runtime module; update the license catalog');
      if (name) {
        if (!catalog[name] || !allowed.includes(name)) throw new Error(`Unreviewed bundled component: ${name}`);
        names.add(name);
      }
    }
  }
  return allowed.filter(name => names.has(name));
}
export async function writeExtensionLicenses() {
  await writeFile('public/LICENSE.txt', await applicationLicense());
  await writeFile('public/THIRD_PARTY_NOTICES.txt', await thirdPartyNotices(EXTENSION_COMPONENTS));
}
export async function checkLicenses() {
  const application = await applicationLicense();
  const extension = await thirdPartyNotices(EXTENSION_COMPONENTS);
  for (const directory of ['public', 'dist']) {
    if (await readFile(`${directory}/LICENSE.txt`, 'utf8') !== application || await readFile(`${directory}/THIRD_PARTY_NOTICES.txt`, 'utf8') !== extension) throw new Error(`Stale license files in ${directory}`);
  }
  for (const filename of await readdir('dist', { recursive: true })) {
    if (filename.endsWith('.js') && filename !== 'theme-init.js' && !(await readFile(`dist/${filename}`, 'utf8')).startsWith(EXTENSION_BANNER)) throw new Error(`Missing bundle/minification notice in ${filename}`);
  }
  const preact = escapeLicense(await thirdPartyNotices(['preact']));
  for (const path of ['local-dist/xbookmarkshelf-local.html']) {
    const html = await readFile(path, 'utf8');
    if (!html.includes(escapeLicense(application)) || !html.includes(preact) || !html.includes(FILE_BANNER)) throw new Error(`Missing embedded license in ${path}`);
    if (html.includes('IndexedDB runtime') || html.includes('Generated modulepreload polyfill only')) throw new Error(`Unexpected extension license in ${path}`);
  }
  console.log('License check passed: MIT application; extension Preact/Dexie/Vite/Rolldown; local HTML Preact.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--check') await checkLicenses();
  else if (!process.argv[2]) await writeExtensionLicenses();
  else throw new Error('Use licenses.mjs with no arguments or --check');
}
