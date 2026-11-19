import { normalizeMarketplaceSearchText } from '@/agent/marketplace/search';

export type ChatDraftAction = { intent: 'create' } | { intent: 'update'; listingId: string };

const sameDraftReference = /(?:^| )[لب]?نفس (?:المسوده|الاعلان)(?= |$)/u;
const genericDraftWords = new Set([
  'الى', 'في', 'من', 'علي', 'مع', 'الان', 'الحالي', 'الحاليه', 'السابق', 'السابقه',
  'الجديد', 'الجديده', 'جديد', 'جديده', 'اعلان', 'الاعلان',
]);

function wordsIn(value: string) {
  return normalizeMarketplaceSearchText(value).replace(/[^\p{L}\p{N}-]+/gu, ' ').trim();
}

function findDraftReference<T extends { id: string; title?: string | null }>(request: string, drafts: readonly T[]): T | null | undefined {
  const words = wordsIn(request);
  const identifiers = new Set(words.split(' ').filter(word =>
    /^(?:c[a-z0-9]{24}|chat-draft-[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(word)
    || drafts.some(draft => draft.id === word),
  ));

  const references = words.replace(sameDraftReference, ' ');
  const labeledTitles = [...references.matchAll(/(?<!\S)و?ل?(?:ال)?(?:مسوده|اعلان) (?=\S)/gu)]
    .map(match => references.slice(match.index + match[0].length).replace(/^(?:باسم|بعنوان) /u, ''));
  const draftTitles = drafts.map(draft => ({ draft, title: wordsIn(draft.title ?? '') }))
    .filter(entry => entry.title);
  const targets = new Set(draftTitles.filter(entry => words === entry.title).map(entry => entry.draft));
  for (const name of labeledTitles) {
    const matches = draftTitles.filter(entry => name === entry.title || name.startsWith(`${entry.title} `));
    const firstWord = name.split(' ')[0];
    if (!matches.length && !genericDraftWords.has(firstWord) && !identifiers.has(firstWord)) return null;
    for (const match of matches) targets.add(match.draft);
  }
  if (identifiers.size) {
    if (identifiers.size !== 1) return null;
    const target = drafts.find(draft => identifiers.has(draft.id));
    return target && (!targets.size || (targets.size === 1 && targets.has(target))) ? target : null;
  }
  if (targets.size) return targets.size === 1 ? [...targets][0] : null;
  if (/(?:رقم|معرف) (?:المسوده|الاعلان)(?: |$)/u.test(words)) return null;
}

export function selectChatDraft<T extends { id: string; title?: string | null }>(
  request: string,
  drafts: readonly T[],
  previousUserRequest = '',
) {
  const target = findDraftReference(request, drafts);
  if (target !== undefined) return target ?? undefined;
  if (sameDraftReference.test(wordsIn(request))) {
    return findDraftReference(previousUserRequest, drafts) ?? undefined;
  }
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
  return /(?:اضف|ارفق|استخدم|استعمل|اعتمد)\s+(?:الصور(?:ه)?\s+(?:السابقه|اللي ارسلتها)|(?:هذه|هذي)\s+الصور(?:ه)?)|(?:بهذه|بهذي)\s+الصور(?:ه)?/u.test(normalized);
}
