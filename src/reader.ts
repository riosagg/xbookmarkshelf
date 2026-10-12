import { BATCH_SIZE, mergeMedia, mergeQuote, chooseIntervalMs, type ImportRun, type ObservedPost, type StopReason } from './model';
import { appendMissingLinks, textLinks } from './text';

function mergeObservation(prior: ObservedPost | undefined, next: ObservedPost): ObservedPost {
  if (!prior) return next;
  const longer = prior.text.length > next.text.length ? prior : next;
  const other = longer === prior ? next : prior;
  const cards = new Map((prior.linkCards ?? []).map(card => [card.url, card]));
  for (const card of next.linkCards ?? []) cards.set(card.url, { ...card, title: card.title || cards.get(card.url)?.title || '' });
  const linkCards = [...cards.values()].slice(0, 4);
  const quote = mergeQuote(prior.quote, next.quote);
  return { ...next, text: appendMissingLinks(longer.text, textLinks(other.text).map(link => link.url)),
    postedAt: next.postedAt ?? prior.postedAt, media: mergeMedia(prior.media, next.media),
    ...(linkCards.length ? { linkCards } : {}), ...(quote ? { quote } : {}) };
}

export interface ReaderPort {
  observe(): ObservedPost[];
  guard(): StopReason | null;
  watch(collect: () => void): () => void;
  commit(sequence: number, posts: ObservedPost[]): Promise<ImportRun>;
  heartbeat(): Promise<ImportRun>;
  finish(reason: StopReason): Promise<void>;
  scroll(): void;
  wait(ms: number): Promise<void>;
}
export async function runReader(initial: ImportRun, port: ReaderPort, signal: AbortSignal) {
  let run = initial;
  const seen = new Set<string>();
  const queue = new Map<string, ObservedPost>();
  let overflow = false;
  const collect = () => {
    if (signal.aborted || port.guard()) return;
    for (const p of port.observe()) {
      if (seen.has(p.postId)) continue;
      if (!queue.has(p.postId) && queue.size >= 200) { overflow = true; break; }
      const prior = queue.get(p.postId);
      queue.set(p.postId, mergeObservation(prior, p));
    }
  };
  let idle = 0;
  const disconnect = port.watch(collect);
  try {
    while (run.state === 'running' && !signal.aborted) {
      const problem = port.guard();
      if (problem) { await port.finish(problem); break; }
      const intervalMs = chooseIntervalMs(run);
      collect();
      if (overflow) throw new Error('観測キューの上限');
      let waited = 0;
      if (queue.size) {
        // Allow late image/poster attributes to settle within the existing interval.
        waited = Math.min(intervalMs, 3000);
        await port.wait(waited);
        if (signal.aborted) break;
        const beforeSave = port.guard();
        if (beforeSave) { await port.finish(beforeSave); break; }
        collect();
        if (overflow) throw new Error('観測キューの上限');
        const batch = Array.from(queue.values()).slice(0, Math.min(BATCH_SIZE, run.maxPosts - run.observed));
        if (!batch.length) { await port.finish('run_limit'); break; }
        // No queue removal or scrolling before the persistent commit acknowledgment.
        const sequence = run.nextSequence;
        run = await port.commit(sequence, batch);
        if (run.nextSequence !== sequence + 1) {
          if (run.state !== 'running') break;
          throw new Error('保存応答が不正です');
        }
        for (const p of batch) { queue.delete(p.postId); seen.add(p.postId); }
        idle = 0;
      } else {
        run = await port.heartbeat();
        if (++idle >= 10 && run.state === 'running') { await port.finish('estimated_end'); break; }
      }
      if (run.state !== 'running' || signal.aborted) break;
      if (intervalMs > waited) await port.wait(intervalMs - waited);
      const afterWait = port.guard();
      if (afterWait) { await port.finish(afterWait); break; }
      if (signal.aborted) break;
      if (queue.size === 0) port.scroll();
    }
  } catch {
    try { await port.finish('error'); } catch { /* The last committed batch remains in IndexedDB. */ }
  } finally { disconnect(); }
}
