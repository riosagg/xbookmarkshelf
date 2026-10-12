import { type ObservedPost, type QuotedPost, type LibrarySource, validHandle, isLibraryUrl, isMediaUrl, mergeMedia } from './model';
import { webUrl, appendMissingLinks } from './text';

function anchorUrl(anchor: Element): string | null {
  const raw = anchor.getAttribute('href');
  if (!raw) return null;
  try {
    const href = webUrl(new URL(raw, 'https://x.com').href);
    if (!href) return null;
    return webUrl(anchor.getAttribute('data-expanded-url')) || webUrl(anchor.getAttribute('title')) || href;
  } catch { return null; }
}
function ownElements(root: Element, selector: string): Element[] {
  return Array.from(root.querySelectorAll(selector)).filter(element => {
    const quote = element.closest('[data-testid="quoteTweet"]');
    return !quote || quote === root;
  });
}
function articleText(article: Element): string {
  const body = ownElements(article, '[data-testid="tweetText"]')[0];
  const copy = body?.cloneNode(true) as Element | undefined;
  for (const anchor of copy?.querySelectorAll('a[href]') ?? []) {
    const label = anchor.textContent?.trim() ?? '';
    if (/^[@#＃]/.test(label)) continue;
    const url = anchorUrl(anchor);
    if (url) anchor.textContent = url;
  }
  const cardUrls = ownElements(article, '[data-testid="card.wrapper"] a[href], a[data-testid="card.wrapper"][href]')
    .map(anchorUrl).filter((url): url is string => url !== null).slice(0, 20);
  return appendMissingLinks(copy?.textContent ?? '', cardUrls);
}

function readLinkCards(article: Element): NonNullable<ObservedPost['linkCards']> {
  const cards = new Map<string, NonNullable<ObservedPost['linkCards']>[number]>();
  for (const wrapper of ownElements(article, '[data-testid="card.wrapper"]')) {
    const anchors = wrapper.matches('a[href]') ? [wrapper] : Array.from(wrapper.querySelectorAll('a[href]'));
    const url = anchors.map(anchorUrl).find(value => value !== null);
    const image = Array.from(wrapper.querySelectorAll<HTMLImageElement>('img')).find(img => isMediaUrl(img.currentSrc || img.getAttribute('src')));
    if (!url || !image || cards.has(url) || cards.size >= 4) continue;
    const title = (image.getAttribute('alt')?.trim() || wrapper.textContent?.replace(/\s+/g, ' ').trim() || '').slice(0, 300);
    cards.set(url, { url, title, imageUrl: new URL(image.currentSrc || image.getAttribute('src')!).href });
  }
  return [...cards.values()];
}

function imageSource(image: HTMLImageElement): string | null {
  const sources = [image.currentSrc, image.getAttribute('src'), ...(image.getAttribute('srcset') ?? '').split(',').slice(0, 16).reverse().map(item => item.trim().split(/\s+/)[0])];
  return sources.find((source): source is string => isMediaUrl(source)) ?? null;
}
function readMedia(article: Element): ObservedPost['media'] {
  const found: ObservedPost['media'] = [];
  const roots = '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]';
  const selector = `${roots.split(', ').map(root => `${root} img, ${root}[style], ${root} [style]`).join(', ')}, video[poster]`;
  for (const node of ownElements(article, selector)) {
    const element = node as HTMLElement;
    if (element.closest('[data-testid="card.wrapper"]')) continue;
    const video = element.tagName === 'VIDEO' || !!element.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]');
    const sources: (string | null)[] = element.tagName === 'VIDEO' ? [element.getAttribute('poster')] : element.tagName === 'IMG' ? [imageSource(element as HTMLImageElement)] : [];
    // Read references already present in the DOM, never video src/blob or remote metadata.
    for (const match of element.style.backgroundImage.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/g)) sources.push(match[1] ?? match[2] ?? match[3] ?? null);
    for (const url of sources) if (isMediaUrl(url)) found.push({ kind: video ? 'video' : 'image', url: new URL(url).href });
  }
  return mergeMedia(found);
}

