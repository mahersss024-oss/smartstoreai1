import type { ListingDraft } from '@/agent/marketplace/types';
import { getHamadCustomerReply } from '@/lib/chat-response-safety';

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
