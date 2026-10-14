import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_DECISION, type DecisionConfig, type AiProgress } from './decision';

const labels = {
  title: ['ローカルAIで自動マーク', 'Auto-mark with local AI'], url: ['LM StudioのURL', 'LM Studio URL'], model: ['モデルID', 'Model ID'], threshold: ['付与する最低確率（%）', 'Minimum match probability (%)'],
  images: ['画像もAIへ渡す', 'Include images for AI'], connect: ['接続を確認して保存', 'Connect and save'], disconnect: ['接続設定を解除', 'Disconnect'], connecting: ['接続を確認中…', 'Connecting…'],
  connected: ['接続設定済み', 'Connection configured'], note: ['投稿本文とマーク名を、この端末のLM Studioへ送ります。画像を使う場合はpbs.twimg.comから最大4枚を読み込みます。画面のプレビュー設定とは別の選択です。', 'Sends post text and mark names to LM Studio on this computer. Images are loaded from pbs.twimg.com, up to four per post. This choice is separate from display previews.'],
  session: ['接続設定はこの画面を開いている間だけ保持します。', 'Connection settings last only while this app is open.'],
  failed: ['接続または分類に失敗しました。URL・モデル・LM StudioのCORS設定・画像取得・分類数の上限を確認してください。', 'Connection or classification failed. Check the URL, model, LM Studio CORS, image access and tag limit.'],
  auto: ['取り込み中に自動マークを付ける', 'Auto-mark during import'], configure: ['設定画面でローカルAIへ接続してください。', 'Connect to local AI in Settings.'],
  all: ['このアカウント範囲を自動マーク', 'Auto-mark this account scope'], recent: ['今回取り込んだ投稿を自動マーク', 'Auto-mark this import'], local: ['検索結果を自動マーク', 'Auto-mark search results'],
  cancel: ['自動マークを停止', 'Stop auto-marking'], running: ['自動マーク中', 'Auto-marking'], completed: ['自動マーク完了', 'Auto-marking complete'], cancelled: ['自動マークを停止しました', 'Auto-marking stopped'],
  marked: ['該当', 'Matched'], unmatched: ['該当なし', 'No match'], skipped: ['保留', 'Skipped'], errors: ['失敗', 'Failed'], preserve: ['既存マークを保持し、該当するマークだけ追加します。', 'Keeps existing marks and adds matching marks only.'],
} as const;
export type AiLabel = keyof typeof labels;
export const aiText = (language: string, key: AiLabel): string => labels[key][language === 'ja' ? 0 : 1];
export function AiSettings({ language, config, disabled, session = false, connect, disconnect }: { language: string; config: DecisionConfig | null; disabled?: boolean; session?: boolean; connect(value: DecisionConfig): Promise<void>; disconnect(): Promise<void> }) {
  const [form, setForm] = useState({ ...DEFAULT_DECISION }); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  useEffect(() => { if (config) setForm(config); }, [config?.endpoint, config?.model, config?.threshold, config?.images]);
  const t = (key: AiLabel) => aiText(language, key); const locked = disabled || busy;
  async function perform(action: () => Promise<void>) { if (locked) return; setBusy(true); setError(false); try { await action(); } catch { setError(true); } finally { setBusy(false); } }
  return <section class="panel ai-settings" aria-label={t('title')}><h2>{t('title')}</h2><p class="small muted">{t('note')}</p>
    <form onSubmit={e => { e.preventDefault(); void perform(() => connect(form)); }}>
      <label>{t('url')}<input type="url" required maxLength={200} value={form.endpoint} disabled={locked} onInput={e => setForm({ ...form, endpoint: e.currentTarget.value })}/></label>
      <label>{t('model')}<input required maxLength={200} value={form.model} disabled={locked} onInput={e => setForm({ ...form, model: e.currentTarget.value })}/></label>
      <label>{t('threshold')}<input type="number" required min="50" max="100" step="1" value={Math.round(form.threshold * 100)} disabled={locked} onInput={e => setForm({ ...form, threshold: Number(e.currentTarget.value) / 100 })}/></label>
      <label class="switch-label"><input type="checkbox" checked={form.images} disabled={locked} onChange={e => setForm({ ...form, images: e.currentTarget.checked })}/>{t('images')}</label>
      <div class="actions"><button class="primary" disabled={locked}>{busy ? t('connecting') : t('connect')}</button>{config && <button type="button" disabled={locked} onClick={() => void perform(disconnect)}>{t('disconnect')}</button>}</div>
    </form>{config && <p class="small ai-connection" role="status">{t('connected')} · {config.endpoint} · {config.model}</p>}{session && <p class="small muted">{t('session')}</p>}{error && <p class="error" role="alert">{t('failed')}</p>}
  </section>;
}
export function AiControls({ language, config, progress, disabled, label = 'all', start, stop }: { language: string; config: DecisionConfig | null; progress?: AiProgress | null; disabled?: boolean; label?: AiLabel; start(): void; stop(): void }) {
  const t = (key: AiLabel) => aiText(language, key);
  return <div class="ai-controls"><div class="actions"><button disabled={!config || disabled || progress?.state === 'running'} onClick={start}>{t(label)}</button>{progress?.state === 'running' && <button onClick={stop}>{t('cancel')}</button>}</div>
    <p class="small muted">{config ? t('preserve') : t('configure')}</p>
    {progress && <div class="ai-progress small" role="status"><strong>{t(progress.state)}</strong> · {progress.done} / {progress.total}<br/>{t('marked')} {progress.marked} · {t('unmatched')} {progress.unmatched} · {t('skipped')} {progress.skipped} · {t('errors')} {progress.failed}</div>}
    {progress?.failed ? <p class="error" role="alert">{t('failed')}</p> : null}
  </div>;
}
