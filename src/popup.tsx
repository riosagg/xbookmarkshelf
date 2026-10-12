import { LanguageProvider, useI18n } from './i18n';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { command } from './messaging';
import { DEFAULT_OPTIONS, type ImportRun, type Mode, type LibrarySource, isLibrarySource, validHandle, librarySourceUrl, REASON_LABELS } from './model';
import { db } from './db';
import { Icon } from './icons';
import { NumericInput } from './numeric-input';
import { applyTheme } from './theme';
import { initialPopupSource, loadPopupPreferences, popupOptions, preferencesFromOptions, savePopupPreferences, validatePopupPreferences, type PopupPreferences } from './popup-preferences';
import './style.css';

function Popup() {
  const { language, t: tr, message } = useI18n();
  useEffect(() => { document.title = `${tr('取り込み')} — xbookmarkshelf`; }, [language]);
  const initial = new URL(location.href).searchParams.get('source');
  const [form, setForm] = useState(() => preferencesFromOptions(isLibrarySource(initial) ? initial : 'bookmarks', DEFAULT_OPTIONS));
  const { source, waitMode, mode } = form;
  const interval = form.intervalMs / 1000; const maximum = form.intervalMaxMs / 1000; const limit = form.maxPosts;
  const [ready, setReady] = useState(false); const [preferenceError, setPreferenceError] = useState('');
  const hasSaved = useRef(false); const edited = useRef(false); const pendingSave = useRef(Promise.resolve());
  const currentForm = useRef(form);
  const [target, setTarget] = useState<{ tabId: number; handle: string; source: LibrarySource } | null>(null);
  const [targetError, setTargetError] = useState(''); const [inspecting, setInspecting] = useState(true);
  const [statusError, setStatusError] = useState('');
  const inspectionSequence = useRef(0); const alive = useRef(true);
  const [run, setRun] = useState<ImportRun>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  function persist(value: PopupPreferences) {
    if (!validatePopupPreferences(value)) return pendingSave.current;
    pendingSave.current = pendingSave.current.then(() => savePopupPreferences(value)).then(() => { hasSaved.current = true; setPreferenceError(''); }).catch(() => setPreferenceError('取り込み設定を保存できません'));
    return pendingSave.current;
  }
  function edit(change: Partial<PopupPreferences>) {
    const next = { ...currentForm.current, ...change }; edited.current = true; applyForm(next); void persist(next);
  }
  function applyForm(value: PopupPreferences) {
    currentForm.current = value; setForm(value);
  }
  async function inspectTarget() {
    let failure: unknown;
    for (let attempt = 0; attempt < 3 && alive.current; attempt++) {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id; if (tabId === undefined) throw new Error('対象タブを確認できません');
        const identity = await command<{ handle: string; source: LibrarySource }>('INSPECT_TAB', { tabId });
        if (!isLibrarySource(identity?.source) || !validHandle(identity?.handle)) throw new Error('拡張とXのタブを再読み込みしてから、もう一度確認してください');
        return { tabId, handle: identity.handle.toLowerCase(), source: identity.source };
      } catch (error) { failure = error; }
      if (attempt < 2) await new Promise<void>(resolve => setTimeout(resolve, 500));
    }
    throw failure;
  }
  function inspectionError(failure: unknown): string {
    const text = failure instanceof Error ? failure.message : '対象画面を確認できません';
    return text === 'Xのブックマーク画面を開いてください' ? '拡張とXのタブを再読み込みしてから、もう一度確認してください' : text;
  }
  async function refreshTarget(chooseVisible = false) {
    const sequence = ++inspectionSequence.current;
    setInspecting(true); setTarget(null); setTargetError('');
    try {
      const inspected = await inspectTarget();
      if (!alive.current || sequence !== inspectionSequence.current) return;
      setTarget(inspected); setTargetError('');
      if (chooseVisible) {
        const next = { ...currentForm.current, source: inspected.source }; applyForm(next);
        const url = new URL(location.href); url.searchParams.set('source', inspected.source); history.replaceState(null, '', url);
      }
    } catch (failure) {
      if (alive.current && sequence === inspectionSequence.current) setTargetError(inspectionError(failure));
    } finally { if (alive.current && sequence === inspectionSequence.current) setInspecting(false); }
  }
  useEffect(() => {
    void db.settings.get('theme').then(t => { if (t?.value === 'dark' || t?.value === 'light') applyTheme(t.value); }).catch(() => {});
    let active = true; alive.current = true;
    void (async () => {
      const [saved, inspected] = await Promise.allSettled([loadPopupPreferences(), inspectTarget()]);
      if (!active) return;
      const preferences = saved.status === 'fulfilled' ? saved.value : undefined;
      hasSaved.current = !!preferences;
      if (saved.status === 'rejected') setPreferenceError('取り込み設定を読み込めません');
      if (inspected.status === 'fulfilled') setTarget(inspected.value);
      else setTargetError(inspectionError(inspected.reason));
      const selected = initialPopupSource(initial, inspected.status === 'fulfilled' ? inspected.value.source : undefined, preferences?.source);
      applyForm({ ...(preferences ?? preferencesFromOptions(selected, DEFAULT_OPTIONS)), source: selected });
      const url = new URL(location.href); url.searchParams.set('source', selected); history.replaceState(null, '', url); setInspecting(false); setReady(true);
    })();
    return () => { active = false; alive.current = false; inspectionSequence.current++; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    let hydrated = false;
    const load = async () => {
      const value = await command<ImportRun | undefined>('STATUS', { source });
      if (!active) return;
      if (value && (value.source ?? 'bookmarks') !== source) {
        setRun(undefined); setStatusError('拡張とXのタブを再読み込みしてから、もう一度確認してください'); return;
      }
      setStatusError('');
      if (value && ((!hydrated && !hasSaved.current && !edited.current) || value.state === 'running')) applyForm(preferencesFromOptions(source, value));
      hydrated = true; setRun(value);
    };
    setRun(undefined); setStatusError(''); void load().catch(() => { if (active) setStatusError('状態を取得できません'); });
    const timer = window.setInterval(() => { void load().catch(() => {}); }, 1500); return () => { active = false; clearInterval(timer); };
  }, [source, ready]);
  const waitValid = Number.isInteger(interval * 1000) && interval >= 3 && interval <= 30 &&
    (waitMode === 'fixed' || (Number.isInteger(maximum * 1000) && maximum >= interval && maximum <= 30));
  const targetMatches = target?.source === source;
  const sourceUrl = librarySourceUrl(source, target?.handle);
  const disabled = !ready || busy || run?.state === 'running';
  function changeSource(value: LibrarySource) {
    edit({ source: value }); setError('');
    const url = new URL(location.href); url.searchParams.set('source', value); history.replaceState(null, '', url);
    void refreshTarget();
  }
  async function start() {
    if (!ready || !target || !targetMatches || !validatePopupPreferences(form)) return; setBusy(true); setError('');
    try { await persist(form); setRun(await command<ImportRun>('START', { ...target, source, options: popupOptions(form) })); }
    catch (e) { setError(e instanceof Error ? e.message : '開始できません'); }
    finally { setBusy(false); }
  }
  async function stop(pause: boolean) {
    if (!run) return; setBusy(true);
    try { setRun(await command<ImportRun>('STOP', { runId: run.id, source: run.source ?? 'bookmarks', pause })); }
    catch { setError('停止状態を確認できません'); }
    finally { setBusy(false); }
  }
  return <main class="popup">
    <header class="popup-brand"><span class="brand-mark"><Icon name="bookmark"/></span><strong>xbookmarkshelf<span>FOR X</span></strong><span class="version">v0.1.0</span></header>
    {target && <div class="account"><span class="status-dot"/><span>{tr("対象アカウント")}</span><strong>@{target.handle}</strong><Icon name="check"/></div>}
    <div class="fields"><label>{tr('取り込み対象')}<select value={source} disabled={disabled} onChange={event => { const value = event.currentTarget.value; if (isLibrarySource(value)) changeSource(value); }}><option value="bookmarks">{tr('ブックマーク')}</option><option value="likes">{tr('いいね')}</option></select></label>
      <label>{tr('取り込み範囲')}<select value={mode} disabled={disabled} onChange={event => edit({ mode: event.currentTarget.value as Mode })}><option value="full">{tr('現在の一覧を先頭から再走査')}</option><option value="delta">{tr('新規分を中心に取得')}</option></select></label></div>
    <div class="fields"><label>{tr('待機方法')}<select value={waitMode} disabled={disabled} onChange={event => edit({ waitMode: event.currentTarget.value as 'fixed' | 'random', intervalMaxMs: Math.max(form.intervalMs, form.intervalMaxMs) })}><option value="fixed">{tr('固定')}</option><option value="random">{tr('ランダム')}</option></select></label>
      <label>{tr('今回の上限（件）')}<NumericInput value={limit} disabled={disabled} onValue={maxPosts => edit({ maxPosts })}/></label></div>
    {waitMode === 'random' ? <div class="fields"><label>{tr('最短（秒）')}<NumericInput decimal value={interval} describedBy="interval-help" disabled={disabled} onValue={seconds => edit({ intervalMs: seconds * 1000 })}/></label><label>{tr('最長（秒）')}<NumericInput decimal value={maximum} describedBy="interval-help" disabled={disabled} onValue={seconds => edit({ intervalMaxMs: seconds * 1000 })}/></label></div> : <div class="fields"><label>{tr('待機（秒）')}<NumericInput decimal value={interval} describedBy="interval-help" disabled={disabled} onValue={seconds => edit({ intervalMs: seconds * 1000 })}/></label></div>}
    <p class="popup-interval-note" id="interval-help">{tr("Xへの負荷を抑えるため、待機は最短3秒です。")}</p>
    {!waitValid && <p class="error" role="alert">{tr('待機は3〜30秒で、最長を最短以上にしてください')}</p>}
    {!targetMatches && <div class="popup-target-hint">{inspecting ? tr('対象を確認中…') : tr(source === 'likes' ? 'Xで自分のいいね一覧を開いてください。' : 'Xでブックマーク一覧を開いてください。')}<div class="actions"><button class="text-button" disabled={!ready || inspecting || busy || run?.state === 'running'} onClick={() => { void refreshTarget(true); }}>{tr('対象を再確認')}</button><button class="text-button" onClick={() => { void chrome.tabs.create({ url: sourceUrl }); }}>{tr(source === 'likes' ? 'Xのいいねを開く' : 'Xのブックマークを開く')}<Icon name="external"/></button></div></div>}
    {preferenceError && <p class="error" role="alert">{message(preferenceError)}</p>}
    {(targetError || statusError) && <p class="error" role="alert">{message(targetError || statusError)}</p>}
    {error && <p class="error" role="alert">{message(error)}</p>}
    {run && <div class="progress" aria-live="polite"><strong>{run.state === 'running' ? tr("読み取り中") : run.reason ? tr(REASON_LABELS[run.reason]) : tr("終了")}</strong>{run.reason === 'run_limit' && <p>{tr("設定した上限まで保存しました。")}</p>}<p>{tr('保存確認 {observed}件 · 新規 {added}件 · 既存 {existing}件', { observed: run.observed, added: run.added, existing: run.existing })}</p></div>}
    {run?.state === 'running' ? <div class="actions"><button class="primary" onClick={() => stop(true)} disabled={busy}>{tr("一時停止")}</button><button onClick={() => stop(false)} disabled={busy}>{tr("終了")}</button></div> : <button class="primary full" onClick={start} disabled={!ready || !targetMatches || !validatePopupPreferences(form) || busy}><Icon name="download"/>{busy ? tr("準備中…") : run?.state === 'paused' ? tr("先頭から再実行") : tr("少量ずつ自動取り込み")}</button>}
    <p class="popup-note"><Icon name="lock"/><span>{tr(source === "likes" ? "XのLikesを表示したまま使います。停止後も保存済み投稿は残ります。" : "XのBookmarksを表示したまま使います。停止後も保存済み投稿は残ります。")}</span></p>
    <footer class="popup-footer"><button class="text-button" onClick={() => { void chrome.tabs.create({ url: chrome.runtime.getURL(`library.html?source=${source}`) }); }}>{tr("ライブラリを開く")}<Icon name="external"/></button></footer>
  </main>;
}
render(<LanguageProvider><Popup/></LanguageProvider>, document.getElementById('app')!);
