import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';
import { textLinks } from './text';
import type { ViewerPost } from './viewer-data';
import type { ViewerMessage } from './viewer-messages';
import { QuoteContent } from './quote-content';

export type Translate = (key: ViewerMessage) => string;
function LinkedText({ text }: { text: string }) {
  const parts = []; let end = 0;
  for (const link of textLinks(text)) {
    parts.push(text.slice(end, link.start), <a key={link.start} href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>);
    end = link.end;
  }
  parts.push(text.slice(end)); return <>{parts}</>;
}
function Preview({ url, enabled, tr }: { url: string; enabled: boolean; tr: Translate }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url, enabled]);
  return enabled && !failed ? <img src={url} alt={tr('image')} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> :
    <div class="media-placeholder"><Icon name="image"/><span>{tr(failed ? 'imageFailed' : 'imageOff')}</span></div>;
}
export function PostCard({ post, expanded = false, initialIndex = 0, previews, tr, locale, open, tag, actions, readAction, annotation }: {
  post: ViewerPost; expanded?: boolean; initialIndex?: number; previews: boolean; tr: Translate; locale: string;
  open(post: ViewerPost, index?: number): void; tag(id: string): void;
  actions?: ComponentChildren; readAction?: ComponentChildren; annotation?: ComponentChildren;
}) {
  const [selected, setIndex] = useState(initialIndex);
  const index = Math.max(0, Math.min(selected, post.media.length - 1)); const media = post.media[index];
  useEffect(() => { setIndex(initialIndex); }, [post.key, initialIndex]);
  useEffect(() => { setIndex(current => Math.max(0, Math.min(current, post.media.length - 1))); }, [post.media.length]);
  return <article class="post-card" data-post-key={post.key}>
    {media && <div class="card-media" role="region" aria-label={tr('media')} tabIndex={post.media.length > 1 ? 0 : undefined} onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); setIndex(Math.max(0, Math.min(post.media.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1))));
      }
    }}>
      {expanded ? <div class="media-frame"><Preview key={media.url} url={media.url} enabled={previews} tr={tr}/></div> :
        <button class="media-frame" aria-label={`${tr('enlargeMedia')} ${index + 1} / ${post.media.length}`} onClick={() => open(post, index)}><Preview key={media.url} url={media.url} enabled={previews} tr={tr}/></button>}
      {post.media.length > 1 && <><span class="media-count" aria-live="polite" aria-atomic="true">{index + 1} / {post.media.length}</span>
        <button class="media-prev" aria-label={tr('previousMedia')} disabled={index === 0} onClick={() => setIndex(index - 1)}><Icon name="chevron"/></button>
        <button class="media-next" aria-label={tr('nextMedia')} disabled={index === post.media.length - 1} onClick={() => setIndex(index + 1)}><Icon name="chevron"/></button></>}
      {media.kind === 'video' && <a class="video-action" href={post.url} target="_blank" rel="noopener noreferrer"><Icon name="play"/>{tr('videoOnX')}</a>}
    </div>}
    <div class="card-content">
      <div class="post-head"><span class="author-avatar">{(post.authorName || post.authorHandle || 'X').slice(0, 1).toUpperCase()}</span>
        <div class="author-info"><strong>{post.authorName || (post.authorHandle ? `@${post.authorHandle}` : tr('noAuthor'))}</strong>
          {post.authorHandle && <span>@{post.authorHandle}</span>}</div>
        <a class="icon-button" aria-label={tr('originalPost')} href={post.url} target="_blank" rel="noopener noreferrer"><Icon name="external"/></a>
      </div>
      {actions}
      {(post.text || !post.quote) && (expanded ? <p class="post-body"><LinkedText text={post.text || tr('noText')}/></p> :
        <button class="viewer-post-summary" aria-label={tr('detail')} onClick={() => open(post)}>{post.text.slice(0, 1500) || tr('noText')}</button>)}
      {post.quote && <QuoteContent quote={post.quote} expanded={expanded} previews={previews} label={tr('quote')} openLabel={tr('openQuote')} onOpen={() => open(post)}/>}
      {post.linkCards.length > 0 && <div class="link-cards">{post.linkCards.map(card => <a key={card.url} class="link-card" href={card.url} target="_blank" rel="noopener noreferrer">
        <div class="link-card-image"><Preview url={card.imageUrl} enabled={previews} tr={tr}/></div>
        <div class="link-card-caption"><span>{new URL(card.url).hostname}<Icon name="external"/></span><strong>{card.title || card.url}</strong></div>
      </a>)}</div>}
      <div class="tag-chips">{post.tags.slice(0, 20).map(t => <button key={t.id} class="tag-chip" title={t.name} onClick={() => tag(t.id)}>{t.mark && <Icon name={t.mark}/>} {t.name}</button>)}</div>
      <div class="card-footer"><span class="post-date">{post.postedAt ? new Date(post.postedAt).toLocaleDateString(locale) : ''}</span>
        {readAction ?? <span class="small muted">{post.read !== null && <><Icon name={post.read ? 'check' : 'unread'}/> {tr(post.read ? 'readYes' : 'readNo')}</>}</span>}
      </div>
      {annotation}
    </div>
  </article>;
}
export function Detail({ post, initialIndex = 0, previews, tr, locale, close, tag, actions, readAction, annotation, editor }: { post: ViewerPost; initialIndex?: number; previews: boolean; tr: Translate; locale: string; close(): void; tag(id: string): void;
  actions?: ComponentChildren; readAction?: ComponentChildren; annotation?: ComponentChildren; editor?: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} class="post-dialog" aria-label={tr('detail')} onClose={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div class="dialog-header"><strong>{tr('detail')}</strong><button autoFocus class="icon-button" aria-label={tr('closeDetail')} onClick={close}><Icon name="close"/></button></div>
    <PostCard post={post} expanded initialIndex={initialIndex} previews={previews} tr={tr} locale={locale} open={() => {}} tag={tag} actions={actions} readAction={readAction} annotation={annotation}/>
    {editor}
  </dialog>;
}
