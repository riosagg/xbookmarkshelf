import { expect, it, vi } from 'vitest';
import { runReader, type ReaderPort } from '../../src/reader';
import { newRun } from '../../src/db';
import { DEFAULT_OPTIONS, type ImportRun, type ObservedPost } from '../../src/model';
import { observation } from './helpers';

function initial() { return newRun({ id: 'test-account', handle: 'sample' }, 1, 'doc', DEFAULT_OPTIONS); }
function port(run: ImportRun): ReaderPort {
  return { observe: () => [], guard: () => null, watch: () => () => {}, commit: async () => run,
    heartbeat: async () => run, finish: async () => {}, scroll: () => {}, wait: async () => {} };
}
it('snapshots new DOM data while awaiting persistence and never scrolls before ACK', async () => {
  const run = initial(); let visible = [observation('1')]; let notify = () => {};
  let acknowledge: ((v: ImportRun) => void) | undefined;
  const batches: string[][] = [];
  const adapter: ReaderPort = { ...port(run), observe: () => visible, watch: collect => { notify = collect; return () => {}; },
    scroll: vi.fn(), commit: async (sequence, posts) => {
      batches.push(posts.map(p => p.postId));
      if (!sequence) return new Promise<ImportRun>(resolve => { acknowledge = resolve; });
      return { ...run, observed: 2, nextSequence: 2, state: 'stopped', reason: 'run_limit' };
    } };
  const work = runReader(run, adapter, new AbortController().signal);
  await Promise.resolve(); // Initial media-settle wait completes before the first save.
  visible = [observation('2')]; notify(); expect(adapter.scroll).not.toHaveBeenCalled();
  acknowledge!({ ...run, observed: 1, nextSequence: 1 }); await work;
  expect(batches).toEqual([['1'], ['2']]); expect(adapter.scroll).not.toHaveBeenCalled();
});
it('stops on a failed save without discarding data by scrolling', async () => {
  const run = initial(); const adapter = { ...port(run), observe: () => [observation()], commit: vi.fn().mockRejectedValue(new Error('quota')), finish: vi.fn(), scroll: vi.fn() };
  await runReader(run, adapter, new AbortController().signal);
  expect(adapter.finish).toHaveBeenCalledWith('error'); expect(adapter.scroll).not.toHaveBeenCalled();
});
it('aborts during the media-settle wait without committing or scrolling', async () => {
  const run = initial(); const controller = new AbortController();
  const adapter = { ...port(run), observe: () => [observation()], commit: vi.fn().mockResolvedValue({ ...run, nextSequence: 1, observed: 1 }), wait: async () => controller.abort(), scroll: vi.fn() };
  await runReader(run, adapter, controller.signal); expect(adapter.commit).not.toHaveBeenCalled(); expect(adapter.scroll).not.toHaveBeenCalled();
});

it('keeps late media and earlier snapshots even when the DOM becomes shorter or disappears before saving', async () => {
  const run = initial();
  const first = { ...observation('1', '先に読み取れた長い本文 https://example.invalid/first'), media: [{ kind: 'image' as const, url: 'https://pbs.twimg.com/media/one?name=small' }] };
  let visible: ObservedPost[] = [first]; let notify = () => {};
  const commit = vi.fn<ReaderPort['commit']>(async () => ({ ...run, nextSequence: 1, observed: 1, state: 'stopped' as const, reason: 'run_limit' as const }));
  const adapter: ReaderPort = { ...port(run), observe: () => visible, watch: collect => { notify = collect; return () => {}; }, commit, scroll: vi.fn(), wait: async ms => {
    expect(ms).toBe(3000);
    visible = [{ ...first, text: '短い https://example.invalid/second', media: [{ kind: 'video', url: 'https://pbs.twimg.com/media/one?name=large' }, { kind: 'image', url: 'https://pbs.twimg.com/media/two.jpg' }], linkCards: [{ url: 'https://example.invalid/second', title: '記事', imageUrl: 'https://pbs.twimg.com/card_img/second.jpg' }] }];
    notify(); visible = [];
  } };
  await runReader(run, adapter, new AbortController().signal);
  expect(commit).toHaveBeenCalledTimes(1);
  const saved = commit.mock.calls[0]![1][0]!;
  expect(saved.text).toBe(first.text + '\nhttps://example.invalid/second');
  expect(saved.media).toEqual([{ kind: 'video', url: first.media[0]!.url }, { kind: 'image', url: 'https://pbs.twimg.com/media/two.jpg' }]);
  expect(saved).toHaveProperty('linkCards'); expect(adapter.scroll).not.toHaveBeenCalled();
});

