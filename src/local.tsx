import { render } from 'preact';
import { isPostDateOrder } from './post-order';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';
import { orderedMarks } from './model';
import { PostCard, Detail } from './file-post-ui';
import { filterViewerPosts, EMPTY_VIEWER_FILTERS, VIEWER_MAX_BYTES, type ViewerFilters, type ViewerPost } from './viewer-data';
import { emptyLocalLibrary, parseLocalLibrary, parseLocalImport, mergeLocalImport, localView, localCount, serializeLocalLibrary, localBackup, localBookmarksBackup, verifyLocalImportParts,
  setLocalRead, toggleLocalMark, LOCAL_MAX_BYTES, LocalDataError, type LocalLibrary, type LocalSource, type LocalSettings } from './local-data';
import { pickers, filePickerTypes, openLocalFile, newLocalTarget, saveLocalFile, downloadLocalText, type LocalFileTarget, type LocalFileHandle } from './local-files';
import { loadLocalSession, rememberLocalFile, rememberLocalPreviews, resumeLocalFile } from './local-session';
import { localText, localSymbolText, type LocalTranslate, type LocalMessage } from './local-messages';
import { LocalQuickMarks, LocalMarkManager } from './local-marks-ui';
import { prepareBackupFiles, downloadBackupFile, type BackupFile } from './backup-parts';
import { BackupDownloads } from './backup-downloads';
import type { LocalImport } from './local-data';
import type { ViewerLanguage } from './viewer-messages';
import { PostFeed, usePostFeed } from './post-feed';

