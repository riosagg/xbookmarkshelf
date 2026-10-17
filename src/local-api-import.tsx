import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LocalDataError, mergeLocalImports, type LocalImport, type LocalLibrary, type LocalSource } from './local-data';
import { convertXApiPages, type XApiPage, type XApiWarnings } from './x-api-import';
import { validHandle } from './model';
import { Icon } from './icons';
import type { LocalMessage, LocalTranslate } from './local-messages';

export interface PendingApiImport { pages: XApiPage[]; imports: LocalImport[]; names: string[] }
export type LocalImportResult = ReturnType<typeof mergeLocalImports>;
type Preview = { result: LocalImportResult; warnings: XApiWarnings } | { error: LocalMessage };
export function LocalApiImport({ library, pending, initialSource, tr, cancel, complete }: {
  library: LocalLibrary; pending: PendingApiImport; initialSource: LocalSource; tr: LocalTranslate;
  cancel: () => void; complete: (result: LocalImportResult) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null); const [source, setSource] = useState(initialSource);
  const [selection, setSelection] = useState(''); const [handle, setHandle] = useState('');
  const [newId] = useState(() => crypto.randomUUID());
  const accounts = library.libraries[source].accounts;
  const normalized = handle.normalize('NFKC').trim().replace(/^@/, '').toLowerCase();
  const account = selection === 'new' ? validHandle(normalized) ? accounts.find(a => a.handle.toLowerCase() === normalized) ?? { id: newId, handle: normalized } : null
    : accounts.find(a => `account:${a.id}` === selection) ?? null;
  const preview = useMemo<Preview | null>(() => {
    if (!account) return null;
    try {
      const converted = convertXApiPages(pending.pages, source, account);
      return { result: mergeLocalImports(library, [...pending.imports, converted.input]), warnings: converted.warnings };
    } catch (error) { return { error: error instanceof LocalDataError ? `${error.code}Error` as LocalMessage : 'recordsError' as const }; }
  }, [library, pending, source, account?.id, account?.handle]);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} class="post-dialog local-api-import" aria-label={tr('apiImport')} onCancel={e => { e.preventDefault(); cancel(); }}>
    <div class="dialog-header"><strong id="api-import-heading">{tr('apiImport')}</strong><button type="button" class="icon-button" aria-label={tr('cancel')} onClick={cancel}><Icon name="close"/></button></div>
    <div class="local-api-body"><p>{tr('apiImportNote')}</p>
      <details class="local-api-files"><summary>{tr('apiFiles')} · {pending.names.length}</summary><ul>{pending.names.map((name, i) => <li key={i}>{name}</li>)}</ul></details>
      {pending.imports.length > 0 && <p class="small muted">{tr('apiMixed')}</p>}
      <div class="local-api-fields"><label>{tr('apiSource')}<select aria-label={tr('apiSource')} autoFocus value={source} onChange={e => { setSource(e.currentTarget.value as LocalSource); setSelection(''); }}>
        <option value="bookmarks">{tr('bookmarks')}</option><option value="likes">{tr('likes')}</option></select></label>
        <label>{tr('apiAccount')}<select aria-label={tr('apiAccount')} value={selection} onChange={e => setSelection(e.currentTarget.value)}><option value="">{tr('apiChooseAccount')}</option>
          {accounts.map(a => <option key={a.id} value={`account:${a.id}`}>{a.handle ? `@${a.handle}` : tr('likesAccount')}</option>)}<option value="new">{tr('apiNewAccount')}</option></select></label></div>
      {selection === 'new' && <label>{tr('apiHandle')}<input aria-label={tr('apiHandle')} value={handle} maxLength={64} autoComplete="off" spellcheck={false} placeholder="@username" onInput={e => setHandle(e.currentTarget.value)}/><span class="small muted">{tr('apiHandleNote')}</span></label>}
      <div class="local-api-preview" aria-live="polite">
        {preview && 'error' in preview && <p class="error" role="alert">{tr(preview.error)}</p>}
        {preview && 'result' in preview && <><p><strong>{tr('added')} {preview.result.added.toLocaleString()} · {tr('existing')} {preview.result.existing.toLocaleString()}</strong></p>
          {(preview.warnings.authors > 0 || preview.warnings.media > 0 || preview.warnings.quotes > 0) && <p class="small muted">{tr('apiMissing')}<br/>{tr('apiMissingAuthors')} {preview.warnings.authors.toLocaleString()} · {tr('unknownMedia')} {preview.warnings.media.toLocaleString()} · {tr('apiMissingQuotes')} {preview.warnings.quotes.toLocaleString()}</p>}
          {preview.warnings.errors > 0 && <p class="small muted">{tr('apiPartialErrors')} {preview.warnings.errors.toLocaleString()}</p>}
          {preview.warnings.more && <p class="small muted">{tr('apiMorePages')}</p>}
        </>}
      </div>
      <p class="small muted">{tr('apiPreserve')}</p><p class="small muted">{tr('saveNote')}</p>
      <div class="actions local-api-actions"><button type="button" onClick={cancel}>{tr('cancel')}</button><button type="button" class="primary" disabled={!preview || !('result' in preview)} onClick={() => { if (preview && 'result' in preview) complete(preview.result); }}>{tr('apiConfirm')}</button></div>
    </div>
  </dialog>;
}
