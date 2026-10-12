import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

export const POST_WINDOW_SIZE = 50;
const GAP = 16;

function rowAt(offsets: number[], y: number) {
  let lo = 0; let hi = Math.max(0, offsets.length - 2);
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (offsets[mid]! <= y) lo = mid; else hi = mid - 1; }
  return lo;
}

/** Only the nearby records and cards are retained; row heights preserve the scroll position. */
export function usePostFeed({ total, resetKey, columns, layout, previews, ready: contentReady, loadedStart }: {
  total: number; resetKey: string; columns: number; layout: 'grid' | 'list'; previews: boolean; ready: boolean; loadedStart?: number;
}) {
  const container = useRef<HTMLDivElement>(null); const grid = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(0); const ready = contentReady && (loadedStart === undefined || loadedStart === start); const [width, setWidth] = useState(window.innerWidth);
  const [measurements, setMeasurements] = useState<Map<number, number>>(new Map());
  const effectiveColumns = layout === 'list' ? 1 : width <= 760 ? 1 : width <= 1100 ? Math.min(columns, 2) : columns;
  const rows = Math.ceil(total / effectiveColumns);
  const estimate = layout === 'list' ? 260 : previews ? 500 : 330;
  const offsets = useMemo(() => {
    const values = [0]; for (let row = 0; row < rows; row++) values.push(values[row]! + (measurements.get(row) ?? estimate) + GAP);
    return values;
  }, [rows, measurements, estimate]);
  const firstRow = Math.floor(start / effectiveColumns);
  const count = Math.min(POST_WINDOW_SIZE, Math.max(0, total - start));
  const endRow = Math.min(rows, Math.ceil((start + count) / effectiveColumns));
  const top = offsets[firstRow] ?? 0; const bottom = Math.max(0, offsets[rows]! - (offsets[endRow] ?? 0));
  const pendingAnchor = useRef(0);

  useLayoutEffect(() => {
    const resize = () => setWidth(window.innerWidth); window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useLayoutEffect(() => {
    setMeasurements(new Map()); setStart(0);
    window.scrollTo({ top: 0 });
  }, [resetKey, effectiveColumns, layout, previews]);
  useLayoutEffect(() => {
    if (start >= total && start) setStart(Math.max(0, Math.ceil((total - POST_WINDOW_SIZE) / effectiveColumns)) * effectiveColumns);
  }, [total, start, effectiveColumns]);
  useLayoutEffect(() => {
    if (pendingAnchor.current) { const delta = pendingAnchor.current; pendingAnchor.current = 0; window.scrollBy(0, delta); }
  }, [offsets]);
  useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      const element = container.current; if (!element || !total) return;
      const y = Math.max(0, -element.getBoundingClientRect().top + 80);
      const row = rowAt(offsets, y);
      // Keep overlapping cards mounted while the reader moves through a window.
      if (row >= firstRow + 3 && row < endRow - 5 || firstRow === 0 && row < endRow - 5 || start + count >= total && row >= firstRow + 3) return;
      const maxStartRow = Math.max(0, Math.ceil((total - POST_WINDOW_SIZE) / effectiveColumns));
      const next = Math.min(maxStartRow, Math.max(0, row - 4)) * effectiveColumns;
      if (next !== start) {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && grid.current?.contains(focused)) element.focus({ preventScroll: true });
        setStart(next);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); }); };
    window.addEventListener('scroll', schedule, { passive: true }); schedule();
    return () => { window.removeEventListener('scroll', schedule); cancelAnimationFrame(frame); };
  }, [offsets, total, start, count, firstRow, endRow, effectiveColumns]);
  useLayoutEffect(() => {
    const element = grid.current; if (!element || !ready) return;
    const measure = () => {
      const cards = [...element.children] as HTMLElement[];
      const heights = new Map<number, number>();
      for (let index = 0; index < cards.length; index++) {
        const row = Math.floor(index / effectiveColumns) + firstRow;
        // A partial trailing grid row may have taller cards outside this window.
        if ((row + 1) * effectiveColumns > start + count && start + count < total) continue;
        heights.set(row, Math.max(heights.get(row) ?? 0, cards[index]!.getBoundingClientRect().height));
      }
      if (![...heights].some(([row, height]) => Math.abs((measurements.get(row) ?? estimate) - height) > 1)) return;
      const anchor = rowAt(offsets, Math.max(0, -(container.current?.getBoundingClientRect().top ?? 0) + 80));
      let delta = 0;
      for (const [row, height] of heights) if (row < anchor) delta += height - (measurements.get(row) ?? estimate);
      pendingAnchor.current += delta;
      setMeasurements(old => { const next = new Map(old); for (const pair of heights) next.set(...pair); return next; });
    };
    measure(); let frame = 0;
    const observer = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); });
    for (const card of element.children) observer.observe(card);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  });
  return { start, count, top, bottom, height: Math.max(0, (offsets[endRow] ?? 0) - top - GAP), container, grid, columns, layout, ready };
}

export function PostFeed({ feed, children, loading }: { feed: ReturnType<typeof usePostFeed>; children: ComponentChildren; loading: string }) {
  return <div class="post-feed" ref={feed.container} tabIndex={-1} data-start={feed.start} aria-busy={!feed.ready}>
    <div class="feed-spacer" aria-hidden="true" style={{ height: `${feed.top}px` }}/>
    <div ref={feed.grid} class={`card-grid ${feed.layout === 'list' ? 'view-list' : ''}`} style={{ '--columns': feed.columns, minHeight: feed.ready ? undefined : `${feed.height}px` }}>
      {feed.ready ? children : <p class="muted" role="status">{loading}</p>}
    </div>
    <div class="feed-spacer" aria-hidden="true" style={{ height: `${feed.bottom}px` }}/>
  </div>;
}
