import { ExtensionAiSettings, ExtensionAiControls, ExtensionImportAiStatus, useAiJob, useDecisionConnection } from './extension-ai';
import { AiPage, aiText } from './ai-ui';
import { LanguageProvider, useI18n } from './i18n';
import { dateLocale, isLanguagePreference, type MessageKey, type UIMessage } from './messages';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { type Account, type Post, type UserState, type ImportRun, type Tag, type LinkCard, REASON_LABELS, isMediaUrl, isLibrarySource, type LibrarySource, orderedMarks, MAX_POST_TAGS } from './model';
import { ImportLocationSettings, useImportLocations } from './import-location-settings';
import { importSourceUrl } from './import-locations';
import { db as settingsDB, storeForSource, windowPosts, libraryMetadata, markPostRead, togglePostRead } from './db';
import { textLinks, parseTagNames, formatTagNames, webUrl } from './text';
import { createBackup, createMarkedBackup, restoreBackups, validateCollectionBackup, type CollectionBackup } from './backup';
import { PostBackupExport, downloadPostBackup } from './backup-export';
import { Icon, type IconName } from './icons';
import { BrandMark } from './brand';
import { togglePostMark } from './marks';
import { MarkManager } from './mark-manager';
import { PostMarks } from './post-marks';
import { MediaGallery } from './media-gallery';
import { QuoteContent } from './quote-content';
import { BackupDownloads } from './backup-downloads';
import { BACKUP_MAX_BYTES } from './backup-format';
import { verifyBackupParts, type BackupFile } from './backup-parts';
import { SettingsTransfer } from './settings-transfer';
import { DataManagement, DeletePostsDialog } from './data-management';
import { prepareDeletion, selectionKey, type DeletionPlan } from './post-data';
import { DEFAULT_DISPLAY_SETTINGS, type DisplaySettings } from './settings-backup';
import { initialTheme, applyTheme, type Theme } from './theme';
import './style.css';
import { LibraryStore, useLibraryDB } from './library-store';
import { PostFeed, usePostFeed } from './post-feed';
import { isPostDateOrder, type PostDateOrder } from './post-order';

type View = 'all' | 'marks' | 'unread' | 'unmarked' | 'auto-mark' | 'import' | 'backup' | 'settings';
type Metadata = Awaited<ReturnType<typeof libraryMetadata>>;
const TITLES: Record<View, MessageKey> = { all: 'すべてのブックマーク', marks: 'マーク', unread: 'あとで読む', unmarked: 'マークなし', 'auto-mark': '自動マーク', import: '取り込み', backup: 'バックアップ', settings: '設定' };
const NAV: { view: View; icon: IconName; label: MessageKey }[] = [
  { view: 'all', icon: 'bookmark', label: 'すべてのブックマーク' },
  { view: 'unread', icon: 'unread', label: 'あとで読む' },
  { view: 'unmarked', icon: 'tag', label: 'マークなし' },
  { view: 'auto-mark', icon: 'bolt', label: '自動マーク' },
];

function LinkedText({ text }: { text: string }) {
  const parts: (string | preact.JSX.Element)[] = []; let end = 0;
  for (const link of textLinks(text)) {
    parts.push(text.slice(end, link.start));
    parts.push(<a key={link.start} href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>);
    end = link.end;
  }
  parts.push(text.slice(end)); return <>{parts}</>;
}

function SitePreview({ card, previews }: { card: LinkCard; previews: boolean }) {
  const { t: tr } = useI18n();
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [card.imageUrl, previews]);
  const host = new URL(card.url).hostname;
  const title = card.title || host;
  return <a class="link-card" href={card.url} target="_blank" rel="noopener noreferrer" aria-label={tr('{title}を開く', { title })} title={card.url}>
    <div class="link-card-image">{previews && !failed ? <img src={card.imageUrl} alt={tr('{title}のサムネイル', { title })} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : <div class="media-placeholder"><Icon name="image"/><span>{failed ? tr("サムネイルを読み込めませんでした") : tr("画像プレビューはオフ")}</span></div>}</div>
    <div class="link-card-caption"><span>{host}<Icon name="external"/></span><strong>{title}</strong></div>
  </a>;
}

