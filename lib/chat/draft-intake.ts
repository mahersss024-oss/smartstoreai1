import { buildScopeContext, getLatestUserRequest, messageHasImageAttachment } from '@/agent/scope-guard';
import type { AuthSession } from '@/lib/auth/session';
import { readDraftMemory } from './draft-memory';
import { getChatDraftQuestionField } from './draft-receipt';

export type ChatInputMessage = {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  parts?: unknown;
  metadata?: unknown;
};

export type DraftIntake = {
  title: string;
  description?: string;
  sourceId: string;
  sourceIndex: number;
  answered: 'product' | 'description' | 'specifications';
  resumed: boolean;
};

export const stoppedDraftCreationReply =
  'تعذّر إكمال حفظ المسودة في المحادثة. يمكنك إكمال الإعلان بالإنشاء اليدوي.';

const optionalDetails = new Set(['description', 'price', 'city', 'condition', 'specifications', 'category', 'photos']);

function normalizeControlText(text: string) {
  return text.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/gu, '')
    .replace(/[أإآ]/gu, 'ا').replace(/[ىي]/gu, 'ي').replace(/ة/gu, 'ه').trim();
}

function isContinueRequest(text: string) {
  return /^(?:اكمل|كمل|تابع|احفظها|حاول مره ثانيه)(?: (?:الحفظ|المسوده))?[!.؟]*$/u.test(normalizeControlText(text));
}

function usableDetail(text: string, maxLength: number) {
  if (text.length < 2 || text.length > maxLength || !/\p{L}/u.test(text)
    || /[\r\n؟?<>]|https?:|Earlier image attachment reference:/iu.test(text)) return false;
  const normalized = normalizeControlText(text);
  return !isContinueRequest(text) && !/^(?:كيف|وين|اين|هل|ليش|متي|وش|ايش)(?:\s|$)|(?:^|\s)(?:لا تحفظ|لا تنشئ|لا تضيف|لا تسجل|لا تعرض|لا تعلن|لا تجهز|لا اريد|لا اعرف|ما ادري|ما ابي|ما ابغي|غير متاكد|مو متاكد|لسه ما حددت)(?:\s|$)/u.test(normalized);
}

export function readDraftIntake(
  messages: readonly ChatInputMessage[],
  session: AuthSession,
  conversationId: string | null,
): DraftIntake | undefined {
  const lastUserIndex = messages.findLastIndex(message => message.role === 'user');
  if (lastUserIndex < 1) return;
  const turns = messages.slice(0, lastUserIndex + 1).filter(message => message.role === 'assistant' || message.role === 'user');
  const assistantText = (message: ChatInputMessage) => buildScopeContext([message], 1)[0]?.text ?? '';
  const pendingField = (questionIndex: number) => {
    const question = turns[questionIndex];
    if (question?.role !== 'assistant') return;
    const pending = readDraftMemory(turns.slice(0, questionIndex + 2), session, conversationId).pending;
    if (pending) return pending.task?.intent === 'create' && !pending.image ? pending.field : undefined;
    if (conversationId && question.metadata && typeof question.metadata === 'object' && 'hamadDraftMemory' in question.metadata) return;
    return getChatDraftQuestionField(assistantText(question));
  };

  let answerIndex = turns.length - 1;
  const resumed = isContinueRequest(getLatestUserRequest([turns[answerIndex]]));
  if (resumed) {
    // Each continuation belongs to the preceding unfinished attempt. Use the
    // original answer's identifier so a retry addresses the same operation.
    while (answerIndex >= 2 && isContinueRequest(getLatestUserRequest([turns[answerIndex]]))) {
      if (messageHasImageAttachment(turns[answerIndex])) return;
      const previous = turns[answerIndex - 1];
      if (previous.role !== 'assistant') return;
      const field = pendingField(answerIndex - 1);
      if (assistantText(previous) !== stoppedDraftCreationReply && !(field && optionalDetails.has(field))) return;
      answerIndex -= 2;
    }
  }

  const answer = turns[answerIndex];
  const field = pendingField(answerIndex - 1);
  if (!answer || answer.role !== 'user' || messageHasImageAttachment(answer)
    || typeof answer.id !== 'string' || answer.id.length > 200 || !answer.id.length) return;
  if (field !== 'product' && field !== 'specifications' && field !== 'description') return;

  const product = field === 'product' ? answer : turns[answerIndex - 2];
  if (product?.role !== 'user' || messageHasImageAttachment(product)
    || (field !== 'product' && pendingField(answerIndex - 3) !== 'product')) return;
  const title = getLatestUserRequest([product]);
  const description = field === 'product' ? undefined : getLatestUserRequest([answer]);
  if (!usableDetail(title, 140) || (description !== undefined && !usableDetail(description, 500))) return;
  return { title, description, sourceId: answer.id, sourceIndex: messages.indexOf(answer), answered: field, resumed };
}
