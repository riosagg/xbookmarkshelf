import { readAccount, readArticle, restrictedPage, libraryScope } from './dom';
import { type ImportRun, type StopReason, isLibraryUrl, isLibrarySource } from './model';
import { runReader } from './reader';

declare global { interface Window { __xBookmarkReaderVersion?: string } }
if (window.__xBookmarkReaderVersion !== '0.1.0-libraries') {
  window.__xBookmarkReaderVersion = '0.1.0-libraries';
  let controller: AbortController | null = null;
  async function request(type: string, run: ImportRun, extra = {}) {
    const reply = await chrome.runtime.sendMessage({ type, runId: run.id, source: run.source ?? 'bookmarks', ...extra });
    if (!reply?.ok) throw new Error('保存応答を取得できません');
    return reply.value as ImportRun;
  }
  function guard(run: ImportRun): StopReason | null {
    if (!isLibraryUrl(location.href)) return 'source_changed';
    if (libraryScope(document, location.href) !== (run.source ?? 'bookmarks')) return 'source_scope_changed';
    if (restrictedPage(document)) return 'access_restricted';
    if (readAccount(document) !== run.handle) return 'account_changed';
    if (document.hidden) return 'source_hidden';
    return null;
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.url?.startsWith('https://')) return;
    if (message?.type === 'INSPECT') {
      reply({ handle: readAccount(document), restricted: restrictedPage(document), url: location.href, source: libraryScope(document, location.href), bookmarkSelected: libraryScope(document, location.href) === 'bookmarks' });
    } else if (message?.type === 'CONTROL') {
      controller?.abort(); reply({ stopped: true });
    } else if (message?.type === 'READ' && !controller) {
      const run = message.run as ImportRun;
      if (run.source !== undefined && !isLibrarySource(run.source)) { reply({ started: false }); return; }
      const problem = guard(run);
      if (problem) { reply({ started: false }); return; }
      controller = new AbortController();
      const signal = controller.signal;
      window.scrollTo({ top: 0, behavior: 'instant' });
      reply({ started: true });
      void runReader(run, {
        observe: () => Array.from(document.querySelectorAll('article[data-testid="tweet"]')).map(a => readArticle(a)).filter(p => p !== null),
        guard: () => guard(run),
        watch: collect => { const observer = new MutationObserver(collect); observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'srcset', 'poster', 'style', 'data-testid'] }); return () => observer.disconnect(); },
        commit: (sequence, posts) => request('BATCH', run, { sequence, posts }),
        heartbeat: () => request('HEARTBEAT', run),
        finish: async reason => { await request('FINISH', run, { reason }); },
        scroll: () => window.scrollBy({ top: Math.max(200, innerHeight * 0.6), behavior: 'instant' }),
        wait: ms => new Promise(resolve => {
          if (signal.aborted) { resolve(); return; }
          const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true });
        }),
      }, signal).finally(() => { controller = null; });
    } else { reply({ started: false }); }
  });
}