function PostCard({ post, previews, availableTags, onChange, onTag, onOpen, expanded = false, revision = 0, mediaIndex = 0, selected = false, onSelect }: {
  post: Post; previews: boolean; availableTags: Tag[]; onChange(): void; onTag(id: string): void; onOpen?(post: Post, index?: number): void; expanded?: boolean; revision?: number; mediaIndex?: number;
  selected?: boolean; onSelect?(selected: boolean): void;
}) {
  const db = useLibraryDB();
  const { language, t: tr, message } = useI18n();
  const [state, setState] = useState<UserState>({ accountId: post.accountId, postId: post.postId, read: false, favorite: false });
  const [tags, setTags] = useState<Tag[]>([]); const [tagText, setTagText] = useState('');
  const [error, setError] = useState(''); const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false); const [saving, setSaving] = useState(false); const [tagNotice, setTagNotice] = useState('');
  const [tagSearch, setTagSearch] = useState(''); const [markBusy, setMarkBusy] = useState(false);
  const marks = orderedMarks(availableTags.filter(t => t.accountId === post.accountId));
  const linkCards = (post.linkCards ?? []).filter(card => webUrl(card.url) && isMediaUrl(card.imageUrl) && typeof card.title === 'string').slice(0, 4);
  const tagNames = parseTagNames(tagText);
  const candidates = availableTags.filter(t => t.accountId === post.accountId && !t.mark && t.name.normalize('NFKC').toLocaleLowerCase().includes(tagSearch.normalize('NFKC').toLocaleLowerCase()));
  useEffect(() => {
    let active = true;
    void Promise.all([
      db.userStates.get([post.accountId, post.postId]),
      db.postTags.where('[accountId+postId]').equals([post.accountId, post.postId]).toArray().then(rows => db.tags.bulkGet(rows.map(t => t.tagId))),
    ]).then(([s, values]) => {
      if (!active) return;
      const list = values.filter(t => t !== undefined).sort((a, b) => a.name.localeCompare(b.name));
      if (s) setState(s); setTags(list); setLoaded(true);
    }).catch(() => { if (active) setError('編集情報を読み込めません'); });
    return () => { active = false; };
  }, [post.accountId, post.postId, revision]);
  function editTags(open: boolean) {
    if (open) setTagText(formatTagNames(tags.filter(t => !t.mark).map(t => t.name)));
    setEditing(open); setTagNotice('');
  }
  async function toggle() {
    try {
      const updated = await togglePostRead(post.accountId, post.postId, db); setState(updated); setError(''); onChange();
    } catch { setError('状態を保存できません'); }
  }
  async function saveTags() {
    const names = parseTagNames(tagText);
    if (names.length > MAX_POST_TAGS || names.some(n => n.length > 100)) { setError('タグは20個まで、名前は100文字までです'); return; }
    setSaving(true); setTagNotice('');
    try {
      const updated = await db.transaction('rw', db.posts, db.tags, db.postTags, async () => {
        if (!await db.posts.get([post.accountId, post.postId])) throw new Error('投稿が見つかりません');
        const result: Tag[] = [];
        const protectedMarks = new Set((await db.tags.where('accountId').equals(post.accountId).filter(t => !!t.mark).toArray()).map(t => t.id));
        const existing = await db.postTags.where('[accountId+postId]').equals([post.accountId, post.postId]).toArray();
        const protectedRows = existing.filter(t => protectedMarks.has(t.tagId));
        const markTags = await db.tags.bulkGet(protectedRows.map(t => t.tagId));
        result.push(...markTags.filter(t => t !== undefined));
        if (new Set([...result.map(t => t.name), ...names]).size > MAX_POST_TAGS) throw new Error('タグとマークは合計20個までです');
        await db.postTags.where('[accountId+postId]').equals([post.accountId, post.postId]).filter(t => !protectedMarks.has(t.tagId)).delete();
        for (const name of names) {
          let tag = await db.tags.where('[accountId+name]').equals([post.accountId, name]).first();
          if (!tag) { tag = { id: crypto.randomUUID(), accountId: post.accountId, name }; await db.tags.add(tag); }
          await db.postTags.put({ accountId: post.accountId, postId: post.postId, tagId: tag.id }); if (!result.some(t => t.id === tag.id)) result.push(tag);
        } return result;
      }); setTags(updated); setError(''); setTagNotice('タグを保存しました'); onChange();
    } catch (e) { setError(e instanceof Error ? e.message : 'タグを保存できません'); }
    finally { setSaving(false); }
  }
  async function markPost(tag: Tag) {
    setMarkBusy(true); setError('');
    try {
      const selected = await togglePostMark(post.accountId, post.postId, tag.id, db);
      setTags(current => selected ? [...current.filter(t => t.id !== tag.id), tag] : current.filter(t => t.id !== tag.id));
      onChange();
    } catch (e) { setError(e instanceof Error ? e.message : 'マークを保存できません'); }
    finally { setMarkBusy(false); }
  }
  function chooseTag(name: string) {
    const next = tagNames.includes(name) ? tagNames.filter(t => t !== name) : [...tagNames, name];
    if (next.length > MAX_POST_TAGS) { setError('タグは20個までです'); return; }
    setTagText(formatTagNames(next)); setTagNotice(''); setError('');
  }
  return <article class={`post-card ${selected ? 'post-selected' : ''}`}>
    <MediaGallery post={post} previews={previews} expanded={expanded} initialIndex={mediaIndex} onOpen={onOpen}/>
    <div class="card-content">
      <div class="post-head"><span class="author-avatar">{(post.authorName || post.authorHandle).slice(0, 1)}</span><div class="author-info"><strong title={post.authorName || post.authorHandle}>{post.authorName || post.authorHandle}</strong><span title={`@${post.authorHandle}`}>@{post.authorHandle}</span></div>
        {onSelect && <input class="post-selection" type="checkbox" aria-label={tr('投稿{postId}を選択', { postId: post.postId })} checked={selected} onChange={event => onSelect(event.currentTarget.checked)}/>}
      </div>
      {marks.length > 0 && <PostMarks marks={marks} selected={tags} disabled={!loaded || markBusy || saving} onToggle={markPost}/>}
      {(post.text || !post.quote) && (expanded ? <p class="post-body"><LinkedText text={post.text || tr("本文を取得できませんでした")}/></p> : <details class="post-text"><summary onClick={event => { event.preventDefault(); onOpen?.(post); }}>{post.text || tr("メディアを含む投稿")}</summary></details>)}
      {post.quote && <QuoteContent quote={post.quote} expanded={expanded} previews={previews} label={tr('引用')} openLabel={tr('引用元を開く')} onOpen={() => onOpen?.(post)}/>}
      {linkCards.length > 0 && <div class="link-cards" aria-label={tr("リンク先のプレビュー")}>{linkCards.map(card => <SitePreview key={card.url} card={card} previews={previews}/>)}</div>}
      <div class="tag-chips">{tags.slice(0, MAX_POST_TAGS).map(t => <button class="tag-chip" key={t.id} title={t.name} onClick={() => onTag(t.id)}>{t.mark && <Icon name={t.mark}/>}{t.name}</button>)}</div>
      {tags.length > MAX_POST_TAGS && <p class="small muted">{tr('ほか{count}個のタグ・マークを保存しています。編集から確認できます。', { count: tags.length - MAX_POST_TAGS })}</p>}
      <div class="card-footer"><span class="post-date">{post.postedAt ? new Date(post.postedAt).toLocaleDateString(dateLocale(language)) : tr("日時未取得")}</span><div class="card-actions">
        <button class="read-toggle" aria-pressed={state.read} disabled={!loaded} onClick={toggle}><Icon name={state.read ? 'check' : 'unread'}/><span>{state.read ? tr("既読 ✓") : tr("未読")}</span></button>
        <button class="icon-button" aria-label={tr("タグを編集")} title={tr("タグを編集")} aria-expanded={editing} disabled={!loaded} onClick={() => editTags(!editing)}><Icon name="tag"/></button>
        <a class="icon-button" href={post.url} target="_blank" rel="noopener noreferrer" aria-label={tr("元投稿を開く")} title={tr("元投稿を開く")}><Icon name="external"/></a>
      </div></div>
      <span class="partial-label">{tr("X · 画面に表示された範囲")}</span>
      {editing && <div class="tag-editor"><label>{tr("タグ（カンマ区切り）")}<input aria-label={tr('{handle}のタグ', { handle: post.authorHandle })} value={tagText} disabled={saving} onInput={e => { setTagText(e.currentTarget.value); setTagNotice(''); }}/></label>
        {availableTags.some(t => t.accountId === post.accountId && !t.mark) && <div class="tag-picker"><label>{tr("登録済みタグを選択")}<input type="search" aria-label={tr("登録済みタグを検索")} placeholder={tr("タグの名前で絞り込み")} value={tagSearch} maxLength={100} onInput={e => setTagSearch(e.currentTarget.value)}/></label><div class="tag-options">{candidates.slice(0, 100).map(t => <button class="tag-option" key={t.id} title={t.name} aria-label={tr('{name}を選択', { name: t.name })} aria-pressed={tagNames.includes(t.name)} disabled={saving} onClick={() => chooseTag(t.name)}>{tagNames.includes(t.name) && <Icon name="check"/>}{t.name}</button>)}</div>{!candidates.length && <p class="small muted">{tr("一致するタグがありません。")}</p>}{candidates.length > 100 && <p class="small muted">{tr("先頭100個を表示しています。名前で絞り込んでください。")}</p>}<p class="small muted">{tr("選択後に「タグを保存」で反映します。")}</p></div>}
        <div class="actions"><button class="primary small-button" onClick={saveTags} disabled={saving}>{saving ? tr("保存中…") : tr("タグを保存")}</button><button class="small-button" onClick={() => editTags(false)} disabled={saving}>{tr("閉じる")}</button></div>{tagNotice && <span class="small muted" role="status">{message(tagNotice)}</span>}</div>}
      {error && <p class="error" role="alert">{message(error)}</p>}
    </div>
  </article>;
}

