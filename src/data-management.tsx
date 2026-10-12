import { liveQuery } from 'dexie';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLibraryDB } from './library-store';
import { useI18n } from './i18n';
import { dateLocale } from './messages';
import { deletePosts, storageUsage, formatStorageBytes, type DeletionPlan } from './post-data';

export function DataManagement({ onDeleteAll, onBackup, disabled }: {
  onDeleteAll(): void; onBackup(): Promise<boolean>; disabled: boolean;
}) {
  const db = useLibraryDB();
  const { language, t: tr } = useI18n();
  const [count, setCount] = useState<number | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true; let sequence = 0;
    setLoading(true); setError(false);
    const subscription = liveQuery(() => db.transaction('r', db.posts, db.importRuns, async () => ({
      count: await db.posts.count(), running: !!await db.importRuns.where('state').equals('running').count(),
    }))).subscribe({ next: value => {
      const current = ++sequence;
      setCount(value.count); setRunning(value.running);
      void storageUsage().then(bytes => { if (active && current === sequence) { setUsage(bytes); setLoading(false); } });
    }, error: () => { if (active) { setCount(null); setError(true); setLoading(false); } } });
    return () => { active = false; subscription.unsubscribe(); };
  }, [refresh]);
  return <section class="panel data-management" aria-label={tr('投稿データの管理')}>
    <h2>{tr('投稿データの管理')}</h2>
    <p class="muted">{tr(db.source === 'likes' ? 'いいねの投稿データを扱います。' : 'ブックマークの投稿データを扱います。')}</p>
    <dl class="storage-stats"><div><dt>{tr('保存件数（全アカウント）')}</dt><dd data-testid="saved-post-count">{count === null ? '—' : tr('{count}件', { count: count.toLocaleString(dateLocale(language)) })}</dd></div>
      <div><dt>{tr('使用容量（概算）')}</dt><dd data-testid="storage-usage">{loading ? tr('確認中…') : usage === null ? tr('取得できません') : formatStorageBytes(usage, dateLocale(language))}</dd></div></dl>
    <p class="muted">{tr('容量はChromeが報告する、この拡張の保存領域の概算です。削除後の表示に反映されるまで時間がかかる場合があります。')}</p>
    <div class="actions"><button disabled={loading || disabled} onClick={() => setRefresh(n => n + 1)}>{tr('容量を再確認')}</button><button disabled={disabled} onClick={onBackup}>{tr('全件JSONバックアップ')}</button></div>
    {error && <p class="error" role="alert">{tr('保存データを読み込めません')}</p>}
    <div class="delete-all-row"><h3>{tr('投稿データを全削除')}</h3><p class="muted">{tr('全アカウントの投稿と、その既読・マーク・タグの割り当てを削除します。マーク・タグの登録内容と表示設定は残ります。')}</p>
      {running && <p class="muted">{tr('取り込みを停止してから投稿を削除してください')}</p>}
      <button class="danger" disabled={disabled || running || count === null || count === 0} onClick={onDeleteAll}>{tr('投稿データを全削除')}</button>
    </div>
  </section>;
}

export function DeletePostsDialog({ plan, onDeleted, onClose, onBackup }: {
  plan: DeletionPlan; onDeleted(count: number): void; onClose(): void; onBackup(): Promise<boolean>;
}) {
  const db = useLibraryDB();
  const { language, t: tr, message } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [error, setError] = useState('');
  const locked = busy || exporting;
  useEffect(() => { dialog.current?.showModal(); cancel.current?.focus(); }, []);
  async function remove() {
    if (locked) return;
    setBusy(true); setError('');
    try { onDeleted(await deletePosts(plan, db)); }
    catch (e) { setError(e instanceof Error ? e.message : '投稿を削除できませんでした'); }
    finally { setBusy(false); }
  }
  async function backup() {
    setExporting(true); setError('');
    try { if (await onBackup()) setExported(true); else setError('バックアップを書き出せません'); }
    finally { setExporting(false); }
  }
  return <dialog ref={dialog} class="delete-dialog" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description" onClose={onClose} onCancel={event => { if (locked) event.preventDefault(); }}>
    <p class="muted">{tr(db.source === 'likes' ? 'いいねの投稿データを扱います。' : 'ブックマークの投稿データを扱います。')}</p>
    <h2 id="delete-dialog-title">{plan.scope === 'all' ? tr('投稿データを全削除') : tr('選択した投稿を削除')}</h2>
    <p id="delete-dialog-description">{tr(plan.scope === 'all' ? '全アカウントの{count}件の投稿を削除します。' : '選択した{count}件の投稿を削除します。', { count: plan.keys.length.toLocaleString(dateLocale(language)) })}</p>
    <p class="muted">{tr('投稿と、その既読・マーク・タグの割り当ては元に戻せません。必要なら削除前にJSONバックアップを保存してください。')}</p>
    <p class="muted">{tr('マーク・タグの登録内容と表示設定、X側の投稿は変更しません。')}</p>
    <button disabled={locked} onClick={backup}>{exporting ? tr('書き出し中…') : tr('全件JSONバックアップ')}</button>
    {exported && <p class="notice" role="status">{tr('JSONを書き出しました。ダウンロードを確認してから削除してください。')}</p>}
    {error && <p class="error" role="alert">{message(error)}</p>}
    <div class="actions delete-dialog-actions"><button ref={cancel} disabled={locked} onClick={() => dialog.current?.close()}>{tr('キャンセル')}</button><button class="danger" disabled={locked} onClick={remove}>{busy ? tr('削除中…') : tr('削除する')}</button></div>
  </dialog>;
}
