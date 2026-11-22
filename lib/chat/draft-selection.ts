import { normalizeMarketplaceSearchText } from '@/agent/marketplace/search';
import type { DraftEdits } from './draft-edits';

export type ChatDraftAction = ({ intent: 'create' } | { intent: 'update'; listingId: string }) & { edits?: DraftEdits };

const sameDraftReference = /(?:^| )[لب]?نفس (?:المسوده|الاعلان)(?= |$)/u;
const draftOrdinal = '(?:الاول(?:ي)?|الثاني(?:ه)?|الثالث(?:ه)?|الرابع(?:ه)?|الاخير(?:ه)?|الاخر(?:ي)?)';
const ambiguousDraftGroup = /(?:^| )(?:المسودات|الاعلانات|(?:ال)?مسودتين|(?:ال)?اعلانين)(?= |$)/u;
const relativeDraftReference = '(?:(?:اللي|الذي|التي) (?:(?:كان|كانت) )?قبل(?:ه|ها)?|السابق(?:ه)?)';
const draftEditCue = '(?:عدل|غير|حدث|خل|خلي|اقصد|قصدي|(?:ال|لل|ل)?(?:سعر|وصف|عنوان|مسوده|اعلان))';
const unnamedDraftReference = new RegExp([
  `^(?:${draftOrdinal}|${relativeDraftReference})(?= |$)`,
  `(?:^| )(?:و${draftOrdinal}|و?${draftEditCue} (?:${draftOrdinal}|${relativeDraftReference}))(?= |$)`,
].join('|'), 'u');
const genericDraftWords = new Set([
  'الى', 'في', 'من', 'علي', 'مع', 'الان', 'الحالي', 'الحاليه', 'السابق', 'السابقه',
  'الجديد', 'الجديده', 'جديد', 'جديده', 'اعلان', 'الاعلان',
]);

function wordsIn(value: string) {
  return normalizeMarketplaceSearchText(value).replace(/[^\p{L}\p{N}-]+/gu, ' ').trim();
}

function hasUnnamedDraftReference(words: string, originalRequest?: string) {
  return unnamedDraftReference.test(words)
    || (originalRequest !== undefined && unnamedDraftReference.test(wordsIn(originalRequest)));
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
  const boundedWords = ` ${words} `;
  for (const entry of draftTitles) {
    if (boundedWords.includes(` ${entry.title} `) || boundedWords.includes(` و${entry.title} `)) {
      targets.add(entry.draft);
    }
  }
  if (identifiers.size) {
    if (identifiers.size !== 1) return null;
    const target = drafts.find(draft => identifiers.has(draft.id));
    return target && (!targets.size || (targets.size === 1 && targets.has(target))) ? target : null;
  }
  if (targets.size) return targets.size === 1 ? [...targets][0] : null;
  if (/(?:رقم|معرف) (?:المسوده|الاعلان)(?: |$)/u.test(words)) return null;
}

export function canResumeUnnamedDraftEdit(
  request: string,
  drafts: readonly { id: string; title?: string | null }[],
  originalRequest?: string,
) {
  const words = wordsIn(request);
  return !hasUnnamedDraftReference(words, originalRequest)
    && !ambiguousDraftGroup.test(words) && findDraftReference(request, drafts) === undefined;
}

export function selectChatDraft<T extends { id: string; title?: string | null }>(
  request: string,
  drafts: readonly T[],
  context: { previousUserRequest?: string; focusedDraftId?: string; draftReference?: string; continuesDraft?: boolean; originalRequest?: string } = {},
) {
  const words = wordsIn(request);
  if (hasUnnamedDraftReference(words, context.originalRequest)) return undefined;
  const target = findDraftReference(request, drafts);
  if (target !== undefined) return target ?? undefined;
  if (ambiguousDraftGroup.test(words)) return undefined;
  if (context.draftReference) {
    const reference = wordsIn(context.draftReference);
    if (!reference || !` ${wordsIn(request)} `.includes(` ${reference} `)) return undefined;
    const explicit = findDraftReference(reference, drafts);
    if (explicit !== undefined) return explicit ?? undefined;
    const titleWords = (text: string) => wordsIn(text).split(' ').map(word =>
      word.replace(/^(?:[وبف]?ال|لل)(?=\p{L}{3})/u, ''),
    );
    const terms = titleWords(reference);
    const named = terms.every(word => word.length >= 3)
      ? drafts.filter(draft => terms.every(term => titleWords(draft.title ?? '').includes(term))) : [];
    return named.length === 1 ? named[0] : undefined;
  }
  const refersToSame = sameDraftReference.test(words);
  if (context.focusedDraftId && (refersToSame || context.continuesDraft)) {
    return drafts.find(draft => draft.id === context.focusedDraftId);
  }
  if (refersToSame) {
    return findDraftReference(context.previousUserRequest ?? '', drafts) ?? undefined;
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
