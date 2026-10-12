import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';
import { markedBackupCount, type CollectionBackup } from './backup';
import { useLibraryDB } from './library-store';
import { useI18n } from './i18n';
import { dateLocale } from './messages';
import { type Account, type Tag, orderedMarks } from './model';
import { Icon } from './icons';

export { postBackupFilename } from './backup-parts';
import { prepareBackupFiles, downloadBackupFile } from './backup-parts';
export function downloadPostBackup(value: CollectionBackup, markName?: string) {
  const files = prepareBackupFiles(value, markName);
  if (files.length === 1) downloadBackupFile(files[0]!);
  return files;
}
export function PostBackupExport({ onExport }: { onExport(markId: string | null): Promise<boolean> }) {
  const db = useLibraryDB();
  const { language, t: tr } = useI18n();
  const [target, setTarget] = useState('all');
  const [marks, setMarks] = useState<Tag[]>([]); const [accounts, setAccounts] = useState<Account[]>([]);
  const [count, setCount] = useState<number | null>(null); const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  useEffect(() => {
    let active = true; setLoading(true); setError(false); setCount(null);
    const subscription = liveQuery(() => db.transaction('r', [db.posts, db.tags, db.postTags, db.settings], async () => {
      const tags = orderedMarks(await db.tags.filter(tag => !!tag.mark).toArray());
      const accounts = ((await db.settings.get('accounts'))?.value ?? []) as Account[];
      const mark = tags.find(tag => target === `mark:${tag.id}`);
      return { tags, accounts, count: target === 'all' ? await db.posts.count() : mark ? await markedBackupCount(mark.id, db) : null };
    })).subscribe({ next: value => { if (active) { setMarks(value.tags); setAccounts(value.accounts); setCount(value.count); setLoading(false); } },
      error: () => { if (active) { setLoading(false); setError(true); } } });
    return () => { active = false; subscription.unsubscribe(); };
  }, [target]);
  const selected = marks.find(mark => target === `mark:${mark.id}`);
  async function exportPosts() {
    if (busy || loading || error || count === null || (target !== 'all' && (!selected || count === 0))) return;
    setBusy(true);
    try { await onExport(target === 'all' ? null : selected!.id); }
    finally { setBusy(false); }
  }
  return <section class="panel post-backup-export" aria-label={tr('投稿のJSONバックアップ')}>
    <h2>{tr('投稿のJSONバックアップ')}</h2>
    <p class="muted">{tr('すべての投稿、または指定したマークの投稿をJSONに書き出します。')}</p>
    <label>{tr('バックアップ対象')}<select aria-label={tr('バックアップ対象')} value={target} disabled={busy || error} onChange={event => { setTarget(event.currentTarget.value); setLoading(true); setCount(null); }}>
      <option value="all">{tr('すべての投稿')}</option>
      {target !== 'all' && !selected && <option value={target} disabled>{tr('対象のマークが見つかりません')}</option>}
      {marks.map(mark => <option key={mark.id} value={`mark:${mark.id}`}>{mark.name} · @{accounts.find(account => account.id === mark.accountId)?.handle ?? tr('別アカウント')}</option>)}
    </select></label>
    <p class="backup-target-count" aria-live="polite">{loading ? tr('確認中…') : count === null ? tr('対象のマークが見つかりません') : tr('{count}件が対象です', { count: count.toLocaleString(dateLocale(language)) })}</p>
    <button class="primary" onClick={exportPosts} disabled={busy || loading || error || count === null || (target !== 'all' && count === 0)}><Icon name="download"/>{busy ? tr('書き出し中…') : target === 'all' ? tr('全件JSONバックアップ') : tr('このマークの投稿をバックアップ')}</button>
    {target !== 'all' && <p class="small muted">{tr('対象投稿に付いた他のマーク・タグと既読、メディア参照も含めます。関係のない投稿や分類は含めません。')}</p>}
    {count === 0 && target !== 'all' && <p class="small muted">{tr('このマークが付いた投稿はありません')}</p>}
    {error && <p class="error" role="alert">{tr('保存データを読み込めません')}</p>}
    <p class="small muted">{tr('表示設定は設定画面から別のJSONに書き出せます。取り込み履歴は含まれません。')}</p>
  </section>;
}
