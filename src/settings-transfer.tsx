import { useI18n } from './i18n';
import { useRef, useState } from 'preact/hooks';
import { createSettingsBackup, readSettingsFile, restoreSettingsBackup, type DisplaySettings, type SettingsBackup } from './settings-backup';
import { Icon } from './icons';

export function SettingsTransfer({ onApplied, onBusyChange }: { onApplied(settings: DisplaySettings): void; onBusyChange(busy: boolean): void }) {
  const { t: tr, message } = useI18n();
  const [pending, setPending] = useState<SettingsBackup | null>(null);
  const [busy, setBusy] = useState(false); const [checking, setChecking] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const fileRevision = useRef(0);
  async function exportSettings() {
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await createSettingsBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `xbookmarkshelf-settings-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000); setNotice('設定だけをJSONに書き出しました。');
    } catch { setError('設定を書き出せませんでした。'); }
    finally { setBusy(false); }
  }
  async function chooseSettings(file?: File) {
    const revision = ++fileRevision.current;
    setPending(null); setError(''); setNotice(''); if (!file) { setChecking(false); return; }
    setChecking(true);
    try {
      const value = await readSettingsFile(file);
      if (revision === fileRevision.current) setPending(value);
    } catch (e) { if (revision === fileRevision.current) setError(e instanceof Error ? e.message : '設定ファイルを検証できませんでした。'); }
    finally { if (revision === fileRevision.current) setChecking(false); }
  }
  async function applySettings() {
    if (!pending || busy) return;
    setBusy(true); onBusyChange(true); setError(''); setNotice('');
    try {
      const settings = await restoreSettingsBackup(pending);
      onApplied(settings); setPending(null); setNotice('設定を適用しました。');
    } catch { setError('設定を適用できませんでした。もう一度お試しください。'); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section class="panel settings-transfer" aria-label={tr("設定ファイル")}>
    <h2>{tr("設定ファイル")}</h2>
    <p class="muted">{tr("言語・テーマ・列数・カード／リスト表示・画像プレビューを、設定だけのJSONに書き出します。")}</p>
    <button class="primary" onClick={exportSettings} disabled={busy || checking}><Icon name="download"/>{tr("設定をエクスポート")}</button>
    <p class="small muted">{tr("投稿・既読・マーク・タグは含みません。")}</p>
    <div class="settings-import">
      <h3>{tr("設定をインポート")}</h3>
      <p class="muted">{tr("設定ファイルを選び、内容を確認してから適用します。")}</p>
      <label>{tr("設定JSONを選択")}<input type="file" accept=".json,application/json" disabled={busy || checking} onChange={e => { void chooseSettings(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }}/></label>
      <p class="small muted">{tr("設定専用のJSON形式に対応。ファイルは64KBまでです。")}</p>
      {pending && <div class="restore-preview">
        <strong>{tr("適用する設定")}</strong>
        <dl class="settings-preview"><div><dt>{tr("言語")}</dt><dd>{pending.settings.language === undefined ? tr('変更しない（旧ファイル）') : pending.settings.language === 'system' ? tr('システムに従う') : pending.settings.language === 'en' ? 'English' : tr("日本語")}</dd></div>
          <div><dt>{tr("テーマ")}</dt><dd>{pending.settings.theme === 'dark' ? tr("ダーク") : tr("ライト")}</dd></div>
          <div><dt>{tr("列数")}</dt><dd>{tr('{count}列', { count: pending.settings.columns })}</dd></div>
          <div><dt>{tr("表示形式")}</dt><dd>{pending.settings.layout === 'list' ? tr("リスト") : tr("カード")}</dd></div>
          <div><dt>{tr("画像プレビュー")}</dt><dd>{pending.settings.previews ? tr("オン") : tr("オフ")}</dd></div>
        </dl>
        <p class="small muted">{tr("表示設定を上書きします。投稿や分類はそのまま残ります。")}</p>
        {pending.settings.previews && <p class="small muted">{tr("適用すると、投稿画像とサムネイルの表示時にXの画像サーバー（pbs.twimg.com）へ接続します。")}</p>}
        <div class="actions"><button class="primary" onClick={applySettings} disabled={busy}>{busy ? tr("適用中…") : tr("この設定を適用")}</button><button onClick={() => { setPending(null); setError(''); }} disabled={busy}>{tr("キャンセル")}</button></div>
      </div>}
    </div>
    {error && <p class="error" role="alert">{message(error)}</p>}{notice && <p class="notice" role="status">{message(notice)}</p>}
  </section>;
}
