import { useEffect, useId, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { DEFAULT_DECISION, type DecisionConfig, type AiProgress } from './decision';

const labels = {
  title: ['ローカルAIで自動マーク', 'Auto-mark with local AI'], url: ['LM StudioのURL', 'LM Studio URL'], model: ['モデルID', 'Model ID'], threshold: ['マークを付ける基準（%）', 'Match threshold (%)'],
  page: ['自動マーク', 'Auto-mark'], active: ['処理中', 'Running'], target: ['対象の投稿', 'Target posts'], library: ['ライブラリ', 'Library'], scope: ['対象範囲', 'Scope'], count: ['対象の件数', 'Post count'],
  searchScope: ['現在の検索結果', 'Current search results'], searchScopeNote: ['投稿一覧の検索・フィルタで絞り込んだ投稿が対象です。条件を指定していない場合は、選択中のライブラリの全投稿を判定します。', 'Uses all posts matching the search and filters in the post list. Without search or filters, every post in the selected library is included.'],
  accountScopeNote: ['選択したアカウントの保存済み投稿をすべて判定します。', 'Matches all saved posts in the selected account scope.'],
  openSettings: ['接続設定を開く', 'Open connection settings'],
  connection: ['接続先', 'Connection'], criteria: ['判定条件', 'Matching options'],
  thresholdNote: ['AIの判定値がこの数値以上なら、マークを付けます。高くするほど、付与を控えめにします。', 'Adds a mark when its AI match probability meets this threshold. Higher values add fewer marks.'],
  images: ['画像も判定に使う', 'Use images for matching'], imageNote: ['オンにすると、投稿画像や動画の表紙などを1投稿につき最大4枚、Xの画像サーバーから読み込んでLM Studioへ渡します。', 'When enabled, loads up to four images per post, including video covers, from X’s image server and sends them to LM Studio.'],
  previewNote: ['一覧の画像プレビューがオフでも、AIは画像を使って判定します。', 'AI can use images even when display previews are off.'],
  connect: ['接続を確認して保存', 'Connect and save'], connectSession: ['接続を確認して適用', 'Connect and apply'], disconnect: ['接続設定を解除', 'Disconnect'], connecting: ['接続を確認中…', 'Connecting…'],
  connected: ['接続設定済み', 'Connection configured'], note: ['このパソコンのLM Studioに投稿本文とマーク名を送り、内容に合うマークを追加します。', 'Sends post text and mark names to LM Studio on this computer to add matching marks.'],
  session: ['このタブを閉じるか再読み込みすると、AIの設定はリセットされます。次回は接続し直してください。', 'Closing or reloading this tab resets the AI settings. Connect again the next time you open it.'],
  failed: ['接続または分類に失敗しました。URL・モデル・LM StudioのCORS設定・画像取得・分類数の上限を確認してください。', 'Connection or classification failed. Check the URL, model, LM Studio CORS, image access and tag limit.'],
  auto: ['取り込み中に自動マークを付ける', 'Auto-mark during import'], configure: ['設定画面でローカルAIへ接続してください。', 'Connect to local AI in Settings.'],
  all: ['このアカウント範囲を自動マーク', 'Auto-mark this account scope'], local: ['検索結果を自動マーク', 'Auto-mark search results'],
  cancel: ['自動マークを停止', 'Stop auto-marking'], running: ['自動マーク中', 'Auto-marking'], completed: ['自動マーク完了', 'Auto-marking complete'], cancelled: ['自動マークを停止しました', 'Auto-marking stopped'],
  marked: ['該当', 'Matched'], unmatched: ['該当なし', 'No match'], skipped: ['保留', 'Skipped'], errors: ['失敗', 'Failed'], preserve: ['既存マークを保持し、該当するマークだけ追加します。', 'Keeps existing marks and adds matching marks only.'],
} as const;
export type AiLabel = keyof typeof labels;
export const aiText = (language: string, key: AiLabel): string => labels[key][language === 'ja' ? 0 : 1];
export function AiPage({ language, source, scope, total, note, connected, openSettings, children }: { language: string; source: string; scope: ComponentChildren; total: number; note: string; connected: boolean; openSettings(): void; children: ComponentChildren }) {
  const t = (key: AiLabel) => aiText(language, key);
  return <section class="panel ai-page"><h2>{t('target')}</h2><p class="muted">{note}</p>
    <dl class="ai-target"><div><dt>{t('library')}</dt><dd>{source}</dd></div><div><dt>{t('scope')}</dt><dd>{scope}</dd></div><div><dt>{t('count')}</dt><dd>{total.toLocaleString(language === 'ja' ? 'ja-JP' : 'en-US')}</dd></div></dl>
    {!connected && <div class="actions ai-page-links"><button onClick={openSettings}>{t('openSettings')}</button></div>}
    <div class="ai-page-run">{children}</div>
  </section>;
}
export function AiSettings({ language, config, disabled, session = false, connect, disconnect }: { language: string; config: DecisionConfig | null; disabled?: boolean; session?: boolean; connect(value: DecisionConfig): Promise<void>; disconnect(): Promise<void> }) {
  const [form, setForm] = useState({ ...DEFAULT_DECISION }); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const id = useId();
  useEffect(() => { if (config) setForm(config); }, [config?.endpoint, config?.model, config?.threshold, config?.images]);
  const t = (key: AiLabel) => aiText(language, key); const locked = disabled || busy;
  async function perform(action: () => Promise<void>) { if (locked) return; setBusy(true); setError(false); try { await action(); } catch { setError(true); } finally { setBusy(false); } }
  return <section class="panel ai-settings" aria-label={t('title')}><h2>{t('title')}</h2><p class="muted ai-intro">{t('note')}</p>
    <form onSubmit={e => { e.preventDefault(); void perform(() => connect(form)); }}>
      <fieldset class="ai-group"><legend>{t('connection')}</legend><div class="ai-connection-fields">
        <label>{t('url')}<input type="url" required maxLength={200} value={form.endpoint} disabled={locked} onInput={e => setForm({ ...form, endpoint: e.currentTarget.value })}/></label>
        <label>{t('model')}<input required maxLength={200} value={form.model} disabled={locked} onInput={e => setForm({ ...form, model: e.currentTarget.value })}/></label>
      </div></fieldset>
      <fieldset class="ai-group"><legend>{t('criteria')}</legend><div class="ai-threshold">
        <label>{t('threshold')}<input type="number" required min="50" max="100" step="1" aria-describedby={`${id}-threshold`} value={Math.round(form.threshold * 100)} disabled={locked} onInput={e => setForm({ ...form, threshold: Number(e.currentTarget.value) / 100 })}/></label>
        <p class="muted ai-help" id={`${id}-threshold`}>{t('thresholdNote')}</p>
      </div><div class="ai-image-option">
        <label class="switch-label"><input type="checkbox" aria-describedby={`${id}-images`} checked={form.images} disabled={locked} onChange={e => setForm({ ...form, images: e.currentTarget.checked })}/>{t('images')}</label>
        <div class="muted ai-help" id={`${id}-images`}><p>{t('imageNote')}</p><p>{t('previewNote')}</p></div>
      </div></fieldset>
      <div class="ai-settings-footer"><div class="actions"><button class="primary" disabled={locked}>{busy ? t('connecting') : t(session ? 'connectSession' : 'connect')}</button>{config && <button type="button" disabled={locked} onClick={() => void perform(disconnect)}>{t('disconnect')}</button>}</div>
        {config && <div class="ai-connection" role="status"><strong>{t('connected')}</strong><span class="muted">{config.endpoint} · {config.model}</span></div>}
        {session && <p class="muted ai-session">{t('session')}</p>}{error && <p class="error" role="alert">{t('failed')}</p>}
      </div>
    </form>
  </section>;
}
export function AiStatus({ language, progress }: { language: string; progress?: AiProgress | null }) {
  const t = (key: AiLabel) => aiText(language, key);
  if (!progress) return null;
  return <><div class="ai-progress small" role="status"><strong>{t(progress.state)}</strong> · {progress.done} / {progress.total}<br/>{t('marked')} {progress.marked} · {t('unmatched')} {progress.unmatched} · {t('skipped')} {progress.skipped} · {t('errors')} {progress.failed}</div>
    {progress.failed ? <p class="error" role="alert">{t('failed')}</p> : null}
  </>;
}
export function AiControls({ language, config, progress, disabled, label = 'all', start, stop }: { language: string; config: DecisionConfig | null; progress?: AiProgress | null; disabled?: boolean; label?: AiLabel; start(): void; stop(): void }) {
  const t = (key: AiLabel) => aiText(language, key);
  return <div class="ai-controls"><div class="actions"><button class="primary ai-start" disabled={!config || disabled || progress?.state === 'running'} onClick={start}>{t(label)}</button>{progress?.state === 'running' && <button onClick={stop}>{t('cancel')}</button>}</div>
    <p class="small muted">{config ? t('preserve') : t('configure')}</p>
    <AiStatus language={language} progress={progress}/>
  </div>;
}
