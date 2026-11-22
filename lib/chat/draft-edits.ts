import { normalizeMarketplaceSearchText } from '@/agent/marketplace/search';

type EditField = 'title' | 'description' | 'city' | 'condition' | 'category' | 'categoryOption' | 'carModel'
  | 'saleTerms' | 'usageNotes' | 'defects' | 'color' | 'material' | 'brand' | 'attributes';
type DraftPrice = number | 'bid' | 'negotiable';
export type DraftEdits = { fields: Partial<Record<EditField, string>>; price?: DraftPrice; photos: boolean };
export type ChatDraftAction = ({ intent: 'create' } | { intent: 'update'; listingId: string }) & { edits?: DraftEdits };

function evidenceText(value: string) {
  return normalizeMarketplaceSearchText(value).replace(/[،.:؛!؟?]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function filterDraftEdits<T extends Partial<Record<EditField | 'price' | 'autoCategory', unknown>>>(updates: T, allowed: DraftEdits) {
  const result = { ...updates };
  for (const key of Object.keys(result) as Array<keyof T & (EditField | 'price' | 'autoCategory')>) {
    if (key === 'price') {
      if (allowed.price === undefined || result.price !== allowed.price) delete result[key];
    } else if (key === 'autoCategory' || !Object.hasOwn(allowed.fields, key)) {
      delete result[key];
    }
  }
  const literalFields = ['city', 'color', 'material', 'brand'] as const;
  for (const field of literalFields) {
    const value = result[field];
    if (typeof value === 'string' && !` ${allowed.fields[field]} `.includes(` ${evidenceText(value)} `)) delete result[field];
  }
  if (result.attributes && typeof result.attributes === 'object') {
    result.attributes = Object.fromEntries(Object.entries(result.attributes).filter(([key]) =>
      !['price', 'priceMode', 'marketplaceCategoryOption', 'marketplaceCarModel', 'saleTerms', 'usageNotes', 'defects', 'color', 'material', 'brand'].includes(key),
    )) as T['attributes'];
    if (!Object.keys(result.attributes as object).length) delete result.attributes;
  }
  return result;
}
