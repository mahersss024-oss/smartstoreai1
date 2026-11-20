import type { ListingDraft } from '@/agent/marketplace/types';
import { getHamadCustomerReply } from '@/lib/chat-response-safety';
import type { ChatDraftAction } from './draft-selection';
import { draftQuestionField, type DraftQuestionField } from './draft-memory';

type DraftRecord = Pick<ListingDraft, 'id' | 'title' | 'status'>;
type PhotoReceipt = { requested: string[]; attached: string[]; added: string[] };

export type ChatDraftReceipt =
  | { kind: 'saved'; listing: DraftRecord; facts?: Partial<Pick<ListingDraft, 'price' | 'city' | 'condition' | 'category' | 'description'>> }
  | { kind: 'replayed' | 'replay_conflict' | 'blocked'; listing: DraftRecord }
  | { kind: 'updated'; listing: DraftRecord; changes?: Record<string, unknown> }
  | { kind: 'photos'; listing: DraftRecord; photos: PhotoReceipt };

function quotedTitle(title?: string) {
  const plain = title?.replace(/[^\p{L}\p{M}\p{N}\s()+-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
  return plain && getHamadCustomerReply(`عنوان المسودة ${plain}`) ? ` «${plain}»` : '';
}

export function renderChatDraftReceipt(receipts: readonly ChatDraftReceipt[]) {
  const byDraft = new Map<string, ChatDraftReceipt[]>();
  for (const receipt of receipts) {
    const earlier = byDraft.get(receipt.listing.id);
    if (earlier) earlier.push(receipt);
    else byDraft.set(receipt.listing.id, [receipt]);
  }

  const paragraphs = [...byDraft.values()].map(entries => {
    const listing = entries.at(-1)!.listing;
    const title = quotedTitle(listing.title);
    const kinds = new Set(entries.map(entry => entry.kind));
    if (kinds.has('blocked')) return `المسودة${title} تحتاج إلى مراجعة الإدارة.`;
    if (kinds.has('replay_conflict')) return `سبق أن حُفظت مسودة${title} لهذا الطلب. راجعها قبل إعادة طلب الإنشاء.`;
    if (kinds.has('replayed')) return `سبق حفظ الإعلان${title}.`;

    const result: string[] = [];
    if (kinds.has('saved')) result.push(`حُفظت المسودة${title}.`);
    else if (kinds.has('updated')) result.push(`حُدّثت المسودة${title}.`);
    if (listing.status === 'pending') result.push('المسودة الآن قيد المراجعة.');

    const requested = new Set<string>();
    const attached = new Set<string>();
    const added = new Set<string>();
    for (const entry of entries) {
      if (entry.kind !== 'photos') continue;
      entry.photos.requested.forEach(id => requested.add(id));
      entry.photos.attached.forEach(id => attached.add(id));
      entry.photos.added.forEach(id => added.add(id));
    }
    if (requested.size && !result.length && title) result.push(`المسودة${title}.`);
    if (requested.size && !attached.size) result.push('تعذّر إرفاق الصور المختارة. يمكنك إعادة إرفاقها.');
    else if (attached.size < requested.size) result.push(`حُفظت ${attached.size} من أصل ${requested.size} صورة. أعد إرفاق الصور المتبقية.`);
    else if (added.size) result.push(`عدد الصور المختارة المحفوظة في المسودة ${attached.size}.`);
    else if (attached.size) result.push('الصور المختارة مرفقة بالمسودة مسبقًا.');

    return result.join(' ');
  });

  return [...paragraphs, 'يمكنك مراجعة النتيجة من [إعلاناتي](/account/listings).'].join('\n\n');
}

const draftQuestions = {
  product: 'ما المنتج أو الخدمة التي تريد الإعلان عنها؟',
  description: 'ما التفاصيل التي تريد إضافتها إلى وصف الإعلان؟',
  price: 'ما السعر الذي تريد وضعه في المسودة؟',
  city: 'في أي مدينة تعرض المنتج أو الخدمة؟',
  condition: 'ما حالة المنتج؟ اذكر أي عيوب أو ملاحظات تريد إدراجها.',
  specifications: 'ما المواصفات التي تريد إدراجها في المسودة؟',
  bundle: 'هل تريد عرض المنتجات معًا في إعلان واحد أم تجهيز مسودة منفصلة لكل منتج؟',
  photos: 'ما الصور التي تريد إرفاقها بهذه المسودة؟',
  change: 'ما التعديل الذي تريد حفظه في هذه المسودة؟',
  draft: 'أي مسودة تقصد؟ اذكر اسمها أو رقمها من [إعلاناتي](/account/listings).',
  category: 'ما النوع أو العلامة التجارية التي تريدها ضمن التصنيف المختار؟',
} as const;

const productPhotoQuestion = 'ما اسم المنتج الظاهر في الصور؟';

export function getChatDraftQuestionField(text: string): DraftQuestionField | undefined {
  const question = text.trim();
  if (question === productPhotoQuestion) return 'product';
  return (Object.keys(draftQuestions) as DraftQuestionField[]).find(field => draftQuestions[field] === question);
}

export function getRecentChatDraftQuestionFields(messages: readonly { role?: unknown; text: string }[] = []) {
  if (messages.at(-1)?.role !== 'user') return [];
  const fields = new Set<DraftQuestionField>();
  for (const message of messages.slice(0, -1).reverse()) {
    if (message.role === 'user') continue;
    if (message.role !== 'assistant') break;
    const field = getChatDraftQuestionField(message.text);
    if (!field) break;
    fields.add(field);
  }
  return [...fields];
}

export function isChatDraftMutationTool(name?: string) {
  return name === 'createListingDraft' || name === 'updateListing' || name === 'addUploadedImagesToListing';
}

export const draftClarificationInstructions = `Use the relevant conversation and the current draft task to collect seller-confirmed facts. Use natural Arabic suitable for the customer. With enough information, use the draft tool. A price, city, condition, photo or optional specification can be added later. After a write, describe exactly what the tool actually saved, including the changed fields or image counts when relevant. Never imply a draft was published. For a necessary question when nothing was written, output DRAFT_QUESTION:<field> on the first line, then one naturally written Arabic question directly about the missing detail on the next line. The first line is internal metadata. Avoid asking for a detail the seller has already given. Fields: ${draftQuestionField.options.join(', ')}.`;

export function getDraftClarification(
  action: ChatDraftAction,
  modelText: string,
  hasImages: boolean,
  toolResults: Parameters<typeof renderChatDraftClarification>[3],
) {
  const envelope = /^DRAFT_QUESTION:([a-z]+)(?:\r?\n([\s\S]+))?$/u.exec(modelText.trim());
  const field = draftQuestionField.safeParse(envelope?.[1]);
  const fallback = renderChatDraftClarification(action, envelope ? `DRAFT_QUESTION:${envelope[1]}` : '', hasImages, toolResults);
  const expected = getChatDraftQuestionField(fallback);
  const question = field.success && field.data === expected && envelope?.[2]?.length && envelope[2].length <= 400
    && /[؟?]$/u.test(envelope[2].trim()) ? getHamadCustomerReply(envelope[2]) : undefined;
  return { field: expected, question, fallback };
}

export function renderChatDraftClarification(
  action: ChatDraftAction,
  modelText: string,
  hasImages: boolean,
  toolResults: readonly ({ toolName: string; output?: unknown } | undefined)[],
) {
  const failed = toolResults.findLast(result => isChatDraftMutationTool(result?.toolName));
  const output = failed?.output;
  const status = output && typeof output === 'object' && 'status' in output ? output.status : undefined;
  switch (status) {
    case 'limit_reached': return 'بلغت الحد الأقصى للإعلانات المحفوظة في حسابك. راجع [إعلاناتي](/account/listings) قبل إضافة إعلان آخر.';
    case 'missing_product_details': return draftQuestions.product;
    case 'missing_update_details': return draftQuestions.change;
    case 'price_not_authorized': return draftQuestions.price;
    case 'invalid_category_option': return draftQuestions.category;
    case 'missing_images':
    case 'invalid_image_selection':
    case 'image_selection_conflict': return 'أعد إرفاق الصور التي تقصدها مع ذكر المسودة.';
    case 'not_found':
    case 'user_action_required': return 'تعذّر تعديل المسودة. راجع حالتها من [إعلاناتي](/account/listings).';
    case 'needs_confirmation': return draftQuestions.draft;
  }

  const field = /^DRAFT_QUESTION:([a-z]+)$/.exec(modelText.trim())?.[1];
  if (field === 'product' && hasImages) return productPhotoQuestion;
  if (field && Object.hasOwn(draftQuestions, field)) return draftQuestions[field as keyof typeof draftQuestions];
  if (action.intent === 'update') return draftQuestions.change;
  return hasImages ? productPhotoQuestion : draftQuestions.product;
}