function PostDialog({ post, previews, tags, error, revision, mediaIndex, onChange, onTag, onClose }: {
  post: Post; previews: boolean; tags: Tag[]; error: string; revision: number; mediaIndex: number; onChange(): void; onTag(id: string): void; onClose(): void;
}) {
  const { t: tr, message } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} class="post-dialog" aria-label={tr("投稿の詳細")} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
    <header class="dialog-header"><strong>{tr("投稿の詳細")}</strong><button class="icon-button" aria-label={tr("詳細を閉じる")} onClick={() => dialog.current?.close()}><Icon name="close"/></button></header>
    {error && <p class="error" role="alert">{message(error)}</p>}
    <PostCard post={post} previews={previews} availableTags={tags} revision={revision} mediaIndex={mediaIndex} onChange={onChange} onTag={onTag} expanded/>
  </dialog>;
}

function nextDay(date: string) {
  const day = new Date(`${date}T00:00:00`); day.setDate(day.getDate() + 1); return day.toISOString();
}

function Library({ source, onSource }: { source: LibrarySource; onSource(source: LibrarySource): void }) {
  const db = useLibraryDB();
  const likes = source === 'likes';
  const { language, preference, t: tr, message } = useI18n();
  const aiJob = useAiJob(source); const aiConfig = useDecisionConnection();
  const [view, setView] = useState<View>('all'); const [accounts, setAccounts] = useState<Account[]>([]); const [accountId, setAccountId] = useState('');
  const [query, setQuery] = useState(''); const [search, setSearch] = useState('');
  const [openedMedia, setOpenedMedia] = useState(0);
  const [openedPost, setOpenedPost] = useState<Post | null>(null); const [openError, setOpenError] = useState('');
  const [author, setAuthor] = useState(''); const [authorSearch, setAuthorSearch] = useState('');
  const [mediaFilter, setMediaFilter] = useState('all'); const [markFilter, setMarkFilter] = useState('all'); const [linkFilter, setLinkFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState(''); const [dateTo, setDateTo] = useState(''); const [legacyFavorite, setLegacyFavorite] = useState(false);
  const [tagId, setTagId] = useState(''); const [readFilter, setReadFilter] = useState('all'); const [sort, setSort] = useState<'newest' | 'oldest' | PostDateOrder>('newest');
  const [loadedKey, setLoadedKey] = useState(''); const [loadedStart, setLoadedStart] = useState(0); const [total, setTotal] = useState(0); const [posts, setPosts] = useState<Post[]>([]);
  const [meta, setMeta] = useState<Metadata>({ total: 0, unmarked: 0, unread: 0, favorites: 0, tags: [] });
  const [run, setRun] = useState<ImportRun>(); const [error, setError] = useState(''); const [notice, setNotice] = useState<UIMessage>('');
  const [pending, setPending] = useState<CollectionBackup[] | null>(null); const [restoring, setRestoring] = useState(false); const [refresh, setRefresh] = useState(0); const [restoreRevision, setRestoreRevision] = useState(0);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [selecting, setSelecting] = useState(false); const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletion, setDeletion] = useState<DeletionPlan | null>(null); const [preparing, setPreparing] = useState(false);
  const [columns, setColumns] = useState(3); const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [theme, setTheme] = useState<Theme>(initialTheme); const [previews, setPreviews] = useState(false); const searchInput = useRef<HTMLInputElement>(null);
  const gallery = ['all', 'unread', 'unmarked'].includes(view);
  const listKey = JSON.stringify([source, view, accountId, search, readFilter, tagId, sort, authorSearch, mediaFilter, markFilter, linkFilter, dateFrom, dateTo, legacyFavorite]);
  const feed = usePostFeed({ total, resetKey: listKey, columns, layout, previews, ready: loadedKey === listKey, loadedStart });
  const visiblePosts = feed.ready ? posts : [];
  const markTags = orderedMarks(meta.tags);
  const rangeError = dateFrom && dateTo && dateFrom > dateTo;
  const filtered = !!(accountId || author || tagId || readFilter !== 'all' || view === 'unread' || view === 'unmarked' || mediaFilter !== 'all' || markFilter !== 'all' || linkFilter !== 'all' || dateFrom || dateTo || legacyFavorite);
  const selectedTag = meta.tags.find(t => t.id === tagId);
  const bump = () => setRefresh(n => n + 1);
  useEffect(() => { setSelected(new Set()); }, [view, accountId, query, feed.start, readFilter, tagId, sort, author, mediaFilter, markFilter, linkFilter, dateFrom, dateTo, legacyFavorite]);
  function selectPost(post: Post, checked: boolean) {
    setSelected(current => { const next = new Set(current); const key = selectionKey([post.accountId, post.postId]); if (checked) next.add(key); else next.delete(key); return next; });
  }
  async function confirmDeletion(scope: DeletionPlan['scope']) {
    if (preparing || scope === 'selected' && !feed.ready) return;
    setPreparing(true); setError(''); setNotice('');
    try {
      const keys: [string, string][] = posts.filter(post => selected.has(selectionKey([post.accountId, post.postId]))).map(post => [post.accountId, post.postId]);
      setDeletion(await prepareDeletion(scope, keys, db));
    } catch (e) { setError(e instanceof Error ? e.message : '投稿を削除できませんでした'); }
    finally { setPreparing(false); }
  }
  function deleted(count: number) {
    setDeletion(null); setSelected(new Set()); setOpenedPost(null); setError('');
    setNotice({ key: '{count}件の投稿を削除しました', params: { count } }); bump();
  }
  async function openPost(post: Post, mediaIndex = 0) {
    setOpenError('');
    try { await markPostRead(post.accountId, post.postId, db); }
    catch { setOpenError('既読状態を保存できませんでした'); }
    setOpenedMedia(mediaIndex); setOpenedPost(post); bump();
  }
  useEffect(() => {
    void settingsDB.settings.bulkGet(['columns', 'theme', 'previews', 'layout']).then(([c, t, p, l]) => {
      if (typeof c?.value === 'number' && Number.isInteger(c.value) && c.value >= 1 && c.value <= 5) setColumns(c.value);
      if (t?.value === 'dark' || t?.value === 'light') setTheme(t.value);
      setPreviews(p ? p.value === true : DEFAULT_DISPLAY_SETTINGS.previews);
      if (l?.value === 'grid' || l?.value === 'list') setLayout(l.value);
    }).catch(() => setError('表示設定を読み込めません'));
  }, []);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { const timer = setTimeout(() => { setAuthorSearch(author); }, 250); return () => clearTimeout(timer); }, [author]);
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); }, 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === '/' && !(event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]'))) { event.preventDefault(); searchInput.current?.focus(); }
    }; window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    let active = true; let request = 0;
    const load = async () => {
      const ticket = ++request;
      const [result, metadata, settings, latest] = await Promise.all([
        windowPosts(accountId, search, feed.start, 50, { favorite: legacyFavorite, read: view === 'unread' ? false : readFilter === 'all' ? undefined : readFilter === 'read', tagId: tagId || undefined, oldestFirst: sort === 'oldest', postedOrder: isPostDateOrder(sort) ? sort : undefined, author: authorSearch, media: mediaFilter === 'all' ? undefined : mediaFilter as 'with' | 'without' | 'image' | 'video', mark: view === 'unmarked' ? 'without' : markFilter === 'all' ? undefined : markFilter as 'with' | 'without', links: linkFilter === 'all' ? undefined : linkFilter === 'with', postedFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined, postedBefore: dateTo ? nextDay(dateTo) : undefined }, db),
        libraryMetadata(accountId, db), db.settings.get('accounts'), db.importRuns.orderBy('startedAt').reverse().first(),
      ]);
      if (active && ticket === request) {
        setLoadedKey(listKey); setLoadedStart(feed.start); setPosts(result.rows); setTotal(result.total); setMeta(metadata); setAccounts((settings?.value ?? []) as Account[]); setRun(latest);
        const visible = new Set(result.rows.map(post => selectionKey([post.accountId, post.postId])));
        setSelected(current => [...current].some(key => !visible.has(key)) ? new Set([...current].filter(key => visible.has(key))) : current);
      }
    };
    void load().catch(() => { if (active) setError('保存データを読み込めません'); });
    const timer = setInterval(() => { if (!document.hidden) void load().catch(() => {}); }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [accountId, search, feed.start, refresh, view, readFilter, tagId, sort, authorSearch, mediaFilter, markFilter, linkFilter, dateFrom, dateTo, legacyFavorite]);
  function navigate(next: View) { setView(next); setTagId(''); setReadFilter('all'); setMarkFilter('all'); setNotice(''); }
  function filterTag(id: string) { setView('all'); setTagId(id); setMarkFilter('all'); setReadFilter('all'); }
  function resetFilters() { setAccountId(''); setAuthor(''); setTagId(''); setReadFilter('all'); setMarkFilter('all'); setMediaFilter('all'); setLinkFilter('all'); setDateFrom(''); setDateTo(''); setLegacyFavorite(false); setView('all'); }
  async function setting(key: string, value: unknown) {
    try { await settingsDB.settings.put({ key, value }); return true; } catch { setError('表示設定を保存できません'); return false; }
  }
  async function changeTheme() { if (settingsBusy) return; const next = theme === 'dark' ? 'light' : 'dark'; if (await setting('theme', next)) setTheme(next); }
  function applyImportedSettings(settings: DisplaySettings) {
    applyTheme(settings.theme); setTheme(settings.theme); setColumns(settings.columns); setLayout(settings.layout); setPreviews(settings.previews);
  }
  const [exportFiles, setExportFiles] = useState<BackupFile[]>([]);
  const fileSelection = useRef(0);
  async function backup() {
    setError(''); setNotice(''); setExportFiles([]);
    try {
      const value = await createBackup(db); const files = downloadPostBackup(value); setExportFiles(files.length > 1 ? files : []);
      setNotice(files.length > 1 ? { key: '{count}件を{files}ファイルに分割しました。すべて保存してください。', params: { count: value.posts.length, files: files.length } } : { key: '{count}件をJSONに書き出しました', params: { count: value.posts.length } });
      if (files.length > 1 && deletion) setDeletion(null);
      return files.length === 1;
    } catch (e) { setError(e instanceof Error ? e.message : 'バックアップを書き出せません'); return false; }
  }
  async function exportPosts(markId: string | null) {
    setError(''); setNotice(''); setExportFiles([]);
    if (markId === null) return backup();
    try {
      const value = await createMarkedBackup(markId, db);
      const mark = value.tags.find(tag => tag.id === markId)!;
      const files = downloadPostBackup(value, mark.name); setExportFiles(files.length > 1 ? files : []);
      setNotice(files.length > 1 ? { key: '{count}件を{files}ファイルに分割しました。すべて保存してください。', params: { count: value.posts.length, files: files.length } } : { key: '「{mark}」の{count}件をJSONに書き出しました', params: { mark: mark.name, count: value.posts.length } });
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'バックアップを書き出せません'); return false; }
  }
  async function chooseFiles(files: File[]) {
    const ticket = ++fileSelection.current; setPending(null); setError(''); if (!files.length) return;
    try {
      if (files.length > 10000) throw new Error('バックアップの件数が範囲外です');
      const backups: CollectionBackup[] = [];
      for (const file of files) {
        if (file.size > BACKUP_MAX_BYTES) throw new Error('JSONファイルは20MBまでです');
        backups.push(validateCollectionBackup(JSON.parse(await file.text()), source));
      }
      verifyBackupParts(backups);
      if (ticket === fileSelection.current) setPending(backups);
    } catch (e) { if (ticket === fileSelection.current) setError(e instanceof Error ? e.message : 'JSONファイルを検証できません'); }
  }
  async function restore() {
    if (!pending) return; setRestoring(true); setError('');
    try {
      const result = await restoreBackups(pending, db); setNotice({ key: '新規{added}件、既存{existing}件を復元しました。既存の既読・マーク・タグは保護しています。', params: result });
      setPending(null); setRestoreRevision(n => n + 1); bump();
    } catch (e) { setError(e instanceof Error ? e.message : '復元に失敗しました'); }
    finally { setRestoring(false); }
  }
  const { locations: importLocations } = useImportLocations();
  const importHandle = accountId ? accounts.find(account => account.id === accountId)?.handle : accounts.length === 1 ? accounts[0]?.handle : undefined;
  const importUrl = importSourceUrl(source, importLocations, importHandle);
  const counts: Partial<Record<View, number>> = { all: meta.total, unmarked: meta.unmarked, unread: meta.unread };
  function tagLabel(tag: Tag) { return !accountId && meta.tags.some(t => t.id !== tag.id && t.name === tag.name) ? `${tag.name} · @${accounts.find(a => a.id === tag.accountId)?.handle ?? tr("別アカウント")}` : tag.name; }
  return <><div class="library-layout">
    <aside class="sidebar">
      <button class="brand" onClick={() => navigate('all')}><span class="brand-mark"><BrandMark/></span><span>xbookmarkshelf<small>FOR X · LOCAL FIRST</small></span></button>
      <div class="library-source-switch" role="group" aria-label={tr('ライブラリ切替')}>{(['bookmarks', 'likes'] as const).map(value => <button key={value} aria-pressed={source === value} disabled={restoring || preparing || settingsBusy || !!pending} onClick={() => onSource(value)}><Icon name={value === 'likes' ? 'heart' : 'bookmark'}/>{tr(value === 'likes' ? 'いいね' : 'ブックマーク')}</button>)}</div>
      <nav class="side-nav" aria-label={tr("ライブラリ")}><span class="nav-caption">{tr("ライブラリ")}</span>{NAV.map(item => <button key={item.view} class={`nav-item ${view === item.view && !tagId ? 'active' : ''}`} aria-label={item.view === 'auto-mark' ? tr(item.label) : undefined} aria-current={view === item.view && !tagId ? 'page' : undefined} onClick={() => navigate(item.view)}><Icon name={item.view === 'all' && likes ? 'heart' : item.icon}/><span>{tr(item.view === 'all' && likes ? 'すべてのいいね' : item.label)}</span><span class={`nav-count ${item.view === 'auto-mark' ? 'ai-nav-status' : ''}`} role={item.view === 'auto-mark' && aiJob?.state === 'running' ? 'status' : undefined}>{item.view === 'auto-mark' && aiJob?.state === 'running' ? aiText(language, 'active') : counts[item.view]}</span></button>)}</nav>
      <div class="side-tags side-marks"><button class={`mark-section-heading ${view === 'marks' ? 'active' : ''}`} aria-label={tr("マークを管理")} aria-current={view === 'marks' ? 'page' : undefined} onClick={() => navigate('marks')}><span>{tr("マーク")}</span><span class="mark-section-add"><Icon name="plus"/></span></button>{markTags.length ? markTags.map(t => <button class={`nav-item ${tagId === t.id ? 'active' : ''}`} key={t.id} onClick={() => filterTag(t.id)} title={tagLabel(t)}><Icon name={t.mark!}/><span class="nav-text">{tagLabel(t)}</span><span class="nav-count">{t.count}</span></button>) : <p class="sidebar-hint sidebar-more">{tr("まだ登録されていません")}</p>}</div>
      <nav class="side-nav tools-nav" aria-label={tr("管理")}><span class="nav-caption">{tr("管理")}</span>{([{ view: 'import', icon: 'download' }, { view: 'backup', icon: 'upload' }, { view: 'settings', icon: 'settings' }] as const).map(item => <button class={`nav-item ${view === item.view ? 'active' : ''}`} key={item.view} aria-current={view === item.view ? 'page' : undefined} onClick={() => navigate(item.view)}><Icon name={item.icon}/><span>{tr(TITLES[item.view])}</span></button>)}</nav>
      <div class="sidebar-footer"><span class="local-status"><Icon name="lock"/>{tr("データはブラウザ内に保存")}</span><span class="version">v0.1.0</span></div>
    </aside>
    <div class="workspace"><header class="topbar"><label class="search-bar"><Icon name="search"/><input ref={searchInput} type="search" aria-label={tr("本文・投稿者を検索")} placeholder={tr("本文・投稿者を検索")} value={query} maxLength={500} onInput={e => { setQuery(e.currentTarget.value); if (!gallery) setView('all'); }}/><kbd>/</kbd></label><div class="topbar-actions"><button class="icon-button" aria-label={theme === 'dark' ? tr("ライトモードに切り替える") : tr("ダークモードに切り替える")} title={tr("表示テーマ")} disabled={settingsBusy} onClick={changeTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'}/></button><button class="icon-button" aria-label={tr("全件JSONバックアップ")} title={tr("全件JSONバックアップ")} onClick={backup}><Icon name="download"/></button><span class="local-avatar" title={tr("ローカルライブラリ")}>X</span></div></header>
      <main class="library-main"><BackupDownloads files={exportFiles} label={tr('分割ファイルをすべて保存してください。復元時はまとめて選択します。')}/><div class="page-heading"><div><h1>{selectedTag ? selectedTag.name : tr(view === 'all' && likes ? 'すべてのいいね' : TITLES[view])}</h1>{gallery && <p class="muted">{tr(likes ? '{count}件のいいね' : '{count}件のブックマーク', { count: total })}</p>}</div>{gallery && <a class="primary button-link" href={importUrl} target="_blank" rel="noopener noreferrer"><Icon name="plus"/>{tr("取り込む")}</a>}</div>
        {error && <p class="error" role="alert">{message(error)}</p>}{notice && <p class="notice" role="status">{message(notice)}</p>}
        {run?.state === 'running' && <div class="run-banner"><span class="status-dot"/><strong>{tr("取り込み中")}</strong><span>{tr('@{handle} · 新規{added}件 / 既存{existing}件', { handle: run.handle, added: run.added, existing: run.existing })}</span></div>}
        {gallery && <>
          <section class="filter-panel" aria-label={tr("投稿のフィルタ")}><div class="filter-title"><strong><Icon name="search"/>{tr("フィルタ")}</strong><button class="text-button" disabled={!filtered} onClick={resetFilters}>{tr("条件をリセット")}</button></div><div class="filter-fields">
            <label>{tr("アカウント")}<select aria-label={tr("アカウント")} value={accountId} onChange={e => { setAccountId(e.currentTarget.value); setTagId(''); }}><option value="">{tr("すべてのアカウント")}</option>{accounts.map(a => <option key={a.id} value={a.id}>@{a.handle}</option>)}</select></label>
            <label>{tr("投稿者")}<input type="search" aria-label={tr("投稿者")} value={author} maxLength={200} placeholder={tr("@ハンドル または名前")} onInput={e => setAuthor(e.currentTarget.value)}/></label>
            <label>{tr("マーク・タグ")}<select aria-label={tr("マーク・タグ")} value={view === 'unmarked' ? 'without' : tagId ? `tag:${tagId}` : markFilter} onChange={e => { const value = e.currentTarget.value; if (view === 'unmarked' && value !== 'without') setView('all'); setTagId(value.startsWith('tag:') ? value.slice(4) : ''); setMarkFilter(['all', 'with', 'without'].includes(value) ? value : 'all'); }}><option value="all">{tr("すべて")}</option><option value="with">{tr("マークあり")}</option><option value="without">{tr("マークなし")}</option><optgroup label={tr("マーク")}>{markTags.map(t => <option key={t.id} value={`tag:${t.id}`}>{tagLabel(t)}</option>)}</optgroup><optgroup label={tr("タグ")}>{meta.tags.filter(t => !t.mark).slice(0, 100).map(t => <option key={t.id} value={`tag:${t.id}`}>{tagLabel(t)}</option>)}</optgroup></select></label>
            <label>{tr("メディア")}<select aria-label={tr("メディア")} value={mediaFilter} onChange={e => { setMediaFilter(e.currentTarget.value); }}><option value="all">{tr("すべて")}</option><option value="with">{tr("メディアあり")}</option><option value="without">{tr("メディアなし")}</option><option value="image">{tr("画像あり")}</option><option value="video">{tr("動画あり")}</option></select></label>
            <label>{tr("既読状態")}<select aria-label={tr("既読状態")} value={view === 'unread' ? 'unread' : readFilter} onChange={e => { setReadFilter(e.currentTarget.value); if (view === 'unread') setView('all'); }}><option value="all">{tr("すべて")}</option><option value="unread">{tr("未読のみ")}</option><option value="read">{tr("既読のみ")}</option></select></label>
            <label>{tr("本文URL")}<select aria-label={tr("本文URL")} value={linkFilter} onChange={e => { setLinkFilter(e.currentTarget.value); }}><option value="all">{tr("すべて")}</option><option value="with">{tr("URLあり")}</option><option value="without">{tr("URLなし")}</option></select></label>
            <label>{tr("投稿日（開始）")}<input type="date" value={dateFrom} onInput={e => { setDateFrom(e.currentTarget.value); }}/></label>
            <label>{tr("投稿日（終了）")}<input type="date" value={dateTo} onInput={e => { setDateTo(e.currentTarget.value); }}/></label>
            {meta.favorites > 0 && <label>{tr("以前のお気に入り")}<select aria-label={tr("以前のお気に入り")} value={legacyFavorite ? 'favorite' : 'all'} onChange={e => { setLegacyFavorite(e.currentTarget.value === 'favorite'); }}><option value="all">{tr("絞り込みなし")}</option><option value="favorite">{tr("以前のお気に入りのみ")}</option></select></label>}
          </div>{rangeError && <p class="error" role="alert">{tr("開始日は終了日以前にしてください。")}</p>}{selectedTag && <button class="filter-chip" title={selectedTag.name} onClick={() => { setTagId(''); }}><Icon name={selectedTag.mark || 'tag'}/>{selectedTag.name}<Icon name="close"/></button>}</section>
          <div class="toolbar"><span class="muted small">{markTags.length ? tr("アイコンをクリックしてマークを付与・解除") : <button class="text-button" onClick={() => navigate('marks')}>{tr("マークを登録して仕分ける")}</button>}</span>
            <div class="display-controls"><label class="sr-only" for="sort-order">{tr("並び順")}</label><select id="sort-order" value={sort} onChange={e => setSort(e.currentTarget.value as typeof sort)}><option value="newest">{tr("新しく保存した順")}</option><option value="oldest">{tr("古く保存した順")}</option><option value="posted-newest">{tr("投稿日が新しい順")}</option><option value="posted-oldest">{tr("投稿日が古い順")}</option></select><label class="sr-only" for="display-columns">{tr("表示列数")}</label><select class="columns-select" id="display-columns" value={columns} disabled={settingsBusy || layout === 'list'} onChange={async e => { const value = Number(e.currentTarget.value); if (await setting('columns', value)) setColumns(value); }}>{[1, 2, 3, 4, 5].map(n => <option value={n} key={n}>{tr('{count}列', { count: n })}</option>)}</select><div class="view-switch"><button class="icon-button" aria-label={tr("カード表示")} aria-pressed={layout === 'grid'} disabled={settingsBusy} onClick={async () => { if (await setting('layout', 'grid')) setLayout('grid'); }}><Icon name="grid"/></button><button class="icon-button" aria-label={tr("リスト表示")} aria-pressed={layout === 'list'} disabled={settingsBusy} onClick={async () => { if (await setting('layout', 'list')) setLayout('list'); }}><Icon name="list"/></button></div></div>
          </div>
          <div class="selection-toolbar"><button disabled={preparing} aria-pressed={selecting} onClick={() => { setSelecting(value => !value); setSelected(new Set()); }}>{selecting ? tr('選択を終了') : tr('投稿を選択')}</button>
            {selecting && <><label class="selection-label"><input type="checkbox" checked={!!visiblePosts.length && selected.size === visiblePosts.length} disabled={!visiblePosts.length || preparing} ref={input => { if (input) input.indeterminate = selected.size > 0 && selected.size < visiblePosts.length; }} onChange={event => setSelected(event.currentTarget.checked ? new Set(visiblePosts.map(post => selectionKey([post.accountId, post.postId]))) : new Set())}/>{tr('表示中をすべて選択')}</label><span class="muted small">{tr('{count}件選択中', { count: selected.size })}</span><button class="danger" disabled={!selected.size || !feed.ready || preparing || run?.state === 'running'} onClick={() => confirmDeletion('selected')}>{tr('選択した投稿を削除')}</button></>}
          </div>
          {total ? <PostFeed feed={feed} loading={tr("投稿を読み込んでいます…")}>{posts.map(post => <PostCard key={`${post.accountId}:${post.postId}:${restoreRevision}`} post={post} previews={previews} availableTags={meta.tags} revision={refresh} onChange={bump} onTag={filterTag} onOpen={openPost} selected={selected.has(selectionKey([post.accountId, post.postId]))} onSelect={selecting ? checked => selectPost(post, checked) : undefined}/>)}</PostFeed> : <section class="empty"><span class="empty-icon"><Icon name={meta.total ? 'search' : 'bookmark'}/></span><h2>{meta.total || search || tagId ? tr("一致する投稿がありません") : tr(likes ? "最初のいいねを取り込もう" : "最初のブックマークを取り込もう")}</h2><p>{meta.total || search || tagId ? tr("検索キーワードや絞り込み条件を変えてみてください。") : tr(likes ? "XのLikesを開き、拡張アイコンから取り込めます。\n保存した投稿は、オフラインでも読めます。" : "XのBookmarksを開き、拡張アイコンから取り込めます。\n保存した投稿は、オフラインでも読めます。")}</p>{!meta.total && <a class="button-link" href={importUrl} target="_blank" rel="noopener noreferrer">{tr(likes ? "Xのいいねを開く" : "Xのブックマークを開く")}<Icon name="external"/></a>}</section>}
        </>}
        {view === 'marks' && <MarkManager accounts={accounts} tags={meta.tags} selectedAccount={accountId} onChange={bump} onOpen={filterTag}/>}
        {view === 'auto-mark' && <AiPage language={language} source={tr(likes ? 'いいね' : 'ブックマーク')} total={meta.total} note={aiText(language, 'accountScopeNote')} connected={!!aiConfig} openSettings={() => navigate('settings')}
          scope={<select aria-label={tr('アカウント')} value={accountId} disabled={aiJob?.state === 'running'} onChange={e => setAccountId(e.currentTarget.value)}><option value="">{tr('すべてのアカウント')}</option>{accounts.map(a => <option key={a.id} value={a.id}>@{a.handle}</option>)}</select>}>
          <ExtensionAiControls source={source} accountId={accountId} disabled={!meta.total || loadedKey !== listKey || run?.state === 'running'}/>
        </AiPage>}
        {view === 'import' && <section class="panel import-panel"><span class="panel-symbol"><Icon name="download"/></span><p class="muted">{tr(likes ? "XのHistoryでLikesを選ぶか、自分のいいね画面を開き、拡張アイコンを押してください。最大10件ずつ保存します。" : "XのHistoryでBookmarksを選び、ツールバーの拡張アイコンを押してください。最大10件ずつ保存し、次の読み取りへ進みます。")}</p><a class="primary button-link" href={importUrl} target="_blank" rel="noopener noreferrer">{tr(likes ? "XのLikesを開く" : "XのBookmarksを開く")}<Icon name="external"/></a><p class="small muted">{tr("既定は3秒待機・100件まで。Xのタブを表示したまま使います。")}</p>{run && <div class="run-summary"><ExtensionImportAiStatus source={source} runId={run.id}/><strong>{run.state === 'running' ? tr("取り込み中") : run.reason ? tr(REASON_LABELS[run.reason]) : tr("終了")}</strong>{run.reason === 'run_limit' && <p>{tr("設定した上限まで保存しました。")}</p>}<p>{tr('@{handle} · 新規{added}件 / 既存{existing}件', { handle: run.handle, added: run.added, existing: run.existing })}</p></div>}</section>}
        {view === 'backup' && <div class="settings-stack"><p class="muted">{tr(likes ? "いいねの投稿データを扱います。" : "ブックマークの投稿データを扱います。")}</p><PostBackupExport onExport={exportPosts}/><section class="panel restore"><h2>{tr("JSONから復元")}</h2><p class="muted">{tr("バックアップを検証して取り込みます。既存の既読とマーク設定を優先し、タグと関連を統合します。")}</p><input type="file" multiple accept=".json,application/json" aria-label={tr("復元するJSON")} disabled={restoring} onChange={e => { void chooseFiles(Array.from(e.currentTarget.files ?? [])); e.currentTarget.value = ''; }}/>{pending && <div class="restore-preview"><strong>{tr('{posts}件 · {accounts}アカウント', { posts: pending.reduce((count, part) => count + part.posts.length, 0), accounts: new Set(pending.flatMap(part => part.accounts.map(a => a.handle))).size })}</strong><div class="actions"><button class="primary" onClick={restore} disabled={restoring}>{restoring ? tr("復元中…") : tr("検証済みJSONを復元")}</button><button disabled={restoring} onClick={() => setPending(null)}>{tr("キャンセル")}</button></div></div>}<p class="small muted">{tr(likes ? "いいねのJSONバックアップv1に対応。ファイルは20MBまでです。" : "この拡張のJSON形式に対応。v1/v2を読み込めます。書き出しはv2、ファイルは20MBまでです。")}</p></section></div>}
        {view === 'settings' && <div class="settings-stack"><section class="panel"><h2>{tr("表示設定")}</h2><div class="setting-row"><div><strong>{tr("言語")}</strong><p class="muted">{tr("画面の表示言語を選びます。投稿本文やマーク・タグ名は変わりません。")}</p><p class="muted">{tr("システムに従う場合、Chromeの表示言語が日本語なら日本語、それ以外は英語で表示します。")}</p></div><select aria-label={tr("言語")} value={preference} disabled={settingsBusy} onChange={async e => { const value = e.currentTarget.value; if (isLanguagePreference(value)) await setting('language', value); }}><option value="system">{tr("システムに従う")}</option><option value="ja">{tr("日本語")}</option><option value="en">English</option></select></div><div class="setting-row"><div><strong>{tr("表示テーマ")}</strong><p class="muted">{tr("ライト / ダーク")}</p></div><button disabled={settingsBusy} onClick={changeTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'}/>{theme === 'dark' ? tr("ライトに切り替え") : tr("ダークに切り替え")}</button></div><div class="setting-row"><div><strong>{tr("画像プレビュー")}</strong><p class="muted">{tr("投稿画像とリンク先のサムネイルを表示します。オンにするとXの画像サーバー（pbs.twimg.com）に接続します。画像本体の保存・動画再生は行いません。")}</p></div><label class="switch-label"><input type="checkbox" aria-label={tr("画像プレビューを表示")} disabled={settingsBusy} checked={previews} onChange={async e => { const value = e.currentTarget.checked; if (await setting('previews', value)) setPreviews(value); }}/><span>{previews ? tr("オン") : tr("オフ")}</span></label></div><div class="setting-row"><div><strong>{tr("ローカル保存")}</strong><p class="muted">{tr("このChromeのプロファイルに保存します。大切な投稿はJSONでもバックアップしてください。")}</p></div><Icon name="lock"/></div></section><ImportLocationSettings disabled={settingsBusy}/><DataManagement onDeleteAll={() => confirmDeletion('all')} onBackup={backup} disabled={preparing || settingsBusy}/><SettingsTransfer onApplied={applyImportedSettings} onBusyChange={setSettingsBusy}/><ExtensionAiSettings/></div>}
      </main>
    </div>
  </div>
    {openedPost && <PostDialog key={`${openedPost.accountId}:${openedPost.postId}`} post={openedPost} previews={previews} tags={meta.tags} error={openError} revision={refresh} mediaIndex={openedMedia} onChange={bump} onTag={id => { setOpenedPost(null); filterTag(id); }} onClose={() => { setOpenedPost(null); bump(); }}/>}
    {deletion && <DeletePostsDialog plan={deletion} onDeleted={deleted} onClose={() => setDeletion(null)} onBackup={backup}/>}
  </>;
}
function App() {
  const initial = new URL(location.href).searchParams.get('source');
  const [source, setSource] = useState<LibrarySource>(isLibrarySource(initial) ? initial : 'bookmarks');
  function switchSource(value: LibrarySource) {
    const url = new URL(location.href); url.searchParams.set('source', value); history.replaceState(null, '', url);
    setSource(value);
  }
  return <LanguageProvider><LibraryStore.Provider value={storeForSource(source)}><Library key={source} source={source} onSource={switchSource}/></LibraryStore.Provider></LanguageProvider>;
}
render(<App/>, document.getElementById('app')!);
