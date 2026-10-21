const firstPartyChatHosts = new Set([
  'souqhamad.com',
  'www.souqhamad.com',
  'smartstore-ai.com',
  'www.smartstore-ai.com',
  'localhost',
  '127.0.0.1',
]);

export function normalizeInternalChatHref(href: unknown, currentOrigin?: string) {
  if (typeof href !== 'string' || !href || href.startsWith('//') || /[\u0000-\u001f]/u.test(href)) return null;

  if (href.startsWith('/') && !href.startsWith('//') && !href.includes('\\')) return href;

  try {
    const url = new URL(href);
    const current = currentOrigin ? new URL(currentOrigin) : null;
    const firstParty = firstPartyChatHosts.has(url.hostname.toLowerCase()) ||
      (current !== null && url.origin === current.origin);

    if (!firstParty || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname.startsWith('//')) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function normalizeFirstPartyChatLinks(text: string) {
  return text.replace(/https?:\/\/[^\s<>"`)\]]+/giu, rawUrl => {
    const trailingPunctuation = rawUrl.match(/[.,!?\u060c\u061b\u061f\u2026]+$/u)?.[0] ?? '';
    const url = trailingPunctuation ? rawUrl.slice(0, -trailingPunctuation.length) : rawUrl;
    const internalPath = normalizeInternalChatHref(url);
    return internalPath ? `${internalPath}${trailingPunctuation}` : rawUrl;
  });
}