export function bookmarkScope(document: Document, url: string): boolean {
  return libraryScope(document, url) === 'bookmarks';
}
export function libraryScope(document: Document, url: string): LibrarySource | null {
  if (!isLibraryUrl(url)) return null;
  const path = new URL(url).pathname;
  if (/^\/i\/bookmarks\/?$/.test(path)) return 'bookmarks';
  const owner = /^\/([a-zA-Z0-9_]{1,15})\/likes\/?$/.exec(path)?.[1];
  if (owner) return owner.toLowerCase() === readAccount(document) ? 'likes' : null;
  const sources = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).map(selected => {
    const label = (selected.getAttribute('aria-label') || selected.textContent || '').normalize('NFKC').trim();
    return /^(Bookmarks?|ブックマーク)$/i.test(label) ? 'bookmarks' as const : /^(Likes?|いいね)$/i.test(label) ? 'likes' as const : null;
  }).filter((source): source is LibrarySource => source !== null);
  if (/^\/i\/history\/likes\/?$/.test(path)) return sources.length === 0 || (sources.length === 1 && sources[0] === 'likes') ? 'likes' : null;
  return sources.length === 1 ? sources[0]! : null;
}
function xPath(href: string | null | undefined): string | null {
  try { const u = new URL(href || '', 'https://x.com'); return u.origin === 'https://x.com' && !u.username && !u.password ? u.pathname : null; } catch { return null; }
}

export function readAccount(document: Document): string | null {
  const href = document.querySelector<HTMLAnchorElement>('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
  const handle = xPath(href)?.match(/^\/([a-zA-Z0-9_]{1,15})\/?$/)?.[1];
  return handle && validHandle(handle) ? handle.toLowerCase() : null;
}
export function readArticle(article: Element, now = new Date().toISOString()): ObservedPost | null {
  const time = ownElements(article, 'time')[0];
  const href = time?.closest('a')?.getAttribute('href');
  const match = xPath(href)?.match(/^\/([a-zA-Z0-9_]{1,15})\/status\/(\d{1,30})(?:\/|$)/);
  if (!match?.[1] || !match[2]) return null;
  const authorHandle = match[1];
  const postId = match[2];
  const rawDate = time?.getAttribute('datetime');
  const postedAt = rawDate && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null;
  const media = readMedia(article);
  const linkCards = readLinkCards(article);
  const quoteRoot = article.querySelector('[data-testid="quoteTweet"]');
  let quote: QuotedPost | undefined;
  if (quoteRoot) {
    const quoteTime = ownElements(quoteRoot, 'time')[0];
    const links = [quoteTime?.closest('a'), quoteRoot.matches('a[href]') ? quoteRoot : null, ...ownElements(quoteRoot, 'a[href]').filter(link => !link.closest('[data-testid="tweetText"], [data-testid="card.wrapper"]'))];
    const identity = links.map(link => xPath(link?.getAttribute('href'))?.match(/^\/([a-zA-Z0-9_]{1,15})\/status\/(\d{1,30})(?:\/|$)/)).find(match => match);
    const rawDate = quoteTime?.getAttribute('datetime');
    const quoteCards = readLinkCards(quoteRoot);
    quote = { postId: identity?.[2] ?? null, authorHandle: identity?.[1] ?? '',
      authorName: (ownElements(quoteRoot, '[data-testid="User-Name"] span')[0]?.textContent ?? identity?.[1] ?? '').slice(0, 200),
      text: articleText(quoteRoot), url: identity ? `https://x.com/${identity[1]}/status/${identity[2]}` : null,
      postedAt: rawDate && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null,
      media: readMedia(quoteRoot), ...(quoteCards.length ? { linkCards: quoteCards } : {}) };
  }
  return {
    postId, authorHandle, authorName: (ownElements(article, '[data-testid="User-Name"] span')[0]?.textContent ?? authorHandle).slice(0, 200),
    text: articleText(article),
    postedAt, observedAt: now, url: `https://x.com/${authorHandle}/status/${postId}`,
    // A DOM observation alone cannot establish that an X article/full text was retrieved.
    partial: true, media, ...(linkCards.length ? { linkCards } : {}), ...(quote ? { quote } : {}),
  };
}
export function restrictedPage(document: Document): boolean {
  return !!document.querySelector('[data-testid="error-detail"], iframe[src*="captcha"], [data-testid="LoginForm_Login_Button"]');
}
