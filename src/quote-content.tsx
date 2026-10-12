import { useEffect, useState } from 'preact/hooks';
import type { QuotedPost } from './model';
import { isMediaUrl } from './model';
import { textLinks, webUrl } from './text';

function QuoteImage({ url, previews, label }: { url: string; previews: boolean; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url, previews]);
  return previews && !failed && isMediaUrl(url) ? <img src={url} alt={label} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : null;
}
export function QuoteContent({ quote, expanded, previews, label, openLabel, onOpen }: {
  quote: QuotedPost; expanded: boolean; previews: boolean; label: string; openLabel: string; onOpen?(): void;
}) {
  const url = webUrl(quote.url);
  const parts = []; let end = 0;
  for (const link of textLinks(quote.text)) {
    parts.push(quote.text.slice(end, link.start), <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>); end = link.end;
  }
  parts.push(quote.text.slice(end));
  return <section class="quoted-post" aria-label={label}>
    <div class="quote-heading"><span class="quote-badge">{label}</span><strong>{quote.authorName}</strong>{quote.authorHandle && <span>@{quote.authorHandle}</span>}
      {url && <a href={url} target="_blank" rel="noopener noreferrer" aria-label={openLabel}>{openLabel}</a>}</div>
    {quote.text && (expanded ? <p class="quote-body">{parts}</p> : <button class="quote-summary" onClick={onOpen}>{quote.text.slice(0, 1500)}</button>)}
    {previews && quote.media.length > 0 && <div class="quote-media">{quote.media.map(item => <div key={item.url}><QuoteImage url={item.url} previews={previews} label={label}/></div>)}</div>}
    {(quote.linkCards?.length ?? 0) > 0 && <div class="link-cards">{quote.linkCards!.map(card => <a key={card.url} class="link-card" href={webUrl(card.url) ?? undefined} target="_blank" rel="noopener noreferrer">
      <div class="link-card-image"><QuoteImage url={card.imageUrl} previews={previews} label={card.title || label}/></div><div class="link-card-caption"><strong>{card.title || card.url}</strong></div>
    </a>)}</div>}
  </section>;
}
