import { useI18n } from './i18n';
import { useLibraryDB } from './library-store';
import type { MessageKey } from './messages';
import { useState } from 'preact/hooks';
import { type Account, type Tag, type MarkSymbol, MARK_SYMBOLS, MAX_MARKS, orderedMarks } from './model';
import { saveMark, removeMark, moveMark } from './marks';
import { Icon } from './icons';

export const MARK_LABELS: Record<MarkSymbol, MessageKey> = { star: 'スター', flag: '旗', heart: 'ハート', bolt: '稲妻', book: '本', bulb: '電球', code: 'コード', check: 'チェック', pin: 'ピン', bookmark: 'しおり', folder: 'フォルダー', briefcase: '仕事', home: '家', globe: '地球', link: 'リンク', music: '音楽', film: '映画', camera: 'カメラ', headphones: 'ヘッドホン', palette: 'パレット', flask: '実験', graduation: '学習', terminal: 'ターミナル', bug: 'バグ', shield: '盾', clock: '時計', calendar: 'カレンダー', coffee: 'コーヒー', rocket: 'ロケット', archive: '保管箱' };
export function MarkManager({ accounts, tags, selectedAccount, onChange, onOpen }: {
  accounts: Account[]; tags: Tag[]; selectedAccount: string; onChange(): void; onOpen(id: string): void;
}) {
  const db = useLibraryDB();
  const { t: tr, message } = useI18n();
  const [account, setAccount] = useState(selectedAccount || accounts[0]?.id || '');
  const [name, setName] = useState(''); const [symbol, setSymbol] = useState<MarkSymbol>('star');
  const [editingId, setEditingId] = useState<string>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const target = account || accounts[0]?.id || '';
  const ownTags = tags.filter(t => t.accountId === target); const marks = orderedMarks(ownTags);
  function reset() { setEditingId(undefined); setName(''); setSymbol('star'); setError(''); }
  async function save(event: Event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { await saveMark(target, name, symbol, editingId, db); reset(); setNotice('マークを保存しました'); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'マークを保存できません'); }
    finally { setBusy(false); }
  }
  async function unmark(tag: Tag) {
    setBusy(true); setError(''); setNotice('');
    try { await removeMark(tag.id, db); if (editingId === tag.id) reset(); setNotice('通常のタグに戻しました。投稿との関連は保持しています。'); onChange(); }
    catch { setError('マークを変更できません'); }
    finally { setBusy(false); }
  }
  async function move(tag: Tag, direction: 'up' | 'down') {
    setBusy(true); setError(''); setNotice('');
    try { await moveMark(target, tag.id, direction, db); onChange(); setNotice('マークの順番を保存しました'); }
    catch (e) { setError(e instanceof Error ? e.message : '順番を保存できません'); }
    finally { setBusy(false); }
  }
  return <section class="panel mark-manager">
    <div class="section-heading"><div><h2>{tr("名前付きマーク")}</h2><p class="muted">{tr('1アカウントにつき{count}個まで。上下ボタンで、投稿とサイドバーの表示順を変えられます。', { count: MAX_MARKS })}</p></div><span class="mark-count">{marks.length} / {MAX_MARKS}</span></div>
    <label>{tr("マークを管理するアカウント")}<select aria-label={tr("マークを管理するアカウント")} value={target} disabled={busy} onChange={e => { setAccount(e.currentTarget.value); reset(); setNotice(''); }}>{accounts.map(a => <option key={a.id} value={a.id}>@{a.handle}</option>)}</select></label>
    {!accounts.length ? <p class="muted">{tr("投稿を取り込むとマークを作れます。")}</p> : <>
      <div class="mark-directory">{marks.map((tag, index) => <div class="mark-item" key={tag.id}><button class="mark-open" onClick={() => onOpen(tag.id)} title={tag.name}><Icon name={tag.mark!}/><strong>{tag.name}</strong></button><div class="actions"><button class="icon-button move-up" aria-label={tr('{name}を上へ', { name: tag.name })} title={tr("上へ移動")} disabled={busy || index === 0} onClick={() => move(tag, 'up')}><Icon name="chevron"/></button><button class="icon-button move-down" aria-label={tr('{name}を下へ', { name: tag.name })} title={tr("下へ移動")} disabled={busy || index === marks.length - 1} onClick={() => move(tag, 'down')}><Icon name="chevron"/></button><button class="small-button" aria-label={tr('{name}のマークを編集', { name: tag.name })} disabled={busy} onClick={() => { setEditingId(tag.id); setName(tag.name); setSymbol(tag.mark!); setNotice(''); setError(''); }}>{tr("編集")}</button><button class="text-button" aria-label={tr('{name}を通常のタグに戻す', { name: tag.name })} disabled={busy} onClick={() => unmark(tag)}>{tr("タグに戻す")}</button></div></div>)}</div>
      <form class="mark-form" onSubmit={save}>
        <h3>{editingId ? tr("マークを編集") : tr("マークを登録")}</h3>
        <label>{tr("マークの名前")}<input value={name} maxLength={100} required disabled={busy} placeholder={tr("例：資料、仕事、見返したい")} onInput={e => setName(e.currentTarget.value)}/></label>
        <fieldset class="symbol-field"><legend>{tr("マークのアイコン")}</legend><div class="symbol-options">{MARK_SYMBOLS.map(value => <button type="button" class="symbol-option" key={value} aria-label={tr('{symbol}のアイコン', { symbol: tr(MARK_LABELS[value]) })} title={tr(MARK_LABELS[value])} aria-pressed={symbol === value} disabled={busy} onClick={() => setSymbol(value)}><Icon name={value}/></button>)}</div></fieldset>
        <div class="actions"><button class="primary" disabled={busy || (!editingId && marks.length >= MAX_MARKS)}>{busy ? tr("保存中…") : tr("マークを保存")}</button>{editingId && <button type="button" disabled={busy} onClick={reset}>{tr("キャンセル")}</button>}</div>
        {!editingId && marks.length >= MAX_MARKS && <p class="small muted">{tr("登録済みマークを編集するか、通常のタグに戻すと追加できます。")}</p>}
        {!editingId && ownTags.some(t => !t.mark) && <div class="existing-mark-tags"><span class="small muted">{tr("既存タグをマークにする")}</span><div class="tag-options">{ownTags.filter(t => !t.mark).slice(0, 100).map(tag => <button type="button" class="tag-option" key={tag.id} disabled={busy} title={tag.name} onClick={() => setName(tag.name)}>{tag.name}</button>)}</div></div>}
      </form>
    </>}
    {error && <p class="error" role="alert">{message(error)}</p>}{notice && <p class="notice" role="status">{message(notice)}</p>}
  </section>;
}
