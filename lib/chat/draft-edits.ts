import { z } from 'zod';
import { normalizeMarketplaceSearchText } from '@/agent/marketplace/search';
import { marketplaceAmountSchema } from '@/lib/marketplace/amounts';
import type { DraftQuestionField } from './draft-memory';

const fieldCues = {
  title: /(?:^|\s)(?:العنوان|عنوان|اسم الاعلان)(?:\s|$)/u,
  description: /(?:^|\s)(?:الوصف|وصف|وا?كتب|اكتب|اذكر|وضح)(?:\s|$)/u,
  city: /(?:^|\s)(?:المدينه|مدينه|التسليم|الاستلام|الموقع)(?:\s|$)/u,
  condition: /(?:^|\s)(?:الحاله|حاله|مستعمل|جديد|تالف)(?:\s|$)/u,
  category: /(?:^|\s)(?:التصنيف|تصنيف|القسم)(?:\s|$)/u,
  categoryOption: /(?:^|\s)(?:النوع|نوع|الماركه|العلامه التجاريه)(?:\s|$)/u,
  carModel: /(?:^|\s)(?:الموديل|موديل|طراز|الطراز)(?:\s|$)/u,
  saleTerms: /(?:^|\s)(?:التفاوض|قابل للتفاوض|السوم|سعر ثابت)(?:\s|$)/u,
  usageNotes: /(?:^|\s)(?:الاستخدام|استخدام)(?:\s|$)/u,
  defects: /(?:^|\s)(?:العيوب|عيب|خدش|كسر)(?:\s|$)/u,
  color: /(?:^|\s)(?:اللون|لون|لونه|لونها)(?:\s|$)/u,
  material: /(?:^|\s)(?:الخامة|الخامه|خامه|الماده)(?:\s|$)/u,
  brand: /(?:^|\s)(?:البراند|الماركه|العلامه)(?:\s|$)/u,
  attributes: /(?:^|\s)(?:المواصفات|مواصفات|المقاس|البطاريه|الذاكره|الممشى|السعه)(?:\s|$)/u,
};
type EditField = keyof typeof fieldCues;
const editFields = Object.keys(fieldCues) as EditField[];
export const draftEditProposal = z.object({
  field: z.enum([...editFields, 'price']),
  evidence: z.string().trim().min(2).max(400),
});
type EditProposal = z.infer<typeof draftEditProposal>;
export type DraftPrice = number | 'bid' | 'negotiable';
export type DraftEdits = { fields: Partial<Record<EditField, string>>; price?: DraftPrice; photos: boolean };

const amount = String.raw`(?:\d{1,3}(?:[,٬]\d{3})+(?:[.٫]\d{1,2})?|\d+(?:[.٫]\d{1,2})?)(?![\d%٪]|[.,٬٫]\d)`;
const priceValue = String.raw`(${amount}|على السوم|قابل للتفاوض)`;
const currency = String.raw`(?:\s*(?:ريال(?: سعودي)?|ر\.س|sar))?`;
const explicitPrice = new RegExp(String.raw`(?:^|[\s،,])و?(?:عدل|غير|حدث|اجعل|خل|خلي|خله|خلها|حط|حطه|ثبت|نزل|ارفع)\s+(?:(?:السعر|سعر)\s*(?:[^،.!؟?\d]{0,80}?\s)?(?:(?:الى|يصير|يكون)\s+)?|بـ?\s*|(?=على السوم|قابل للتفاوض))${priceValue}${currency}(?=$|[،؛.!]|\s+و)`, 'gu');
const priceAnswer = new RegExp(String.raw`^(?:(?:السعر|سعره|سعرها|ب)\s*[:=]?\s*)?${priceValue}${currency}[.!]?$`, 'u');
const focusedPriceChange = new RegExp(String.raw`^(?:خله|خلها|حطه|حطها)\s+${priceValue}${currency}[.!]?$`, 'u');

function parsePrice(value: string): DraftPrice | undefined {
  if (value === 'على السوم') return 'bid';
  if (value === 'قابل للتفاوض') return 'negotiable';
  const parsed = marketplaceAmountSchema.safeParse(Number(value.replace(/[,٬]/g, '').replace('٫', '.')));
  return parsed.success ? parsed.data : undefined;
}

function authorizedPrice(request: string, pendingPrice: boolean, hasFocusedPriceProposal: boolean) {
  if (/[?؟]|(?:^|\s)(?:بدون|لاتغير|لا تغير|لا تعدل|لا تحط|لا تخلي|اقل|اكثر)(?:\s|$)/u.test(request)) return undefined;
  const matched = request.split(/[،؛\n!]/u).filter(segment => !fieldCues.description.test(evidenceText(segment)))
    .flatMap(segment => [...segment.matchAll(explicitPrice)].map(match => match[1]));
  if (matched.length > 1) return undefined;
  const value = matched[0] ?? (pendingPrice || /^(?:السعر|سعره|سعرها)\s/u.test(request) ? priceAnswer.exec(request)?.[1] : undefined)
    ?? (hasFocusedPriceProposal ? focusedPriceChange.exec(request)?.[1] : undefined);
  return value === undefined ? undefined : parsePrice(value);
}

function evidenceText(value: string) {
  return normalizeMarketplaceSearchText(value).replace(/[،.:؛!؟?]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function authorizeDraftEdits(options: {
  request: string;
  originalRequest: string;
  pendingField?: DraftQuestionField;
  continuingFocusedDraft?: boolean;
  proposed?: readonly EditProposal[];
  photos: boolean;
}) {
  const { request, originalRequest, pendingField, proposed, photos } = options;
  const latest = evidenceText(request);
  const original = evidenceText(originalRequest);
  const hasFocusedPriceProposal = Boolean(options.continuingFocusedDraft && (!pendingField || pendingField === 'price')
    && proposed?.some(({ field, evidence }) => field === 'price' && latest === evidenceText(evidence) && original === latest));
  const price = authorizedPrice(normalizeMarketplaceSearchText(request), pendingField === 'price', hasFocusedPriceProposal);
  const permittedPrice = price !== undefined && price === authorizedPrice(normalizeMarketplaceSearchText(originalRequest), pendingField === 'price', hasFocusedPriceProposal) ? price : undefined;
  const fields: DraftEdits['fields'] = {};
  const descriptionOnly = /(?:الوصف|وصف)[^،؛.!؟]{0,35}(?:فقط|بس)(?=\s|$)/u.test(original);
  const acceptsField = (field: EditField, evidence: string) => fieldCues[field].test(evidence)
    || pendingField === field || (field === 'attributes' && pendingField === 'specifications');
  if (proposed?.length) {
    for (const { field, evidence } of proposed) {
      const proof = evidenceText(evidence);
      if (field !== 'price' && (!descriptionOnly || field === 'description') && proof && ` ${latest} `.includes(` ${proof} `)
        && ` ${original} `.includes(` ${proof} `) && acceptsField(field, proof)) fields[field] = proof;
    }
  } else if (latest && latest === original) {
    // Older scope responses contain only the intent. A quoted description is
    // a description edit, even if it contains words like price or condition.
    const fieldsToCheck: EditField[] = fieldCues.description.test(latest) ? ['description'] : editFields;
    for (const field of fieldsToCheck) {
      if (acceptsField(field, latest)) fields[field] = latest;
    }
    if (fields.description && pendingField === 'city') delete fields.description;
  }
  return { fields, price: descriptionOnly ? undefined : permittedPrice, photos } satisfies DraftEdits;
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