type PageName = 'posts' | 'marks' | 'backup' | 'settings';
const systemLanguage = (): ViewerLanguage => /^ja(?:[-_]|$)/i.test(navigator.language) ? 'ja' : 'en';
const cancelled = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
function App() {
  const [fileRevision, setFileRevision] = useState(0);
  const [lib, setLib] = useState<LocalLibrary | null>(null); const library = useRef<LocalLibrary | null>(null); const target = useRef<LocalFileTarget | null>(null);
  const [source, setSource] = useState<LocalSource>('bookmarks'); const [section, setSection] = useState<PageName>('posts');
  const [dirty, setDirty] = useState(false); const dirtyRef = useRef(false); const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [filename, setFilename] = useState(''); const [bytes, setBytes] = useState<number | null>(null);
  const [exportFiles, setExportFiles] = useState<BackupFile[]>([]);
  const [error, setError] = useState<LocalMessage | null>(null); const [notice, setNotice] = useState('');
  const [fallbackSettings, setFallbackSettings] = useState(emptyLocalLibrary().settings); const settings = lib?.settings ?? fallbackSettings;
  const [systemLang, setSystemLang] = useState(systemLanguage); const language = settings.language === 'system' ? systemLang : settings.language;
  const tr: LocalTranslate = key => localText(key, language); const locale = language === 'ja' ? 'ja-JP' : 'en-US';
  const [filters, setFilters] = useState<ViewerFilters>({ ...EMPTY_VIEWER_FILTERS }); const [query, setQuery] = useState(''); const [author, setAuthor] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailMediaIndex, setDetailMediaIndex] = useState(0);
  const [previews, setPreviews] = useState(false); const [scope, setScope] = useState('current');
  const [remembered, setRemembered] = useState<LocalFileHandle | null>(null); const [memoryError, setMemoryError] = useState(false);
  const importInput = useRef<HTMLInputElement>(null); const openInput = useRef<HTMLInputElement>(null);
  const collection = lib?.libraries[source]; const data = useMemo(() => collection ? localView(collection) : null, [collection]);
  const detail = data?.posts.find(p => p.key === detailKey);
  useEffect(() => { document.documentElement.lang = language; document.title = `xbookmarkshelf · ${tr('localTitle')}`; }, [language]);
  useEffect(() => { if (settings.theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = settings.theme; }, [settings.theme]);
  useEffect(() => { const listener = () => setSystemLang(systemLanguage()); window.addEventListener('languagechange', listener); return () => window.removeEventListener('languagechange', listener); }, []);
  useEffect(() => {
    let active = true; setWorking(true);
    void (async () => {
      let session;
      try { session = await loadLocalSession(); } catch { if (active) setMemoryError(true); return; }
      if (!active) return; setPreviews(session.previews); setRemembered(session.handle);
      if (session.handle) {
        try { const opened = await resumeLocalFile(session.handle); if (active && opened) install(opened.library, session.handle.name, opened.bytes, opened.target); }
        catch { if (active) setError('resumeError'); }
      }
    })().finally(() => { if (active) setWorking(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => { if (dirtyRef.current || busyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', listener); return () => window.removeEventListener('beforeunload', listener);
  }, []);
  useEffect(() => { const t = setTimeout(() => { setFilters(old => ({ ...old, query, author })); }, 250); return () => clearTimeout(t); }, [query, author]);
  function markDirty(value: boolean) { dirtyRef.current = value; setDirty(value); }
  function setWorking(value: boolean) { busyRef.current = value; setBusy(value); }
  function report(e: unknown, saving = false) { if (cancelled(e)) return; setError(e instanceof LocalDataError ? `${e.code}Error` as LocalMessage : saving ? 'saveError' : 'recordsError'); }
  function commit(next: LocalLibrary) { library.current = next; setLib(next); markDirty(true); setError(null); setNotice(''); }
  function mutate(action: () => LocalLibrary): boolean {
    if (busyRef.current) return false; try { commit(action()); return true; } catch (e) { report(e); return false; }
  }
  function preference(patch: Partial<LocalSettings>) {
    if (library.current) mutate(() => ({ ...library.current!, settings: { ...library.current!.settings, ...patch }, updatedAt: new Date().toISOString() }));
    else setFallbackSettings(old => ({ ...old, ...patch }));
  }
  function update(patch: Partial<ViewerFilters>) { setFilters(old => ({ ...old, ...patch })); }
  function reset() { setQuery(''); setAuthor(''); setFrom(''); setTo(''); setFilters({ ...EMPTY_VIEWER_FILTERS }); }
  function chooseTag(id: string) { setDetailKey(null); setSection('posts'); update({ tag: id, read: '' }); }
  function switchSource(s: LocalSource) { setSource(s); setSection('posts'); setDetailKey(null); setScope('current'); reset(); }
  function allowReplace() { return !dirtyRef.current || window.confirm(tr('discard')); }
  async function remember(handle: LocalFileHandle | null) {
    try { await rememberLocalFile(handle); setRemembered(handle); }
    catch { setMemoryError(true); }
  }
  function previewPreference(value: boolean) {
    if (busyRef.current) return; setPreviews(value);
    void rememberLocalPreviews(value).catch(() => setMemoryError(true));
  }
  function install(next: LocalLibrary, name = '', size: number | null = null, fileTarget: LocalFileTarget | null = null) {
    setFileRevision(n => n + 1);
    library.current = next; setLib(next); target.current = fileTarget; setFilename(name); setBytes(size); markDirty(false); reset(); setDetailKey(null); setSection('posts'); setScope('current');
    setSource(next.libraries.bookmarks.posts.length || !next.libraries.likes.posts.length ? 'bookmarks' : 'likes'); setError(null); setNotice('');
  }
  async function create() { if (busyRef.current || !allowReplace()) return; setWorking(true); const next = emptyLocalLibrary(); next.settings = { ...settings }; install(next); markDirty(true); await remember(null); setWorking(false); }
  async function reopen() {
    if (!remembered || busyRef.current || !allowReplace()) return;
    setWorking(true); setError(null);
    try {
      const opened = await resumeLocalFile(remembered, true);
      if (opened) install(opened.library, remembered.name, opened.bytes, opened.target); else setError('permissionError');
    } catch (e) { if (!cancelled(e)) setError('resumeError'); } finally { setWorking(false); }
  }
  async function forget() { if (busyRef.current) return; setWorking(true); await remember(null); setWorking(false); }
  async function openLibrary() {
    if (busyRef.current || !allowReplace()) return;
    const picker = pickers().showOpenFilePicker; if (!picker) { openInput.current?.click(); return; }
    setWorking(true); setError(null);
    try { const handles = await picker.call(window, { types: filePickerTypes, excludeAcceptAllOption: true, multiple: false, id: 'xbs-library' }); const handle = handles[0];
      if (handle) { const opened = await openLocalFile(handle); install(opened.library, handle.name, opened.bytes, opened.target); await remember(handle); }
    } catch (e) { report(e); } finally { setWorking(false); }
  }
  async function openFallback(file: File | undefined) {
    if (openInput.current) openInput.current.value = ''; if (!file || busyRef.current) return;
    setWorking(true); setError(null);
    try { if (file.size > LOCAL_MAX_BYTES) throw new LocalDataError('size'); const next = parseLocalLibrary(await file.text()); install(next, file.name, file.size); await remember(null); }
    catch (e) { report(e); } finally { setWorking(false); }
  }
  async function importFiles(files: File[]) {
    if (importInput.current) importInput.current.value = ''; if (!files.length || busyRef.current) return;
    setWorking(true); setError(null); setNotice('');
    try {
      let next = library.current ?? emptyLocalLibrary(); let added = 0; let existing = 0; let active = source; const imports: LocalImport[] = [];
      await new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0)));
      for (const file of files) {
        if (file.size > LOCAL_MAX_BYTES) throw new LocalDataError('size');
        const input = parseLocalImport(await file.text()); imports.push(input); const result = mergeLocalImport(next, input); next = result.library; added += result.added; existing += result.existing; active = result.source;
      }
      verifyLocalImportParts(imports); commit(next); switchSource(active); setNotice(`${tr('imported')} · ${tr('added')} ${added.toLocaleString(locale)} · ${tr('existing')} ${existing.toLocaleString(locale)}`);
    } catch (e) { report(e); } finally { setWorking(false); }
  }
  async function save(as = false) {
    const snapshot = library.current; if (!snapshot || busyRef.current) return;
    setWorking(true); setError(null); setNotice('');
    try {
      const picker = pickers().showSaveFilePicker;
      if (!picker) { downloadLocalText(serializeLocalLibrary(snapshot), 'xbookmarkshelf-library.json'); setNotice(tr('downloaded')); return; }
      let nextTarget = target.current;
      if (as || !nextTarget) { const handle = await picker.call(window, { suggestedName: 'xbookmarkshelf-library.json', types: filePickerTypes, excludeAcceptAllOption: true, id: 'xbs-library' }); nextTarget = await newLocalTarget(handle); }
      else if (nextTarget.handle.requestPermission && await nextTarget.handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new DOMException('File permission denied', 'NotAllowedError');
      const saved = await saveLocalFile(nextTarget, snapshot); target.current = saved; setFilename(saved.handle.name); setBytes(new TextEncoder().encode(serializeLocalLibrary(snapshot)).length);
      if (library.current === snapshot) markDirty(false); setNotice(tr('saved')); await remember(saved.handle);
    } catch (e) { report(e, true); } finally { setWorking(false); }
  }
  function exportBackup(extension = false) {
    if (!lib || busyRef.current) return; setError(null); setNotice(''); setExportFiles([]);
    try {
      const selected = scope !== 'entire'; const mark = scope !== 'current' && scope !== 'entire' ? scope : undefined;
      if (extension) {
        const files = prepareBackupFiles(localBookmarksBackup(lib, mark)).map(file => ({ ...file, name: file.name.replace('xbookmarkshelf-bookmarks-', 'xbookmarkshelf-bookmarks-local-') }));
        if (files.length === 1) downloadBackupFile(files[0]!); else { setExportFiles(files); setNotice(tr('splitExport')); }
      } else {
        const value = serializeLocalLibrary(localBackup(lib, selected ? source : undefined, mark));
        downloadLocalText(value, `xbookmarkshelf-local-backup-${new Date().toISOString().slice(0, 10)}.json`);
      }
    } catch (e) { report(e); }
  }
  const metadata = useMemo(() => { const counts = new Map<string, number>(); let unread = 0; let unmarked = 0;
    for (const p of data?.posts ?? []) { if (!p.read) unread++; if (!p.tags.some(t => t.mark)) unmarked++; for (const t of p.tags) counts.set(t.id, (counts.get(t.id) ?? 0) + 1); }
    return { counts, unread, unmarked }; }, [data]);
  const results = useMemo(() => filterViewerPosts(data?.posts ?? [], filters).filter(p => (!from || !!p.postedAt && p.postedAt.slice(0, 10) >= from) && (!to || !!p.postedAt && p.postedAt.slice(0, 10) <= to)), [data, filters, from, to]);
  const feed = usePostFeed({ total: results.length, resetKey: JSON.stringify([source, section, fileRevision, filters, from, to]), columns: settings.columns, layout: settings.layout, previews, ready: true });
  const visible = results.slice(feed.start, feed.start + 50);
  const marks = orderedMarks(collection?.tags ?? []); const sidebarMarks = marks.filter(t => !filters.account || t.accountId === filters.account);
  const tagLabel = (id: string) => { const t = collection?.tags.find(t => t.id === id); const a = collection?.accounts.find(a => a.id === t?.accountId);
    return t ? `${t.name}${(collection?.accounts.length ?? 0) > 1 ? ` · @${a?.handle}` : ''}` : tr('all'); };
  function openPost(p: ViewerPost, mediaIndex = 0) { if (busyRef.current || !library.current) return; if (!p.read) mutate(() => setLocalRead(library.current!, source, p.key, true)); setDetailMediaIndex(mediaIndex); setDetailKey(p.key); }
  const actions = (p: ViewerPost) => <LocalQuickMarks marks={marks.filter(t => t.accountId === p.accountId)} post={p} tr={tr} disabled={busy} toggle={id => mutate(() => toggleLocalMark(library.current!, source, p.key, id))}/>;
  const readAction = (p: ViewerPost) => <button class="text-button local-read" aria-label={tr(p.read ? 'makeUnread' : 'makeRead')} disabled={busy} onClick={() => mutate(() => setLocalRead(library.current!, source, p.key, !p.read))}><Icon name={p.read ? 'check' : 'unread'}/>{tr(p.read ? 'readYes' : 'readNo')}</button>;
  const annotation = (p: ViewerPost) => <div class="local-post-note small muted">{p.mediaStatus === 'unknown' && <span>{tr('unknownMedia')}</span>}{p.dateSource === 'id' && <span title={p.postedAt ?? ''}>{tr('idDate')}</span>}</div>;
  const heading = filters.read === 'unread' ? tr('unread') : filters.tag === ':without' ? tr('unmarked') : filters.tag && !filters.tag.startsWith(':') ? tagLabel(filters.tag) : tr(source === 'bookmarks' ? 'allBookmarks' : 'allLikes');
  return <div class="library-layout viewer-layout local-layout">
    <aside class="sidebar"><div class="brand"><span class="brand-mark"><Icon name="bookmark"/></span><span>xbookmarkshelf<small>LOCAL LIBRARY</small></span></div>
      <div class="local-source-switch" role="group" aria-label={tr('localTitle')}>{(['bookmarks', 'likes'] as const).map(s => <button key={s} aria-pressed={source === s} disabled={busy} onClick={() => switchSource(s)}><Icon name={s === 'likes' ? 'heart' : 'bookmark'}/>{tr(s)}</button>)}</div>
      <nav class="side-nav" aria-label={tr('localTitle')}><button class={`nav-item ${section === 'posts' && !filters.tag && !filters.read ? 'active' : ''}`} onClick={() => { setSection('posts'); update({ tag: '', read: '' }); }}><Icon name="bookmark"/><span class="nav-text">{tr(source === 'bookmarks' ? 'allBookmarks' : 'allLikes')}</span><span class="nav-count">{data?.posts.length.toLocaleString(locale) ?? 0}</span></button>
        <button class={`nav-item ${section === 'posts' && filters.read === 'unread' ? 'active' : ''}`} onClick={() => { setSection('posts'); update({ tag: '', read: 'unread' }); }}><Icon name="unread"/><span class="nav-text">{tr('unread')}</span><span class="nav-count">{metadata.unread}</span></button>
        <button class={`nav-item ${section === 'posts' && filters.tag === ':without' ? 'active' : ''}`} onClick={() => chooseTag(':without')}><Icon name="tag"/><span class="nav-text">{tr('unmarked')}</span><span class="nav-count">{metadata.unmarked}</span></button>
      </nav>
      <nav class="side-tags side-marks" aria-label={tr('marks')}><button class={`mark-section-heading ${section === 'marks' ? 'active' : ''}`} aria-label={tr('manageMarks')} onClick={() => setSection('marks')}><span>{tr('marks')}</span><span class="mark-section-add"><Icon name="plus"/></span></button>
        {sidebarMarks.map(t => <button key={t.id} class={`nav-item ${section === 'posts' && filters.tag === t.id ? 'active' : ''}`} title={tagLabel(t.id)} onClick={() => chooseTag(t.id)}><Icon name={t.mark!}/><span class="nav-text">{tagLabel(t.id)}</span><span class="nav-count">{metadata.counts.get(t.id) ?? 0}</span></button>)}
      </nav>
      <nav class="side-nav local-extra-nav"><button class={`nav-item ${section === 'backup' ? 'active' : ''}`} onClick={() => setSection('backup')}><Icon name="archive"/><span>{tr('backupPage')}</span></button><button class={`nav-item ${section === 'settings' ? 'active' : ''}`} onClick={() => setSection('settings')}><Icon name="settings"/><span>{tr('settingsPage')}</span></button></nav>
      <div class="sidebar-footer"><span class="local-status"><Icon name="lock"/>{tr('fileStorage')}</span></div>
    </aside>
    <div class="workspace">{lib && <header class="topbar"><div class="search-bar"><Icon name="search"/><input type="search" aria-label={tr('search')} placeholder={tr('search')} value={query} onInput={e => { setQuery(e.currentTarget.value); setSection('posts'); }}/></div>
      <button class="viewer-open" aria-label={tr('import')} disabled={busy} onClick={() => importInput.current?.click()}><Icon name="plus"/><span>{tr('import')}</span></button>
      <button class="primary local-save" disabled={busy || !lib} onClick={() => void save()}><Icon name="check"/>{tr('save')}</button>
    </header>}<main class="library-main"><BackupDownloads files={exportFiles} label={tr('splitExport')}/>
      <input ref={importInput} hidden type="file" multiple accept=".json,.js,application/json,text/javascript" aria-label={tr('import')} onChange={e => void importFiles(Array.from(e.currentTarget.files ?? []))}/>
      <input ref={openInput} hidden type="file" accept=".json,application/json" aria-label={tr('openLibrary')} onChange={e => void openFallback(e.currentTarget.files?.[0])}/>
      {lib && <div class="local-file-bar"><span class="viewer-filename" title={filename}>{filename || tr('newFile')}</span><span class={dirty ? 'local-dirty' : 'muted'} role="status">{tr(dirty ? 'unsaved' : 'saved')}</span><div class="actions"><button class="small-button" disabled={busy} onClick={() => void create()}>{tr('new')}</button><button class="small-button" disabled={busy} onClick={() => void openLibrary()}>{tr('openLibrary')}</button><button class="small-button" disabled={busy} onClick={() => void save(true)}>{tr('saveAs')}</button></div></div>}
      {error && <p class="error" role="alert">{tr(error)}</p>}{busy && <p class="notice" role="status">{tr('working')}</p>}{notice && <p class="notice" role="status">{notice}</p>}
      {lib && !pickers().showSaveFilePicker && <p class="small muted">{tr('unavailable')}</p>}
      {!lib ? <section class="empty viewer-welcome"><span class="empty-icon"><Icon name="archive"/></span><h1>{tr('localTitle')}</h1><p>{tr('welcome')}</p>
        {remembered ? <><p class="local-remembered-file" title={remembered.name}>{remembered.name}</p><div class="actions"><button class="primary" disabled={busy} onClick={() => void reopen()}>{tr('resume')}</button><button disabled={busy} onClick={() => void openLibrary()}>{tr('otherFile')}</button></div><div class="actions local-welcome-secondary"><button class="text-button" disabled={busy} onClick={() => void create()}>{tr('new')}</button><button class="text-button" disabled={busy} onClick={() => void forget()}>{tr('forget')}</button></div></>
        : <div class="actions"><button class="primary" disabled={busy} onClick={() => void create()}>{tr('new')}</button><button disabled={busy} onClick={() => void openLibrary()}>{tr('openLibrary')}</button></div>}
        {memoryError && <p class="small muted">{tr('memoryError')}</p>}
      </section> : <>
        {section === 'marks' && <LocalMarkManager key={source} lib={lib} source={source} selectedAccount={filters.account} tr={tr} symbolLabel={s => localSymbolText(s, language)} disabled={busy} change={mutate} open={chooseTag}/>}
        {section === 'settings' && <section class="panel"><h1>{tr('settingsPage')}</h1><div class="filter-fields"><label>{tr('language')}<select aria-label={tr('language')} value={settings.language} disabled={busy} onChange={e => preference({ language: e.currentTarget.value as LocalSettings['language'] })}><option value="system">{tr('system')}</option><option value="ja">日本語</option><option value="en">English</option></select></label>
          <label>{tr('theme')}<select aria-label={tr('theme')} value={settings.theme} disabled={busy} onChange={e => preference({ theme: e.currentTarget.value as LocalSettings['theme'] })}>{(['system', 'light', 'dark'] as const).map(s => <option key={s} value={s}>{tr(s)}</option>)}</select></label></div>
          <label class="switch-label"><input type="checkbox" checked={previews} disabled={busy} onChange={e => previewPreference(e.currentTarget.checked)}/>{tr('previews')}</label><p class="small muted">{tr('previewNote')}</p><p class="muted">{tr('saveNote')}</p><dl class="local-capacity"><dt>{tr('total')}</dt><dd>{localCount(lib).toLocaleString(locale)}</dd><dt>{tr('fileSize')}</dt><dd>{bytes === null ? tr('notSaved') : `${(bytes / 1048576).toFixed(2)} MiB`}</dd></dl><p class="small muted">{tr('limits')}</p>
          {remembered && <div class="local-resume-setting"><p class="small muted local-remembered-file">{tr('rememberedFile')}: {remembered.name}</p><button disabled={busy} onClick={() => void forget()}>{tr('forget')}</button></div>}{memoryError && <p class="small muted">{tr('memoryError')}</p>}
        </section>}
        {section === 'backup' && <section class="panel"><h1>{tr('backupPage')}</h1><h2>{tr('import')}</h2><p class="muted">{tr('importNote')}</p><button disabled={busy} onClick={() => importInput.current?.click()}>{tr('import')}</button><h2>{tr('localBackup')}</h2>
          <label>{tr('backupScope')}<select aria-label={tr('backupScope')} value={scope} disabled={busy} onChange={e => setScope(e.currentTarget.value)}><option value="entire">{tr('entire')}</option><option value="current">{tr('current')} · {tr(source)}</option>{marks.map(t => <option key={t.id} value={t.id}>{tagLabel(t.id)} · {metadata.counts.get(t.id) ?? 0}</option>)}</select></label>
          <div class="actions"><button class="primary" disabled={busy} onClick={() => exportBackup()}>{tr('localBackup')}</button>{source === 'bookmarks' && <button disabled={busy} onClick={() => exportBackup(true)}>{tr('extensionBackup')}</button>}</div><p class="small muted">{tr('extensionNote')}</p><p class="muted">{tr('saveNote')}</p>
        </section>}
        {section === 'posts' && <><div class="page-heading"><div><h1>{heading}</h1><p class="muted">{data?.posts.length.toLocaleString(locale) ?? 0} {tr('count')} · {tr(source)}</p></div></div>
          {source === 'likes' && <p class="small muted">{tr('likesInfo')}</p>}
          <details class="filter-panel"><summary>{tr('filters')}</summary><div class="filter-fields"><label>{tr('author')}<input aria-label={tr('author')} value={author} maxLength={200} placeholder="@handle" onInput={e => setAuthor(e.currentTarget.value)}/></label>
            <label>{tr('account')}<select aria-label={tr('account')} value={filters.account} onChange={e => update({ account: e.currentTarget.value, tag: '' })}><option value="">{tr('any')}</option>{data?.accounts.map(a => <option key={a.id} value={a.id}>{a.handle ? `@${a.handle}` : tr('likesAccount')}</option>)}</select></label>
            <label>{tr('tag')}<select aria-label={tr('tag')} value={filters.tag} onChange={e => update({ tag: e.currentTarget.value })}><option value="">{tr('any')}</option><option value=":with">{tr('marked')}</option><option value=":without">{tr('unmarked')}</option>{data?.tags.filter(t => !filters.account || t.accountId === filters.account).map(t => <option key={t.id} value={t.id}>{tagLabel(t.id)}</option>)}</select></label>
            <label>{tr('read')}<select aria-label={tr('read')} value={filters.read} onChange={e => update({ read: e.currentTarget.value as ViewerFilters['read'] })}><option value="">{tr('any')}</option><option value="read">{tr('readYes')}</option><option value="unread">{tr('readNo')}</option></select></label>
            <label>{tr('media')}<select aria-label={tr('media')} value={filters.media} onChange={e => update({ media: e.currentTarget.value as ViewerFilters['media'] })}>{(['', 'with', 'without', 'image', 'video', 'unknown'] as const).map(s => <option key={s} value={s}>{tr(s === 'unknown' ? 'unknownMedia' : s || 'any')}</option>)}</select></label>
            <label>{tr('links')}<select aria-label={tr('links')} value={filters.links} onChange={e => update({ links: e.currentTarget.value as ViewerFilters['links'] })}>{(['', 'with', 'without'] as const).map(s => <option key={s} value={s}>{tr(s || 'any')}</option>)}</select></label>
            <label>{tr('from')}<input type="date" value={from} onChange={e => { setFrom(e.currentTarget.value); }}/></label><label>{tr('to')}<input type="date" value={to} onChange={e => { setTo(e.currentTarget.value); }}/></label>
          </div><button class="text-button" onClick={reset}>{tr('reset')}</button></details>
          <div class="toolbar"><span class="small muted" role="status">{tr('results')}: {results.length.toLocaleString(locale)} {tr('count')}</span><div class="display-controls"><select aria-label={tr('order')} value={filters.postedOrder ?? (filters.reverse ? 'reverse' : 'original')} onChange={e => { const value = e.currentTarget.value; update({ postedOrder: isPostDateOrder(value) ? value : undefined, reverse: value === 'reverse' }); }}><option value="original">{tr('original')}</option><option value="reverse">{tr('reverse')}</option><option value="posted-newest">{tr('postedNewest')}</option><option value="posted-oldest">{tr('postedOldest')}</option></select>
            <select class="columns-select" aria-label={tr('columns')} value={settings.columns} disabled={busy} onChange={e => preference({ columns: Number(e.currentTarget.value) })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select>
            <div class="view-switch"><button class="icon-button" aria-label={tr('grid')} aria-pressed={settings.layout === 'grid'} disabled={busy} onClick={() => preference({ layout: 'grid' })}><Icon name="grid"/></button><button class="icon-button" aria-label={tr('list')} aria-pressed={settings.layout === 'list'} disabled={busy} onClick={() => preference({ layout: 'list' })}><Icon name="list"/></button></div>
          </div></div>
          <div class="viewer-preview-setting"><label class="switch-label"><input type="checkbox" checked={previews} disabled={busy} onChange={e => previewPreference(e.currentTarget.checked)}/>{tr('previews')}</label></div>
          {visible.length ? <PostFeed feed={feed} loading={tr('loadingPosts')}>{visible.map(p => <PostCard key={`${source}:${fileRevision}:${p.key}`} post={p} previews={previews} tr={tr} locale={locale} open={openPost} tag={chooseTag} actions={actions(p)} readAction={readAction(p)} annotation={annotation(p)}/>)}</PostFeed> : <p class="empty">{tr('empty')}</p>}
        </>}
      </>}
    </main></div>
    {detail && lib && <Detail key={`${source}:${detail.key}`} post={detail} initialIndex={detailMediaIndex} previews={previews} tr={tr} locale={locale} close={() => setDetailKey(null)} tag={chooseTag} actions={actions(detail)} readAction={readAction(detail)} annotation={annotation(detail)}/>}
  </div>;
}
render(<App/>, document.getElementById('app')!);
