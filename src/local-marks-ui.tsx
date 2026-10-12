import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';
import { orderedMarks, MARK_SYMBOLS, type Tag, type MarkSymbol } from './model';
import { saveLocalMark, moveLocalMark, demoteLocalMark, type LocalLibrary, type LocalSource } from './local-data';
import type { LocalTranslate } from './local-messages';
import type { ViewerPost } from './viewer-data';

export function LocalQuickMarks({ marks, post, tr, disabled, toggle }: { marks: Tag[]; post: ViewerPost; tr: LocalTranslate; disabled: boolean; toggle(id: string): void }) {
  const row = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null); const popup = useRef<HTMLDivElement>(null); const searchInput = useRef<HTMLInputElement>(null);
  const [slots, setSlots] = useState(1); const [open, setOpen] = useState(false); const [search, setSearch] = useState('');
  const selected = new Set(post.tags.map(t => t.id)); const direct = marks.length <= slots ? marks.length : Math.max(0, slots - 1);
  useLayoutEffect(() => { const element = row.current; if (!element) return;
    const measure = () => setSlots(Math.max(1, Math.min(7, Math.floor((element.clientWidth + 5) / 32)))); measure();
    const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open || !popup.current) return; const element = popup.current;
    const close = (e: Event) => { if ((e as ToggleEvent).newState === 'closed') { setOpen(false); setSearch(''); if (document.activeElement === document.body || element.contains(document.activeElement)) trigger.current?.focus(); } };
    const position = () => { const anchor = trigger.current?.getBoundingClientRect(); if (!anchor) return; const size = element.getBoundingClientRect();
      element.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - size.width - 12))}px`;
      element.style.top = `${Math.max(12, Math.min(anchor.bottom + size.height + 6 < innerHeight ? anchor.bottom + 6 : anchor.top - size.height - 6, innerHeight - size.height - 12))}px`;
    };
    element.addEventListener('toggle', close); element.showPopover(); position(); searchInput.current?.focus();
    const observer = new ResizeObserver(position); observer.observe(element); window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { observer.disconnect(); element.removeEventListener('toggle', close); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  const options = open ? marks.filter(t => t.name.normalize('NFKC').toLowerCase().includes(search.normalize('NFKC').toLowerCase())) : [];
  const button = (t: Tag) => <button key={t.id} class="quick-mark" title={`${t.name} · ${tr('toggleHint')}`} aria-label={`${t.name}${tr('markSuffix')}`} aria-pressed={selected.has(t.id)} disabled={disabled} onClick={() => toggle(t.id)}><Icon name={t.mark!}/></button>;
  return <div ref={row} class="quick-marks">{marks.slice(0, direct).map(button)}
    {direct < marks.length && <button ref={trigger} class="quick-mark mark-overflow" aria-label={tr('moreMarks')} aria-expanded={open} aria-haspopup="dialog" data-marked={marks.slice(direct).some(t => selected.has(t.id))} disabled={disabled} onClick={() => setOpen(true)}><Icon name="ellipsis"/></button>}
    {open && <div ref={popup} class="mark-picker" popover="auto" role="dialog" aria-label={tr('selectMark')}><div class="mark-picker-heading"><strong>{tr('selectMark')}</strong><button class="icon-button" aria-label={tr('closeDetail')} onClick={() => popup.current?.hidePopover()}><Icon name="close"/></button></div>
      <input ref={searchInput} type="search" aria-label={tr('searchMarks')} placeholder={tr('searchMarks')} value={search} maxLength={100} onInput={e => setSearch(e.currentTarget.value)}/>
      <div class="mark-picker-options">{options.map(t => <button key={t.id} class="mark-picker-option" aria-label={`${t.name}${tr('markSuffix')}`} aria-pressed={selected.has(t.id)} disabled={disabled} title={t.name} onClick={() => toggle(t.id)}><Icon name={t.mark!}/><span>{t.name}</span>{selected.has(t.id) && <Icon name="check"/>}</button>)}</div>
    </div>}
  </div>;
}
export function LocalMarkManager({ lib, source, selectedAccount, tr, symbolLabel, disabled, change, open }: { lib: LocalLibrary; source: LocalSource; selectedAccount: string; tr: LocalTranslate; symbolLabel(symbol: MarkSymbol): string; disabled: boolean; change(action: () => LocalLibrary): boolean; open(id: string): void }) {
  const c = lib.libraries[source]; const [account, setAccount] = useState(selectedAccount || c.accounts[0]?.id || '');
  const [name, setName] = useState(''); const [symbol, setSymbol] = useState<MarkSymbol>('star'); const [editing, setEditing] = useState<string>();
  const own = c.tags.filter(t => t.accountId === account); const marks = orderedMarks(own);
  function reset() { setEditing(undefined); setName(''); setSymbol('star'); }
  return <section class="panel mark-manager"><div class="section-heading"><div><h1>{tr('manageMarks')}</h1><p class="muted">{tr('markLimit')}</p></div><span class="mark-count">{marks.length} / 30</span></div>
    <label>{tr('markAccount')}<select aria-label={tr('markAccount')} value={account} disabled={disabled} onChange={e => { setAccount(e.currentTarget.value); reset(); }}>{c.accounts.map(a => <option key={a.id} value={a.id}>{a.handle ? `@${a.handle}` : tr('likesAccount')}</option>)}</select></label>
    {!c.accounts.length ? <p>{tr('noAccount')}</p> : <><div class="mark-directory">{marks.map((t, i) => <div class="mark-item" key={t.id}><button class="mark-open" title={t.name} onClick={() => open(t.id)}><Icon name={t.mark!}/><strong>{t.name}</strong></button><div class="actions">
      <button class="icon-button move-up" aria-label={`${t.name} · ${tr('up')}`} disabled={disabled || i === 0} onClick={() => change(() => moveLocalMark(lib, source, account, t.id, -1))}><Icon name="chevron"/></button>
      <button class="icon-button move-down" aria-label={`${t.name} · ${tr('down')}`} disabled={disabled || i === marks.length - 1} onClick={() => change(() => moveLocalMark(lib, source, account, t.id, 1))}><Icon name="chevron"/></button>
      <button disabled={disabled} aria-label={`${t.name} · ${tr('edit')}`} onClick={() => { setEditing(t.id); setName(t.name); setSymbol(t.mark!); }}>{tr('edit')}</button>
      <button class="text-button" disabled={disabled} aria-label={`${t.name} · ${tr('demote')}`} onClick={() => { if (change(() => demoteLocalMark(lib, source, t.id)) && editing === t.id) reset(); }}>{tr('demote')}</button>
    </div></div>)}</div>
    <form class="mark-form" onSubmit={e => { e.preventDefault(); if (change(() => saveLocalMark(lib, source, account, name, symbol, editing))) reset(); }}>
      <h2>{tr(editing ? 'editMark' : 'createMark')}</h2><label>{tr('markName')}<input aria-label={tr('markName')} value={name} maxLength={100} required disabled={disabled} onInput={e => setName(e.currentTarget.value)}/></label>
      <fieldset class="symbol-field"><legend>{tr('markIcon')}</legend><div class="symbol-options">{MARK_SYMBOLS.map(s => <button key={s} type="button" class="symbol-option" title={symbolLabel(s)} aria-label={symbolLabel(s)} aria-pressed={symbol === s} disabled={disabled} onClick={() => setSymbol(s)}><Icon name={s}/></button>)}</div></fieldset>
      <div class="actions"><button class="primary" disabled={disabled || (!editing && marks.length >= 30)}>{tr('saveMark')}</button>{editing && <button type="button" disabled={disabled} onClick={reset}>{tr('cancel')}</button>}</div>
      <div class="tag-options">{own.filter(t => !t.mark).slice(0, 100).map(t => <button type="button" key={t.id} class="tag-option" title={t.name} disabled={disabled} onClick={() => setName(t.name)}>{t.name}</button>)}</div>
    </form></>}
  </section>;
}
