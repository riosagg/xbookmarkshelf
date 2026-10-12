import { useI18n } from './i18n';
import { useEffect, useState } from 'preact/hooks';
import { type Post, mediaKind, mergeMedia } from './model';
import { Icon } from './icons';

export function MediaGallery({ post, previews, expanded, initialIndex = 0, onOpen }: {
  post: Post; previews: boolean; expanded: boolean; initialIndex?: number; onOpen?(post: Post, index: number): void;
}) {
  const { t: tr } = useI18n();
  const items = mergeMedia(post.media);
  const [selected, setSelected] = useState(initialIndex);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  useEffect(() => { setFailed(new Set()); }, [previews]);
  const index = Math.max(0, Math.min(selected, items.length - 1));
  const item = items[index];
  if (!item) return null;
  const video = mediaKind(item.kind, item.url) === 'video';
  const imageFailed = failed.has(item.url);
  const preview = previews && !imageFailed ? <img key={item.url} src={item.url} alt={tr('{author}の投稿メディア {index} / {total}', { author: post.authorName || post.authorHandle, index: index + 1, total: items.length })} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(current => new Set([...current, item.url]))}/> :
    <div class="media-placeholder"><Icon name={video ? 'play' : 'image'}/><span>{imageFailed ? tr("画像を読み込めませんでした") : tr("画像プレビューはオフ")}</span></div>;
  return <div class="card-media" role="region" aria-label={tr("投稿のメディア")} tabIndex={items.length > 1 ? 0 : undefined} onKeyDown={event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); setSelected(Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1))));
    }
  }}>
    {!expanded && onOpen ? <button class="media-frame" aria-label={tr('メディア {index} / {total}を大きく見る', { index: index + 1, total: items.length })} onClick={() => onOpen(post, index)}>{preview}</button> : <div class="media-frame">{preview}</div>}
    {items.length > 1 && <><span class="media-count" aria-live="polite" aria-atomic="true">{index + 1} / {items.length}</span>
      <button class="media-prev" aria-label={tr("前のメディア")} disabled={index === 0} onClick={() => setSelected(index - 1)}><Icon name="chevron"/></button>
      <button class="media-next" aria-label={tr("次のメディア")} disabled={index === items.length - 1} onClick={() => setSelected(index + 1)}><Icon name="chevron"/></button></>}
    {video && <a class="video-action" href={post.url} target="_blank" rel="noopener noreferrer" title={tr("動画本体は保存していません。Xで再生します。")}><Icon name="play"/>{tr("Xで動画を見る")}</a>}
  </div>;
}
