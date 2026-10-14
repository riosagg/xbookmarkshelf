import { loadDecision, createAiJob, cancelAiJob, wakeAiJobs, registerAiJobs } from './auto-marks';
import { AI_JOB, type AiJob } from './decision';
import { accountFor, commitBatch, libraryStores, storeForSource, finishRun, newRun } from './db';
import { type ImportRun, type StopReason, type LibrarySource, type ImportLocations, REASON_LABELS, isLibrarySource, validHandle, validateOptions } from './model';
import { isImportPageUrl, runImportLocations } from './import-locations';
import { loadImportLocations } from './import-locations-store';

function sourceOf(value: unknown): LibrarySource {
  if (value === undefined) return 'bookmarks';
  if (!isLibrarySource(value)) throw new Error('ライブラリの種類が不正です');
  return value;
}
function trustedPage(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    if (![chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('library.html')].includes(`${url.protocol}//${url.host}${url.pathname}`) || url.hash) return false;
    return [...url.searchParams.keys()].every(key => key === 'source') && url.searchParams.getAll('source').length <= 1 &&
      (!url.searchParams.has('source') || isLibrarySource(url.searchParams.get('source')));
  } catch { return false; }
}
async function inspect(tabId: number, suppliedLocations?: ImportLocations) {
  const locations = suppliedLocations ?? await loadImportLocations();
  if (!Number.isInteger(tabId)) throw new Error('Xのタブを確認できません');
  const tab = await chrome.tabs.get(tabId);
  if (!isImportPageUrl(tab.url, locations)) throw new Error('Xのブックマークかいいねの画面を開いてください');
  const results = await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const documentId = results.find(r => r.frameId === 0)?.documentId;
  if (!documentId) throw new Error('ページの読み込みを確認できません');
  const response = await chrome.tabs.sendMessage(tabId, { type: 'INSPECT', locations }, { documentId });
  if (!isLibrarySource(response?.source)) throw new Error('XのHistoryでBookmarksかLikesを選ぶか、自分のいいね画面を開いてください');
  if (!isImportPageUrl(response?.url, locations) || !validHandle(response?.handle) || response.restricted) throw new Error('ログイン中のアカウントとページを確認できません');
  return { handle: response.handle.toLowerCase() as string, documentId, source: response.source as LibrarySource };
}
async function authorizedRun(id: unknown, source: LibrarySource, sender: chrome.runtime.MessageSender): Promise<ImportRun> {
  if (typeof id !== 'string' || id.length > 64) throw new Error('取り込みIDが不正です');
  const run = await storeForSource(source).importRuns.get(id);
  const locations = runImportLocations(run?.importLocations);
  if (!run || (run.source ?? 'bookmarks') !== source || sender.id !== chrome.runtime.id || sender.frameId !== 0 || sender.tab?.id !== run.tabId ||
      sender.documentId !== run.documentId || !locations || !isImportPageUrl(sender.url, locations)) throw new Error('送信元が不正です');
  const current = await chrome.tabs.get(run.tabId);
  if (!isImportPageUrl(current.url, locations)) throw new Error('対象ページが変わりました');
  return run;
}
async function expireRuns() {
  for (const store of libraryStores) {
    const runs = await store.importRuns.where('state').equals('running').toArray();
    for (const run of runs) if (Date.now() - Date.parse(run.updatedAt) > Math.max(90000, (run.intervalMaxMs ?? run.intervalMs) * 3)) await finishRun(run.id, 'interrupted', store);
  }
}
// Serialize starts across both databases; batches still commit in their own DB.
let startGate = Promise.resolve();
async function start(message: Record<string, unknown>, source: LibrarySource) {
  const previous = startGate;
  let release!: () => void;
  startGate = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    const options = validateOptions(message.options);
    const aiConfig = message.autoMark === true ? await loadDecision() : null;
    if (message.autoMark === true && !aiConfig) throw new Error('Connect local AI in Settings first');
    const tabId = message.tabId as number;
    const locations = await loadImportLocations();
    const identity = await inspect(tabId, locations);
    if (identity.handle !== message.handle) throw new Error('対象アカウントが変わりました');
    if (identity.source !== source) throw new Error('取り込み対象の一覧が変わりました');
    await expireRuns();
    for (const store of libraryStores) if (await store.importRuns.where('state').equals('running').count()) throw new Error('実行中の取り込みを停止してから開始してください');
    const store = storeForSource(source);
    const account = await accountFor(identity.handle, store);
    const run = newRun(account, tabId, identity.documentId, options, source);
    run.importLocations = locations;
    await store.importRuns.add(run);
    try {
      if (aiConfig) { await createAiJob(store, aiConfig, { runId: run.id }); await wakeAiJobs(); }
      const result = await chrome.tabs.sendMessage(tabId, { type: 'READ', run }, { documentId: run.documentId });
      if (!result?.started) throw new Error('読み取りを開始できません');
    } catch { await finishRun(run.id, 'error', store); throw new Error('読み取りを開始できません'); }
    return run;
  } finally { release(); }
}
async function handle(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
  if (!message || typeof message.type !== 'string') throw new Error('メッセージが不正です');
  const source = sourceOf(message.source);
  const store = storeForSource(source);
  if (trustedPage(sender)) {
    if (message.type === 'AI_START') {
      const config = await loadDecision(); if (!config) throw new Error('Connect local AI in Settings first');
      if (message.runId !== undefined && (typeof message.runId !== 'string' || message.runId.length > 64)) throw new Error('Invalid import');
      if (message.accountId !== undefined && (typeof message.accountId !== 'string' || message.accountId.length > 64)) throw new Error('Invalid account');
      const job = await createAiJob(store, config, { runId: message.runId as string | undefined, accountId: message.accountId as string | undefined });
      await wakeAiJobs(); return job;
    }
    if (message.type === 'AI_STOP') { await cancelAiJob(store); return true; }
    if (message.type === 'INSPECT_TAB') return inspect(message.tabId as number);
    if (message.type === 'START') return start(message, source);
    if (message.type === 'STATUS') { await expireRuns(); return store.importRuns.orderBy('startedAt').reverse().first(); }
    if (message.type === 'STOP') {
      const run = await finishRun(message.runId as string, message.pause === true ? 'user_pause' : 'manual_stop', store);
      try { await chrome.tabs.sendMessage(run.tabId, { type: 'CONTROL' }, { documentId: run.documentId }); } catch { /* The X tab may already have closed. */ }
      return run;
    }
    throw new Error('操作が不正です');
  }
  const run = await authorizedRun(message.runId, source, sender);
  if (message.type === 'BATCH') {
    const locations = runImportLocations(run.importLocations)!;
    const identity = await chrome.tabs.sendMessage(run.tabId, { type: 'INSPECT', locations }, { documentId: run.documentId });
    if (identity?.source !== source) return finishRun(run.id, 'source_scope_changed', store);
    if (identity?.handle !== run.handle || identity.restricted || !isImportPageUrl(identity.url, locations)) return finishRun(run.id, 'account_changed', store);
    const saved = await commitBatch(run.id, message.sequence as number, message.posts, store);
    if (((await store.settings.get(AI_JOB))?.value as AiJob | undefined)?.state === 'running') void wakeAiJobs();
    return saved;
  }
  if (message.type === 'HEARTBEAT') return store.transaction('rw', store.importRuns, async () => {
    const current = await store.importRuns.get(run.id);
    if (!current) throw new Error('取り込みが見つかりません');
    if (current.state === 'running') { current.updatedAt = new Date().toISOString(); await store.importRuns.put(current); }
    return current;
  });
  if (message.type === 'FINISH' && typeof message.reason === 'string' && Object.hasOwn(REASON_LABELS, message.reason)) return finishRun(run.id, message.reason as StopReason, store);
  throw new Error('操作が不正です');
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  void handle(message, sender).then(value => reply({ ok: true, value }), error => reply({ ok: false, error: error instanceof Error ? error.message : '処理に失敗しました' }));
  return true;
});
async function stopForTab(tabId: number, reason: StopReason) {
  for (const store of libraryStores) {
    const runs = await store.importRuns.where('tabId').equals(tabId).filter(r => r.state === 'running').toArray();
    for (const run of runs) await finishRun(run.id, reason, store);
  }
}
chrome.tabs.onRemoved.addListener(tabId => { void stopForTab(tabId, 'tab_closed'); });
chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (!changes.url) return;
  const url = changes.url;
  for (const store of libraryStores) void store.importRuns.where('tabId').equals(tabId).filter(r => r.state === 'running').toArray().then(async runs => {
    for (const run of runs) {
      const locations = runImportLocations(run.importLocations);
      if (!locations || !isImportPageUrl(url, locations)) await finishRun(run.id, 'source_changed', store);
    }
  });
});
chrome.runtime.onStartup.addListener(() => {
  for (const store of libraryStores) void store.importRuns.where('state').equals('running').toArray().then(runs => Promise.all(runs.map(r => finishRun(r.id, 'interrupted', store))));
});

registerAiJobs();
