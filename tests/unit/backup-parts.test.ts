import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { prepareBackupFiles, postBackupFilename, verifyBackupParts } from '../../src/backup-parts';
import { BACKUP_MAX_BYTES, validateCollectionBackup, type CollectionBackup } from '../../src/backup-format';
import { createBackup, restoreBackups } from '../../src/backup';
import { LibraryDB } from '../../src/db';
import { emptyLocalLibrary, parseLocalImport, mergeLocalImport, verifyLocalImportParts, serializeLocalLibrary, parseLocalLibrary } from '../../src/local-data';
import { parseViewerText } from '../../src/viewer-data';
import { observation, timestamp } from './helpers';
const stores: LibraryDB[] = [];
function store(source: 'bookmarks' | 'likes' = 'bookmarks') { const db = new LibraryDB(`parts-${crypto.randomUUID()}`, source); stores.push(db); return db; }
afterEach(async () => { for (const db of stores.splice(0)) await db.delete(); });
function snapshot(count = 8, source: 'bookmarks' | 'likes' = 'bookmarks'): CollectionBackup {
  return { ...(source === 'likes' ? { format: 'xbookmarkshelf-likes' as const, formatVersion: 1 as const } : { format: 'x-bookmark-library' as const, formatVersion: 2 as const }),
    exportedAt: timestamp, accounts: [{ id: 'a', handle: 'sample' }, { id: 'unused', handle: 'unused' }],
    posts: Array.from({ length: count }, (_, i) => ({ ...observation(String(i + 1), '合成'.repeat(300)), accountId: 'a', firstImportedAt: timestamp, lastImportedAt: timestamp })),
    tags: [{ id: 'late', accountId: 'a', name: 'Later', mark: 'star', markOrder: 1 }, { id: 'early', accountId: 'a', name: 'First', mark: 'book', markOrder: 0 },
      { id: 'empty', accountId: 'unused', name: 'Unused', mark: 'flag', markOrder: 0 }, { id: 'plain', accountId: 'a', name: 'Unused plain tag' }],
    userStates: count ? [{ accountId: 'a', postId: '1', read: true, favorite: true }] : [], postTags: count ? [{ accountId: 'a', postId: '1', tagId: 'late' }] : [] };
}
it.each(['bookmarks', 'likes'] as const)('splits %s with valid dependency subsets, unused definitions, original order and no snapshot mutation', async source => {
  const input = snapshot(8, source); const original = JSON.stringify(input);
  const files = prepareBackupFiles(input, 'CON:<long>?', 6000); expect(files.length).toBeGreaterThan(1);
  const parts = files.map(file => { expect(new TextEncoder().encode(file.text).length).toBeLessThanOrEqual(6000); expect(file.name).not.toMatch(/[<>:"/\\|?*]/); return validateCollectionBackup(JSON.parse(file.text), source); });
  expect(() => verifyBackupParts(parts)).not.toThrow(); expect(JSON.stringify(input)).toBe(original);
  for (const file of files) expect(() => parseViewerText(file.text)).not.toThrow();
  const target = store(source); expect(await restoreBackups(parts.slice().reverse(), target)).toEqual({ added: 8, existing: 0 });
  expect(await target.posts.count()).toBe(8); expect(await target.tags.count()).toBe(4);
  expect((await createBackup(target)).accounts).toHaveLength(2);
  expect(await target.userStates.get(['a', '1'])).toMatchObject({ read: true, favorite: true });
  const marks = (await target.tags.where('accountId').equals('a').filter(t => !!t.mark).sortBy('markOrder')).map(t => t.name); expect(marks).toEqual(['First', 'Later']);
  expect(await restoreBackups(parts, target)).toEqual({ added: 0, existing: 8 }); expect(await target.postTags.count()).toBe(1);
  const inputs = files.map(file => parseLocalImport(file.text)); verifyLocalImportParts(inputs);
  let lib = emptyLocalLibrary(); for (const input of inputs.slice().reverse()) lib = mergeLocalImport(lib, input).library;
  expect(parseLocalLibrary(serializeLocalLibrary(lib)).libraries[source].posts).toHaveLength(8);
});
it('rejects missing, duplicate, wrong-source and mixed-header parts before writing', async () => {
  const parts = prepareBackupFiles(snapshot(), undefined, 6000).map(file => JSON.parse(file.text)); const target = store();
  for (const inputs of [parts.slice(1), [...parts, parts[0]], [{ ...parts[0], split: { ...parts[0].split, total: 9999 } }, ...parts.slice(1)],
    [parts[0], { ...parts[1], format: 'xbookmarkshelf-likes', formatVersion: 1 }, ...parts.slice(2)]]) {
    await expect(restoreBackups(inputs, target)).rejects.toThrow(); expect(await target.posts.count()).toBe(0);
  }
  expect(() => verifyLocalImportParts([parseLocalImport(JSON.stringify(parts[0]))])).toThrow();
});
it('rolls back earlier parts when a later restore hits an account or mark conflict', async () => {
  const input = snapshot(); const target = store();
  await target.settings.put({ key: 'accounts', value: [{ id: 'unused', handle: 'different' }] });
  const parts = prepareBackupFiles(input, undefined, 6000).map(file => JSON.parse(file.text));
  await expect(restoreBackups(parts, target)).rejects.toThrow('アカウントID');
  expect(await target.posts.count()).toBe(0); expect(await target.tags.count()).toBe(0); expect(await target.postTags.count()).toBe(0);
});
it('splits the reproduced 20MiB overflow and preserves every post without changing the input cap', () => {
  const value = snapshot(430); value.posts.forEach(p => { p.text = 'x'.repeat(50000); });
  const files = prepareBackupFiles(value); expect(files.length).toBeGreaterThan(1);
  expect(files.reduce((n, file) => n + parseViewerText(file.text).posts.length, 0)).toBe(430);
  files.forEach(file => expect(new TextEncoder().encode(file.text).length).toBeLessThanOrEqual(BACKUP_MAX_BYTES));
});
it('splits record overflow and emits no files for structurally invalid snapshots', () => {
  const value = snapshot(0); value.tags = Array.from({ length: 10001 }, (_, i) => ({ id: `t${i}`, accountId: 'a', name: `Tag ${i}` }));
  const files = prepareBackupFiles(value); expect(files).toHaveLength(2);
  const parts = files.map(f => validateCollectionBackup(JSON.parse(f.text), 'bookmarks'));
  expect(parts.reduce((n, p) => n + p.tags.length, 0)).toBe(10001);
  expect(() => prepareBackupFiles({ ...snapshot(), postTags: [{ accountId: 'a', postId: 'missing', tagId: 'late' }] })).toThrow();
  expect(() => prepareBackupFiles(snapshot(), undefined, 100)).toThrow();
});
it('keeps every generated full/marked/split filename ignored by Git', () => {
  const names = (['bookmarks', 'likes'] as const).flatMap(source => [postBackupFilename(undefined, '2026-10-12', source), postBackupFilename('合成 / mark', '2026-10-12', source),
    ...prepareBackupFiles(snapshot(8, source), undefined, 6000).map(file => file.name)]);
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { input: names.join('\n') + '\n', encoding: 'utf8' }).trim().split('\n');
  expect(ignored).toHaveLength(names.length);
});
