import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';
import { db, storeForSource, libraryStores } from './db';
import { useI18n } from './i18n';
import { command } from './messaging';
import type { LibrarySource } from './model';
import { AI_CONFIG, AI_JOB, connectDecision, decisionConfig, type DecisionConfig, type AiJob } from './decision';
import { AiControls, AiSettings, AiStatus, aiText, type AiLabel } from './ai-ui';
import { loadDecision, cancelAiJob } from './auto-marks';

export function useDecisionConnection() {
  const [config, setConfig] = useState<DecisionConfig | null>(null);
  useEffect(() => { const subscription = liveQuery(loadDecision).subscribe({ next: setConfig, error: () => setConfig(null) }); return () => subscription.unsubscribe(); }, []);
  return config;
}
export function useAiJob(source: LibrarySource) {
  const [job, setJob] = useState<AiJob | null>(null);
  useEffect(() => {
    setJob(null);
    const subscription = liveQuery(async () => ((await storeForSource(source).settings.get(AI_JOB))?.value ?? null) as AiJob | null).subscribe({ next: setJob, error: () => setJob(null) });
    return () => subscription.unsubscribe();
  }, [source]);
  return job;
}
export function ExtensionAiSettings() {
  const { language } = useI18n(); const config = useDecisionConnection();
  return <AiSettings language={language} config={config} connect={async value => {
    const valid = decisionConfig(value);
    const origins = [`${new URL(valid.endpoint).protocol}//${new URL(valid.endpoint).hostname}/*`, ...(valid.images ? ['https://pbs.twimg.com/*'] : [])];
    if (!await chrome.permissions.request({ origins })) throw new Error('Permission denied');
    const connected = await connectDecision(valid); await db.settings.put({ key: AI_CONFIG, value: connected });
  }} disconnect={async () => { await db.settings.delete(AI_CONFIG); for (const store of libraryStores) await cancelAiJob(store); }}/>;
}
export function ExtensionAiControls({ source, runId, accountId, disabled, label = 'all' }: { source: LibrarySource; runId?: string; accountId?: string; disabled?: boolean; label?: AiLabel }) {
  const { language } = useI18n(); const config = useDecisionConnection(); const [job, setJob] = useState<AiJob | null>(null); const [error, setError] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { const subscription = liveQuery(async () => ((await storeForSource(source).settings.get(AI_JOB))?.value ?? null) as AiJob | null).subscribe({ next: setJob, error: () => setError(true) }); return () => subscription.unsubscribe(); }, [source]);
  async function operate(type: string) { setBusy(true); setError(false); try { await command(type, { source, ...(runId ? { runId } : {}), ...(accountId ? { accountId } : {}) }); } catch { setError(true); } finally { setBusy(false); } }
  return <><AiControls language={language} config={config} progress={job} disabled={disabled || busy} label={label} start={() => void operate('AI_START')} stop={() => void operate('AI_STOP')}/>{error && <p class="error" role="alert">{aiText(language, 'failed')}</p>}</>;
}
export function ExtensionImportAiStatus({ source, runId }: { source: LibrarySource; runId: string }) {
  const { language } = useI18n(); const job = useAiJob(source); const [error, setError] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { setError(false); }, [source, runId]);
  if (!job || job.runId !== runId) return null;
  async function stop() { setBusy(true); setError(false); try { await command('AI_STOP', { source }); } catch { setError(true); } finally { setBusy(false); } }
  return <div class="ai-controls ai-import-status"><AiStatus language={language} progress={job}/>
    {job.state === 'running' && <div class="actions"><button disabled={busy} onClick={() => void stop()}>{aiText(language, 'cancel')}</button></div>}
    {error && <p class="error" role="alert">{aiText(language, 'failed')}</p>}
  </div>;
}
