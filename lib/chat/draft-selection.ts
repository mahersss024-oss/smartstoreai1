import { normalizeMarketplaceSearchText } from '@/agent/marketplace/search';

export type ChatDraftAction = { intent: 'create' } | { intent: 'update'; listingId: string };

function wordsIn(value: string) {
  return normalizeMarketplaceSearchText(value).replace(/[^\p{L}\p{N}-]+/gu, ' ').trim();
}

export function selectChatDraft<T extends { id: string; title?: string | null }>(request: string, drafts: readonly T[]) {
  const words = wordsIn(request);
  const identifiers = new Set(words.split(' ').filter(word =>
    /^(?:c[a-z0-9]{24}|chat-draft-[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(word)
    || drafts.some(draft => draft.id === word),
  ));

  const targets = drafts.filter(draft => {
    const title = wordsIn(draft.title ?? '');
    if (!title) return false;
    return words === title || ['مسوده', 'المسوده', 'لمسوده', 'للمسوده', 'اعلان', 'الاعلان', 'لاعلان', 'للاعلان'].some(label =>
      [`${label} ${title}`, `${label} باسم ${title}`, `${label} بعنوان ${title}`].some(phrase => ` ${words} `.includes(` ${phrase} `)));
  });
  if (identifiers.size) {
    if (identifiers.size !== 1) return undefined;
    const target = drafts.find(draft => identifiers.has(draft.id));
    return target && (!targets.length || targets.includes(target)) ? target : undefined;
  }
  if (targets.length) return targets.length === 1 ? targets[0] : undefined;
  if (/(?:رقم|معرف|باسم|بعنوان) (?:المسوده|الاعلان)|(?:المسوده|الاعلان) (?:باسم|بعنوان)/u.test(words)) return undefined;
  return drafts.length === 1 ? drafts[0] : undefined;
}

export function excludesDraftPhotos(request: string) {
  const normalized = normalizeMarketplaceSearchText(request);
  return /(?:بدون|دون|بلا|من غير)\s+(?:اي\s+)?(?:ال)?صور|(?:لا\s+(?:تضف|ترفق|تستخدم|اريد)|ما\s+ابي)\s+(?:اي\s+)?(?:ال)?صور/u.test(normalized);
}

export function acceptsPreviousDraftPhotos(request: string, beginsWithHamad: boolean) {
  const normalized = normalizeMarketplaceSearchText(request).replace(/[.!؟،]+$/u, '').trim();
  if (excludesDraftPhotos(request)) return false;
  if (beginsWithHamad && normalized === 'اختار الانشاء مع حمد') return true;
  return /(?:اضف|ارفق|استخدم|استعمل|اعتمد)\s+(?:(?:الصور|الصوره)\s+(?:السابقه|اللي ارسلتها)|(?:هذه|هذي)\s+الصور)|(?:بهذه|بهذي)\s+الصور/u.test(normalized);
}