it('rechecks source scope after settling and stops before saving', async () => {
  const run = initial(); let changed = false;
  const adapter: ReaderPort = { ...port(run), observe: () => [observation()], guard: () => changed ? 'source_scope_changed' : null,
    wait: async () => { changed = true; }, commit: vi.fn(), finish: vi.fn(), scroll: vi.fn() };
  await runReader(run, adapter, new AbortController().signal);
  expect(adapter.finish).toHaveBeenCalledWith('source_scope_changed'); expect(adapter.commit).not.toHaveBeenCalled(); expect(adapter.scroll).not.toHaveBeenCalled();
});

it('retains the configured interval and stops during the remaining wait after an ACK', async () => {
  const run = { ...initial(), intervalMs: 6000 }; const controller = new AbortController();
  const waits: number[] = [];
  const adapter = { ...port(run), observe: () => [observation()], commit: vi.fn().mockResolvedValue({ ...run, nextSequence: 1, observed: 1 }), wait: async (ms: number) => { waits.push(ms); if (waits.length === 2) controller.abort(); }, scroll: vi.fn() };
  await runReader(run, adapter, controller.signal);
  expect(waits).toEqual([3000, 3000]); expect(adapter.commit).toHaveBeenCalledTimes(1); expect(adapter.scroll).not.toHaveBeenCalled();
});
it('reports an estimated end after ten empty observations', async () => {
  const run = initial(); const adapter = { ...port(run), finish: vi.fn(), heartbeat: vi.fn().mockResolvedValue(run) };
  await runReader(run, adapter, new AbortController().signal);
  expect(adapter.heartbeat).toHaveBeenCalledTimes(10); expect(adapter.finish).toHaveBeenCalledWith('estimated_end');
});
it('waits for a top reset to render before collecting legacy full or delta, without adding another wait', async () => {
  for (const mode of ['full', 'delta'] as const) {
    const run = { ...initial(), mode }; let visible = [observation('99')]; let notify = () => {};
    const adapter: ReaderPort = { ...port(run), observe: () => visible,
      watch: collect => { notify = collect; return () => {}; },
      wait: vi.fn(async () => { notify(); visible = [observation('1')]; notify(); }),
      commit: vi.fn<ReaderPort['commit']>(async () => ({ ...run, nextSequence: 1, observed: 1, state: 'stopped' })), scroll: vi.fn() };
    await runReader(run, adapter, new AbortController().signal);
    expect(adapter.wait).toHaveBeenCalledExactlyOnceWith(3000);
    expect(adapter.commit).toHaveBeenCalledWith(0, [expect.objectContaining({ postId: '1' })]);
    expect(adapter.scroll).not.toHaveBeenCalled();
  }
});
it('stops on account/page/visibility restriction before reading', async () => {
  const run = initial(); const adapter = { ...port(run), guard: () => 'account_changed' as const, observe: vi.fn(), finish: vi.fn() };
  await runReader(run, adapter, new AbortController().signal); expect(adapter.observe).not.toHaveBeenCalled(); expect(adapter.finish).toHaveBeenCalledWith('account_changed');
});

it('draws once per cycle, waits before save and only waits the chosen remainder after ACK', async () => {
  const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(1 - Number.EPSILON);
  try {
    const run = { ...initial(), intervalMaxMs: 7000 };
    const events: string[] = []; let visible = 1;
    const adapter: ReaderPort = { ...port(run), observe: () => [observation(String(visible))],
      wait: async ms => { events.push(`wait:${ms}`); }, scroll: () => { events.push('scroll'); visible++; },
      commit: async sequence => { events.push(`ack:${sequence}`); return { ...run, observed: sequence + 1, nextSequence: sequence + 1, state: sequence === 2 ? 'stopped' : 'running' }; } };
    await runReader(run, adapter, new AbortController().signal);
    expect(events).toEqual(['wait:3000', 'ack:0', 'scroll', 'wait:3000', 'ack:1', 'wait:2000', 'scroll', 'wait:3000', 'ack:2']);
    expect(random).toHaveBeenCalledTimes(3);
  } finally { random.mockRestore(); }
});
it('uses random waits for empty cycles and aborts a post-ACK wait before any scroll', async () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(1 - Number.EPSILON);
  try {
    const run = { ...initial(), intervalMaxMs: 8000 }; const empty = port(run); const waits: number[] = [];
    empty.wait = async ms => { waits.push(ms); }; empty.finish = vi.fn();
    await runReader(run, empty, new AbortController().signal);
    expect(waits).toEqual(Array(9).fill(8000)); expect(empty.finish).toHaveBeenCalledWith('estimated_end');
    const controller = new AbortController(); const remaining: number[] = [];
    const adapter: ReaderPort = { ...port(run), observe: () => [observation()], commit: async () => ({ ...run, observed: 1, nextSequence: 1 }),
      wait: async ms => { remaining.push(ms); if (remaining.length === 2) controller.abort(); }, scroll: vi.fn() };
    await runReader(run, adapter, controller.signal);
    expect(remaining).toEqual([3000, 5000]); expect(adapter.scroll).not.toHaveBeenCalled();
  } finally { random.mockRestore(); }
});
