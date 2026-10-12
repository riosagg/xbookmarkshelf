export function webUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}

export function textLinks(text: string) {
  const links: { start: number; end: number; label: string; url: string }[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'。、，．！？；：「」『』【】]+/giu)) {
    const candidate = match[0]; let end = candidate.length;
    while (end > 0 && '.,!?;:。、，．！？；：'.includes(candidate[end - 1]!)) end--;
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
      if (candidate[end - 1] !== close) continue;
      let excess = 0;
      for (let index = 0; index < end; index++) {
        if (candidate[index] === close) excess++;
        else if (candidate[index] === open) excess--;
      }
      while (end > 0 && excess > 0 && candidate[end - 1] === close) { end--; excess--; }
    }
    const label = candidate.slice(0, end);
    const url = webUrl(label);
    if (url) links.push({ start: match.index, end: match.index + label.length, label, url });
  }
  return links;
}

export function appendMissingLinks(text: string, urls: string[]) {
  let result = text.slice(0, 50000);
  const known = new Set(textLinks(result).map(link => link.url));
  for (const raw of urls) {
    const url = webUrl(raw);
    if (!url || known.has(url)) continue;
    const addition = `${result ? '\n' : ''}${url}`;
    if (result.length + addition.length > 50000) continue;
    result += addition; known.add(url);
  }
  return result;
}

export function parseTagNames(value: string): string[] {
  const names: string[] = []; let current = ''; let quoted = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '"' && (quoted || !current.trim())) {
      if (quoted && value[index + 1] === '"') { current += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { names.push(current.trim()); current = ''; }
    else current += char;
  }
  names.push(current.trim()); return [...new Set(names.filter(Boolean))];
}
export function formatTagNames(names: string[]) {
  return names.map(name => /[,"]/.test(name) ? `"${name.replace(/"/g, '""')}"` : name).join(', ');
}
