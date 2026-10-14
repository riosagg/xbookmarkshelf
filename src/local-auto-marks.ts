import { orderedMarks, MAX_POST_TAGS } from './model';
import { classifyPost, decisionSignature, emptyProgress, type DecisionConfig, type AiProgress } from './decision';
import { editLocalCollection, type LocalLibrary, type LocalSource } from './local-data';

export interface LocalDecision { key: string; ids: string[]; signature: string }
export function applyLocalDecisions(lib: LocalLibrary, source: LocalSource, decisions: LocalDecision[]) {
  const pending = new Map(decisions.map(d => [d.key, d]));
  const result = { marked: 0, unmatched: 0, skipped: 0, failed: 0 }; let changed = false;
  const library = editLocalCollection(lib, source, c => {
    const byAccount = new Map(c.accounts.map(a => [a.id, orderedMarks(c.tags.filter(t => t.accountId === a.id))]));
    const posts = c.posts.map(post => {
      const key = `${post.accountId}:${post.postId}`; const decision = pending.get(key); if (!decision) return post; pending.delete(key);
      const marks = byAccount.get(post.accountId) ?? [];
      if (decisionSignature(post, marks, post.tagIds) !== decision.signature || decision.ids.some(id => !marks.some(t => t.id === id))) { result.skipped++; return post; }
      const tagIds = [...new Set([...post.tagIds, ...decision.ids])];
      if (tagIds.length > MAX_POST_TAGS) { result.failed++; return post; }
      if (!decision.ids.length) result.unmatched++; else result.marked++;
      if (tagIds.length === post.tagIds.length) return post; changed = true; return { ...post, tagIds };
    }); return changed ? { ...c, posts } : c;
  });
  result.skipped += pending.size;
  return { library: changed ? library : lib, ...result };
}
export async function runLocalAutoMarks(source: LocalSource, keys: string[], config: DecisionConfig, signal: AbortSignal,
  current: () => LocalLibrary | null, commit: (lib: LocalLibrary) => void, progress: (value: AiProgress) => void) {
  const initial = current(); if (!initial) return;
  const collection = initial.libraries[source]; const selected = new Set(keys);
  const posts = collection.posts.filter(p => selected.has(`${p.accountId}:${p.postId}`));
  const marks = new Map(collection.accounts.map(a => [a.id, orderedMarks(collection.tags.filter(t => t.accountId === a.id))]));
  const state = emptyProgress(posts.length); let pending: LocalDecision[] = []; let failures = 0;
  function flush() {
    const lib = current(); if (!lib || lib.libraries[source].tags !== collection.tags) { signal.throwIfAborted(); throw new Error('Library changed during classification'); }
    if (pending.length) { const result = applyLocalDecisions(lib, source, pending); if (result.library !== lib) commit(result.library);
      state.marked += result.marked; state.unmatched += result.unmatched; state.skipped += result.skipped; state.failed += result.failed; pending = []; }
    progress({ ...state });
  }
  progress({ ...state });
  for (const post of posts) {
    if (signal.aborted) break;
    const own = marks.get(post.accountId) ?? [];
    if (!own.length) state.skipped++;
    else try {
      const ids = await classifyPost(config, post, own, signal); if (signal.aborted) break;
      failures = 0; pending.push({ key: `${post.accountId}:${post.postId}`, ids, signature: decisionSignature(post, own, post.tagIds) });
    } catch { if (signal.aborted) break; state.failed++; failures++; }
    state.done++;
    if (failures >= 3) { state.state = 'cancelled'; break; }
    progress({ ...state });
    if (state.done % 50 === 0) { flush(); await new Promise<void>(resolve => setTimeout(resolve, 0)); }
  }
  state.state = signal.aborted || state.state === 'cancelled' ? 'cancelled' : 'completed'; flush();
}
