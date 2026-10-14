import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LibraryDB, newRun, commitBatch } from '../../src/db';
import { createAiJob, cancelAiJob, processAiPost } from '../../src/auto-marks';
import { DEFAULT_DECISION, classifyPost, decisionConfig, decisionSignature, AI_JOB, type AiJob } from '../../src/decision';
import { applyLocalDecisions, runLocalAutoMarks } from '../../src/local-auto-marks';
import { emptyLocalLibrary, parseLocalLibrary, serializeLocalLibrary, type LocalLibrary } from '../../src/local-data';
import { observation } from './helpers';
const config = { ...DEFAULT_DECISION, images: false };
const post = { ...observation('1', 'Python programs'), accountId: 'a', firstImportedAt: '2026-10-14T00:00:00Z', lastImportedAt: '2026-10-14T00:00:00Z' };
const marks = [{ id: 'old', accountId: 'a', name: 'Keep', mark: 'star' as const }, { id: 'code', accountId: 'a', name: 'Programming', mark: 'code' as const }];
let store: LibraryDB;
const reply = (probability = 0.99) => new Response(JSON.stringify({ answers: { mark_0: { type: 'noul', noul: probability }, mark_1: { type: 'noul', noul: probability } } }));
beforeEach(async () => {
  store = new LibraryDB(`synthetic-ai-${crypto.randomUUID()}`);
  await store.posts.put(post); await store.tags.bulkPut(marks);
  await store.postTags.put({ accountId: 'a', postId: '1', tagId: 'old' });
  await store.userStates.put({ accountId: 'a', postId: '1', read: true, favorite: true });
  vi.stubGlobal('fetch', vi.fn(async () => reply()));
});
afterEach(async () => { await store.delete(); vi.unstubAllGlobals(); });
it('allows loopback only and bounds threshold/model without accepting credential URLs', () => {
  expect(decisionConfig(config).endpoint).toBe('http://127.0.0.1:1234');
  for (const endpoint of ['https://example.com', 'http://127.0.0.1:1234/v1', 'http://name:pass@localhost:1234', 'http://localhost:1234?token=x']) expect(() => decisionConfig({ ...config, endpoint })).toThrow();
  expect(() => decisionConfig({ ...config, threshold: NaN })).toThrow();
});
it('adds multiple marks idempotently and retains read/favorite/post data', async () => {
  for (let run = 0; run < 2; run++) { await createAiJob(store, config); await processAiPost(store); await processAiPost(store); }
  expect((await store.postTags.toArray()).map(t => t.tagId).sort()).toEqual(['code', 'old']);
  expect(await store.posts.get(['a', '1'])).toEqual(post);
  expect(await store.userStates.get(['a', '1'])).toMatchObject({ read: true, favorite: true });
  expect((await store.settings.get(AI_JOB))?.value).toMatchObject({ done: 1, marked: 1, state: 'completed' });
});
it('leaves no-match assignments intact and treats invalid responses as failure', async () => {
  vi.mocked(fetch).mockImplementation(async () => reply(0.1));
  await createAiJob(store, config); await processAiPost(store); await processAiPost(store);
  expect(await store.postTags.count()).toBe(1); expect((await store.settings.get(AI_JOB))?.value).toMatchObject({ unmatched: 1 });
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ answers: { mark_0: { type: 'noul', noul: 2 }, mark_1: { type: 'noul', noul: 1 } } })));
  await createAiJob(store, config); await processAiPost(store);
  expect(await store.postTags.count()).toBe(1); expect((await store.settings.get(AI_JOB))?.value).toMatchObject({ failed: 1, unmatched: 0 });
});
it('rejects late results after cancellation, manual changes, deletion or replacement', async () => {
  for (const action of ['cancel', 'edit', 'delete', 'replace']) {
    await store.posts.put(post); await createAiJob(store, config);
    let resolve!: (value: Response) => void; let entered!: () => void; const ready = new Promise<void>(r => entered = r);
    vi.mocked(fetch).mockImplementation(() => { entered(); return new Promise<Response>(r => resolve = r); });
    const processing = processAiPost(store); await ready;
    if (action === 'cancel') await cancelAiJob(store);
    if (action === 'edit') await store.tags.update('code', { name: 'A different category' });
    if (action === 'delete') await store.posts.delete(['a', '1']);
    if (action === 'replace') await store.posts.put({ ...post, firstImportedAt: '2026-10-15T00:00:00Z' });
    resolve(reply()); await processing;
    expect(await store.postTags.get(['a', '1', 'code'])).toBeUndefined();
    await cancelAiJob(store); await store.tags.bulkPut(marks);
  }
});
it('records only actually committed import members, including replay and the final partial batch', async () => {
  const run = newRun({ id: 'a', handle: 'sample' }, 1, 'doc', { maxPosts: 10, mode: 'full', intervalMs: 3000 });
  run.observed = 9; run.importedPostIds = ['1']; await store.importRuns.put(run);
  const input = [observation('10'), observation('11')];
  const saved = await commitBatch(run.id, 0, input, store); expect(saved.importedPostIds).toEqual(['1', '10']);
  expect((await commitBatch(run.id, 0, input, store)).importedPostIds).toEqual(['1', '10']);
  expect(await store.posts.get(['a', '11'])).toBeUndefined();
  await createAiJob(store, config, { runId: run.id });
  await processAiPost(store); await processAiPost(store); await processAiPost(store);
  expect((await store.settings.get(AI_JOB))?.value).toMatchObject({ total: 2, done: 2, state: 'completed' });
});
it('resumes persisted progress and never writes to another source or account', async () => {
  await store.posts.put({ ...post, accountId: 'b' });
  const other = new LibraryDB(`synthetic-likes-${crypto.randomUUID()}`, 'likes');
  try {
    await other.posts.put(post); await other.tags.bulkPut(marks); await createAiJob(other, config);
    await processAiPost(other); expect(await other.postTags.count()).toBe(2); expect(await store.postTags.count()).toBe(1);
    await createAiJob(store, config, { accountId: 'a' }); const name = store.name; store.close(); store = new LibraryDB(name);
    await processAiPost(store); await processAiPost(store);
    expect(await store.postTags.where('[accountId+postId]').equals(['b', '1']).count()).toBe(0);
    expect((await store.settings.get(AI_JOB))?.value).toMatchObject({ state: 'completed', done: 1 });
  } finally { await other.delete(); }
});
function library(): LocalLibrary {
  const lib = emptyLocalLibrary(); lib.libraries.bookmarks = { accounts: [{ id: 'a', handle: 'sample' }], tags: marks,
    posts: [{ ...post, mediaStatus: 'observed', dateSource: 'provided', read: true, favorite: true, tagIds: ['old'] }] }; return lib;
}
it('local application protects assignments, rejects foreign IDs and survives JSON roundtrip', () => {
  const lib = library(); const p = lib.libraries.bookmarks.posts[0]!;
  const update = { key: 'a:1', ids: ['code'], signature: decisionSignature(p, marks, p.tagIds) };
  const result = applyLocalDecisions(lib, 'bookmarks', [update]);
  expect(result.marked).toBe(1); expect(result.library.libraries.bookmarks.posts[0]?.tagIds).toEqual(['old', 'code']);
  expect(lib.libraries.bookmarks.posts[0]?.tagIds).toEqual(['old']);
  expect(applyLocalDecisions(lib, 'bookmarks', [{ ...update, ids: ['foreign'] }]).skipped).toBe(1);
  const restored = parseLocalLibrary(serializeLocalLibrary(result.library));
  expect(restored.libraries.bookmarks.posts[0]).toMatchObject({ read: true, favorite: true, tagIds: ['old', 'code'] });
  expect(restored.libraries.likes.posts).toEqual([]);
});
it('local cancellation retains completed edits and does not write late classifications', async () => {
  let current = library(); const controller = new AbortController();
  vi.mocked(fetch).mockImplementation(async () => { controller.abort(); return reply(); });
  let last: unknown;
  await runLocalAutoMarks('bookmarks', ['a:1'], config, controller.signal, () => current, value => current = value, value => last = value);
  expect(current.libraries.bookmarks.posts[0]?.tagIds).toEqual(['old']); expect(last).toMatchObject({ state: 'cancelled', done: 0 });
});
it('sends bounded typed questions and rejects extra probability IDs', async () => {
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    expect(options?.redirect).toBe('error'); expect(options?.credentials).toBe('omit');
    const payload = JSON.parse(options?.body as string); expect(payload.model).toBe('d1-3b'); expect(payload.images).toBeUndefined();
    expect(Object.keys(payload.questions)).toEqual(['mark_0', 'mark_1']);
    return new Response(JSON.stringify({ answers: { mark_0: { type: 'noul', noul: 1 }, mark_1: { type: 'noul', noul: 1 }, unknown: { type: 'noul', noul: 1 } } }));
  });
  await expect(classifyPost(config, post, marks)).rejects.toThrow('Invalid decision response');
});
it('rejects additions over the combined tag limit without partial writes', async () => {
  const ordinary = Array.from({ length: 19 }, (_, i) => ({ id: `tag-${i}`, accountId: 'a', name: `Ordinary ${i}` }));
  await store.tags.bulkPut(ordinary); await store.postTags.bulkPut(ordinary.map(t => ({ accountId: 'a', postId: '1', tagId: t.id })));
  await createAiJob(store, config); await processAiPost(store);
  expect(await store.postTags.count()).toBe(20); expect(await store.postTags.get(['a', '1', 'code'])).toBeUndefined();
  expect((await store.settings.get(AI_JOB))?.value as AiJob).toMatchObject({ failed: 1 });
});
it('stops a durable job after three consecutive failures, retaining previous assignments', async () => {
  await store.posts.bulkPut(['2', '3', '4'].map(postId => ({ ...post, postId })));
  vi.mocked(fetch).mockRejectedValue(new Error('Synthetic API unavailable'));
  await createAiJob(store, config);
  await processAiPost(store); await processAiPost(store); await processAiPost(store);
  expect(await processAiPost(store)).toBe(false);
  expect((await store.settings.get(AI_JOB))?.value).toMatchObject({ state: 'cancelled', failed: 3, done: 3 });
  expect(await store.postTags.count()).toBe(1);
});
