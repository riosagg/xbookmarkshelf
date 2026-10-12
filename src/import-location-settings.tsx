import { liveQuery } from 'dexie';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from './i18n';
import { type ImportLocations } from './model';
import { DEFAULT_IMPORT_LOCATIONS, IMPORT_URL_MAX_LENGTH } from './import-locations';
import { loadImportLocations, saveImportLocations } from './import-locations-store';

export function useImportLocations() {
  const [locations, setLocations] = useState<ImportLocations>({ ...DEFAULT_IMPORT_LOCATIONS });
  const [ready, setReady] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    const subscription = liveQuery(() => loadImportLocations()).subscribe({
      next: value => { setLocations(value); setReady(true); setError(''); },
      error: () => { setReady(false); setError('取得先URLを読み込めません'); },
    });
    return () => subscription.unsubscribe();
  }, []);
  return { locations, ready, error };
}

export function ImportLocationSettings({ disabled = false }: { disabled?: boolean }) {
  const { t: tr, message } = useI18n();
  const { locations, ready, error: loadError } = useImportLocations();
  const [form, setForm] = useState<ImportLocations>({ ...DEFAULT_IMPORT_LOCATIONS });
  const dirty = useRef(false); const saving = useRef(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => { if (!dirty.current) setForm(locations); }, [locations]);
  function edit(source: keyof ImportLocations, value: string) {
    dirty.current = true; setForm(current => ({ ...current, [source]: value })); setError(''); setNotice('');
  }
  async function save(value: ImportLocations) {
    if (!ready || disabled || saving.current) return;
    saving.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const saved = await saveImportLocations(value);
      dirty.current = false; setForm(saved); setNotice('取得先URLを保存しました');
    } catch (e) { setError(e instanceof Error ? e.message : '取得先URLを保存できません'); }
    finally { saving.current = false; setBusy(false); }
  }
  const locked = !ready || busy || disabled;
  return <section class="panel" aria-labelledby="import-locations-title">
    <h2 id="import-locations-title">{tr('取得先URL')}</h2>
    <p class="muted">{tr('Xの一覧ページのURLが変わったときに変更します。通常は変更不要です。')}</p>
    <form class="import-locations-form" onSubmit={e => { e.preventDefault(); void save(form); }}>
      <label>{tr('ブックマークの取得先URL')}<input type="url" required maxLength={IMPORT_URL_MAX_LENGTH} value={form.bookmarks} disabled={locked} spellcheck={false} onInput={e => edit('bookmarks', e.currentTarget.value)}/></label>
      <label>{tr('いいねの取得先URL')}<input type="url" required maxLength={IMPORT_URL_MAX_LENGTH} value={form.likes} disabled={locked} spellcheck={false} onInput={e => edit('likes', e.currentTarget.value)}/></label>
      <div class="actions"><button class="primary" type="submit" disabled={locked}>{tr('URLを保存')}</button><button type="button" disabled={locked} onClick={() => { void save({ ...DEFAULT_IMPORT_LOCATIONS }); }}>{tr('初期URLに戻す')}</button></div>
    </form>
    <p class="small muted">{tr('HTTPSのx.comのみ対応。画面構造の変更にはコードの更新が必要です。取り込み中の実行には開始時のURL設定を使います。')}</p>
    <p class="small muted">{tr('取得先URLは、このブラウザに保存します。設定JSONには含まれません。')}</p>
    {(error || loadError) && <p class="error" role="alert">{message(error || loadError)}</p>}
    {notice && <p class="notice" role="status">{message(notice)}</p>}
  </section>;
}
