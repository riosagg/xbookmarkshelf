import { useI18n } from './i18n';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';
import type { Tag } from './model';

export function PostMarks({ marks, selected, disabled, onToggle }: {
  marks: Tag[]; selected: Tag[]; disabled: boolean; onToggle(tag: Tag): Promise<void>;
}) {
  const { t: tr } = useI18n();
  const row = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null); const searchInput = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const [slots, setSlots] = useState(1); const [open, setOpen] = useState(false); const [search, setSearch] = useState('');
  const selectedIds = new Set(selected.map(t => t.id));
  const directCount = marks.length <= slots ? marks.length : Math.max(0, slots - 1);
  const overflowSelected = marks.slice(directCount).filter(t => selectedIds.has(t.id)).length;
  const needle = search.normalize('NFKC').toLocaleLowerCase();
  const candidates = open ? marks.filter(t => t.name.normalize('NFKC').toLocaleLowerCase().includes(needle)) : [];

  useLayoutEffect(() => {
    const element = row.current; if (!element) return;
    const measure = () => setSlots(Math.max(1, Math.min(7, Math.floor((element.clientWidth + 5) / 32))));
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open || !picker.current) return;
    const element = picker.current;
    const onClose = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'closed') return;
      const focusInside = element.contains(document.activeElement) || document.activeElement === document.body;
      setOpen(false); setSearch(''); if (focusInside) trigger.current?.focus();
    };
    element.addEventListener('toggle', onClose);
    element.showPopover();
    const position = () => {
      const anchor = trigger.current?.getBoundingClientRect(); if (!anchor) return;
      const size = element.getBoundingClientRect();
      element.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - size.width - 12))}px`;
      const below = anchor.bottom + 6;
      element.style.top = `${Math.max(12, Math.min(below + size.height <= innerHeight - 12 ? below : anchor.top - size.height - 6, innerHeight - size.height - 12))}px`;
    };
    position(); const observer = new ResizeObserver(position); observer.observe(element);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    searchInput.current?.focus();
    return () => { observer.disconnect(); element.removeEventListener('toggle', onClose); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);

  return <div ref={row} class="quick-marks" aria-label={tr("投稿のマーク")}>
    {marks.slice(0, directCount).map(tag => <button class="quick-mark" key={tag.id} data-symbol={tag.mark} aria-label={tr('{name}のマーク', { name: tag.name })} title={tr('{name} · クリックで付与／解除', { name: tag.name })} aria-pressed={selectedIds.has(tag.id)} disabled={disabled} onClick={() => onToggle(tag)}><Icon name={tag.mark!}/></button>)}
    {directCount < marks.length && <button ref={trigger} class="quick-mark mark-overflow" aria-label={tr("その他のマーク")} aria-haspopup="dialog" aria-expanded={open} data-marked={overflowSelected > 0} title={overflowSelected ? tr('その他のマーク · {count}個を付与済み', { count: overflowSelected }) : tr("その他のマークを選ぶ")} disabled={disabled} onClick={() => { setSearch(''); setOpen(true); }}><Icon name="ellipsis"/></button>}
    {open && <div ref={picker} class="mark-picker" popover="auto" role="dialog" aria-label={tr("マークを選択")}>
      <div class="mark-picker-heading"><strong>{tr("マークを選択")}</strong><button class="icon-button" aria-label={tr("マーク選択を閉じる")} onClick={() => picker.current?.hidePopover()}><Icon name="close"/></button></div>
      <label class="sr-only" for={searchId}>{tr("マーク名で検索")}</label><input id={searchId} ref={searchInput} type="search" aria-label={tr("マーク名で検索")} placeholder={tr("マーク名で検索")} value={search} maxLength={100} onInput={event => setSearch(event.currentTarget.value)}/>
      <div class="mark-picker-options">{candidates.map(tag => <button class="mark-picker-option" key={tag.id} data-symbol={tag.mark} title={tag.name} aria-label={tr('{name}のマーク', { name: tag.name })} aria-pressed={selectedIds.has(tag.id)} disabled={disabled} onClick={() => onToggle(tag)}><Icon name={tag.mark!}/><span>{tag.name}</span>{selectedIds.has(tag.id) && <Icon name="check"/>}</button>)}</div>
      {!candidates.length && <p class="small muted">{tr("一致するマークがありません")}</p>}
    </div>}
  </div>;
}
