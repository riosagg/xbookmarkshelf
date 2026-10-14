import { db, libraryStores, type LibraryDB } from './db';
import { orderedMarks, MAX_POST_TAGS } from './model';
import { AI_CONFIG, AI_JOB, AI_KEYS, decisionConfig, decisionSignature, classifyPost, emptyProgress, type AiJob, type DecisionConfig } from './decision';

export async function loadDecision(): Promise<DecisionConfig | null> {
  const row = await db.settings.get(AI_CONFIG); return row ? decisionConfig(row.value) : null;
}
export async function createAiJob(store: LibraryDB, config: DecisionConfig, scope: { runId?: string; accountId?: string } = {}): Promise<AiJob> {
  return store.transaction('rw', store.settings, store.posts, store.importRuns, async () => {
    const previous = (await store.settings.get(AI_JOB))?.value as AiJob | undefined;
    if (previous?.state === 'running') throw new Error('Auto-marking is already running');
    const run = scope.runId ? await store.importRuns.get(scope.runId) : undefined;
    if (scope.runId && !run) throw new Error('Import not found');
    const keys = run ? (run.importedPostIds ?? []).map(id => [run.accountId, id] as [string, string]) :
      await (scope.accountId ? store.posts.where('accountId').equals(scope.accountId) : store.posts.toCollection()).primaryKeys();
    if (keys.length > 200000) throw new Error('Choose an account with at most 200,000 posts');
    const job: AiJob = { ...emptyProgress(keys.length), id: crypto.randomUUID(), config: decisionConfig(config), ...(run ? { runId: run.id } : {}) };
    await store.settings.where('key').startsWith(`${AI_KEYS}:`).delete();
    for (let offset = 0; offset < keys.length; offset += 500) await store.settings.put({ key: `${AI_KEYS}:${Math.floor(offset / 500)}`, value: keys.slice(offset, offset + 500) });
    await store.settings.put({ key: AI_JOB, value: job }); return job;
  });
}
export async function cancelAiJob(store: LibraryDB) {
  await store.transaction('rw', store.settings, async () => { const job = (await store.settings.get(AI_JOB))?.value as AiJob | undefined;
    if (job?.state === 'running') { await store.settings.put({ key: AI_JOB, value: { ...job, state: 'cancelled' } }); await store.settings.where('key').startsWith(`${AI_KEYS}:`).delete(); } });
}
// Inference never runs inside an IndexedDB transaction. Recheck the entire input and
// assignment snapshot in the write transaction so manual edits take precedence.
export async function processAiPost(store: LibraryDB): Promise<boolean> {
  const input = await store.transaction('rw', store.settings, store.importRuns, store.posts, store.tags, store.postTags, async () => {
    const job = (await store.settings.get(AI_JOB))?.value as AiJob | undefined; if (!job || job.state !== 'running') return null;
    const run = job.runId ? await store.importRuns.get(job.runId) : undefined;
    const keys = run ? (run.importedPostIds ?? []).map(id => [run.accountId, id] as [string, string]) : ((await store.settings.get(`${AI_KEYS}:${Math.floor(job.done / 500)}`))?.value ?? []) as [string, string][];
    if (run) job.total = keys.length;
    if (job.done >= job.total) { if (!run || run.state !== 'running') { job.state = 'completed'; await store.settings.where('key').startsWith(`${AI_KEYS}:`).delete(); } await store.settings.put({ key: AI_JOB, value: job }); return null; }
    const key = keys[run ? job.done : job.done % 500]; if (!key) throw new Error('AI job membership missing'); const post = await store.posts.get(key);
    const marks = orderedMarks(await store.tags.where('accountId').equals(key[0]).toArray());
    const assigned = (await store.postTags.where('[accountId+postId]').equals(key).toArray()).map(t => t.tagId);
    return { job, key, post, marks, assigned, signature: post ? decisionSignature(post, marks, assigned) : '' };
  });
  if (!input) return false;
  let chosen: string[] = []; let failed = false;
  if (input.post && input.marks.length) {
    try { chosen = await classifyPost(input.job.config, input.post, input.marks); }
    catch { failed = true; }
  }
  await store.transaction('rw', store.settings, store.posts, store.tags, store.postTags, async () => {
    const job = (await store.settings.get(AI_JOB))?.value as AiJob | undefined;
    if (!job || job.id !== input.job.id || job.state !== 'running' || job.done !== input.job.done) return;
    const post = await store.posts.get(input.key);
    const marks = orderedMarks(await store.tags.where('accountId').equals(input.key[0]).toArray());
    const assigned = (await store.postTags.where('[accountId+postId]').equals(input.key).toArray()).map(t => t.tagId);
    const stale = !post || decisionSignature(post, marks, assigned) !== input.signature;
    const additions = chosen.filter(id => !assigned.includes(id));
    if (stale || !input.marks.length) job.skipped++;
    else if (failed || assigned.length + additions.length > MAX_POST_TAGS) { job.failed++; job.error = 'AI classification failed. Check the connection, images and tag limit.'; }
    else if (!chosen.length) job.unmatched++;
    else { if (additions.length) await store.postTags.bulkPut(additions.map(tagId => ({ accountId: input.key[0], postId: input.key[1], tagId }))); job.marked++; }
    job.consecutiveFailures = failed ? (job.consecutiveFailures ?? 0) + 1 : 0;
    if (job.consecutiveFailures >= 3) { job.state = 'cancelled'; await store.settings.where('key').startsWith(`${AI_KEYS}:`).delete(); }
    job.done++; await store.settings.put({ key: AI_JOB, value: job });
  });
  return true;
}
const ALARM = 'xbookmarkshelf-auto-marks';
let pump: Promise<void> | undefined;
export async function wakeAiJobs() {
  if (typeof chrome !== 'undefined' && chrome.alarms) await chrome.alarms.create(ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  if (pump) return;
  pump = (async () => {
    const deadline = Date.now() + 15000;
    let worked: boolean;
    do { worked = false; for (const store of libraryStores) {
      const connected = await loadDecision(); const job = (await store.settings.get(AI_JOB))?.value as AiJob | undefined;
      if (job?.state === 'running' && (!connected || JSON.stringify(connected) !== JSON.stringify(job.config))) await cancelAiJob(store);
      worked = await processAiPost(store) || worked; if (Date.now() >= deadline) break; } } while (worked && Date.now() < deadline);
    const active = await Promise.all(libraryStores.map(async store => ((await store.settings.get(AI_JOB))?.value as AiJob | undefined)?.state === 'running'));
    if (!active.some(Boolean) && typeof chrome !== 'undefined' && chrome.alarms) await chrome.alarms.clear(ALARM);
  })().catch(() => { /* Durable jobs are retried by the alarm; never expose post/API data. */ }).finally(() => { pump = undefined; });
}
export function registerAiJobs() {
  chrome.alarms?.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void wakeAiJobs(); });
  chrome.runtime.onStartup.addListener(() => { void wakeAiJobs(); });
}
