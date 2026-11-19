import type { ListingDraft } from '@/agent/marketplace/types';
import { getHamadCustomerReply } from '@/lib/chat-response-safety';
import type { ChatDraftAction } from './draft-selection';

type DraftRecord = Pick<ListingDraft, 'id' | 'title' | 'status'>;
type PhotoReceipt = { requested: string[]; attached: string[]; added: string[] };

export type ChatDraftReceipt =
  | { kind: 'saved' | 'updated' | 'replayed' | 'replay_conflict' | 'blocked'; listing: DraftRecord }
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
} as const;

export const draftClarificationInstructions = `The server reports draft writes from verified results. If you need to ask the customer a question, answer with exactly DRAFT_QUESTION:<field> and no other text. Choose the missing field using the latest request and conversation: ${Object.keys(draftQuestions).join(', ')}. Do not require optional details before saving a draft when the product is clear.`;

export function renderChatDraftClarification(
  action: ChatDraftAction,
  modelText: string,
  hasImages: boolean,
  toolResults: readonly ({ toolName: string; output?: unknown } | undefined)[],
) {
  const failed = toolResults.findLast(result =>
    result?.toolName === 'createListingDraft' || result?.toolName === 'updateListing' || result?.toolName === 'addUploadedImagesToListing');
  const output = failed?.output;
  const status = output && typeof output === 'object' && 'status' in output ? output.status : undefined;
  switch (status) {
    case 'limit_reached': return 'بلغت الحد الأقصى للإعلانات المحفوظة في حسابك. راجع [إعلاناتي](/account/listings) قبل إضافة إعلان آخر.';
    case 'missing_product_details': return draftQuestions.product;
    case 'missing_update_details': return draftQuestions.change;
    case 'invalid_category_option': return 'ما النوع أو العلامة التجارية التي تريدها ضمن التصنيف المختار؟';
    case 'missing_images':
    case 'invalid_image_selection':
    case 'image_selection_conflict': return 'أعد إرفاق الصور التي تقصدها مع ذكر المسودة.';
    case 'not_found':
    case 'user_action_required': return 'تعذّر تعديل المسودة. راجع حالتها من [إعلاناتي](/account/listings).';
    case 'needs_confirmation': return 'حدّد المسودة وأكّد التعديل الذي تريد حفظه.';
  }

  const field = /^DRAFT_QUESTION:([a-z]+)$/.exec(modelText.trim())?.[1];
  if (field === 'product' && hasImages) return 'ما اسم المنتج الظاهر في الصور؟';
  if (field && Object.hasOwn(draftQuestions, field)) return draftQuestions[field as keyof typeof draftQuestions];
  if (action.intent === 'update') return draftQuestions.change;
  return hasImages ? 'ما اسم المنتج الظاهر في الصور؟' : draftQuestions.product;
}
