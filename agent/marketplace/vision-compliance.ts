import { generateText, type ModelMessage } from 'ai';
import { z } from 'zod';

import { getDeepseekChatModel } from '@/agent/deepseek-provider';
import type { AppLanguage } from '@/app/i18n';

const imageComplianceTimeoutMs = 12_000;

const imageComplianceSchema = z.object({
  decision: z.enum(['allow', 'block', 'needs_review']),
  confidence: z.number().min(0).max(1).default(0.5),
  reasons: z.array(z.string().trim().min(1).max(120)).default([]),
  prohibited_category: z.string().trim().min(1).max(80).optional(),
  prohibitedCategory: z.string().trim().min(1).max(80).optional(),
  detected_category: z.string().trim().min(1).max(80).optional(),
  detectedCategory: z.string().trim().min(1).max(80).optional(),
  expected_category: z.string().trim().min(1).max(80).optional(),
  expectedCategory: z.string().trim().min(1).max(80).optional(),
  category_match: z.enum(['match', 'mismatch', 'unclear']).optional(),
  categoryMatch: z.enum(['match', 'mismatch', 'unclear']).optional(),
  detected_product: z.string().trim().min(1).max(120).optional(),
  detectedProduct: z.string().trim().min(1).max(120).optional(),
  sharia_sensitive: z.boolean().optional(),
  shariaSensitive: z.boolean().optional(),
});

export type ImageComplianceDecision = {
  decision: 'allow' | 'block' | 'needs_review';
  confidence: number;
  reasons: string[];
  prohibitedCategory?: string;
  detectedCategory?: string;
  expectedCategory?: string;
  categoryMatch: 'match' | 'mismatch' | 'unclear';
  detectedProduct?: string;
  shariaSensitive: boolean;
};

type ModelImageFilePart = {
  type: 'file';
  mediaType: string;
  data: unknown;
};

function isModelMessageLike(message: ModelMessage): message is ModelMessage & {
  role: string;
  content: unknown;
} {
  return typeof message.role === 'string';
}

function isModelImageFilePart(part: unknown): part is ModelImageFilePart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    'mediaType' in part &&
    'data' in part &&
    (part as { type?: unknown }).type === 'file' &&
    typeof (part as { mediaType?: unknown }).mediaType === 'string' &&
    (part as { mediaType: string }).mediaType.startsWith('image/')
  );
}

function isModelTextPart(part: unknown): part is { type: 'text'; text: string } {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    'text' in part &&
    (part as { type?: unknown }).type === 'text' &&
    typeof (part as { text?: unknown }).text === 'string'
  );
}

const categoryRules: Array<{
  category: string;
  patterns: RegExp[];
}> = [
  {
    category: 'cars',
    patterns: [
      /(?:سيارة|سيارات|موتر|كامري|كورولا|يارس|لاندكروزر|نيسان|هوندا|هيونداي|كيا|مازدا|لكزس|مرسيدس|بي ام|car|cars|toyota|camry|corolla|sedan|suv)/i,
    ],
  },
  {
    category: 'auto_parts',
    patterns: [/(?:قطع غيار|كفرات|جنوط|بطارية سيارة|مكينة|قير|صدام|auto parts|spare parts|tires|engine|gearbox)/i],
  },
  {
    category: 'mobile_phones',
    patterns: [/(?:جوال|جوالات|هاتف|ايفون|آيفون|سامسونج|هواوي|شاومي|iphone|samsung|phone|mobile)/i],
  },
  {
    category: 'computers',
    patterns: [/(?:لابتوب|لاب توب|كمبيوتر|ماكبوك|شاشة|كيبورد|طابعة|macbook|laptop|computer|pc|monitor|keyboard|printer)/i],
  },
  {
    category: 'real_estate',
    patterns: [/(?:عقار|شقة|فيلا|بيت|أرض|ارض|استراحة|real estate|apartment|villa|house|land)/i],
  },
  {
    category: 'furniture',
    patterns: [/(?:أثاث|اثاث|كنب|كرسي|طاولة|سرير|دولاب|furniture|chair|table|sofa|bed|wardrobe)/i],
  },
  {
    category: 'fashion',
    patterns: [/(?:ملابس|ثوب|شماغ|حذاء|فستان|شنطة|fashion|clothes|shoes|dress|bag)/i],
  },
  {
    category: 'home_garden',
    patterns: [/(?:منزل|حديقة|مطبخ|مكنسة|ثلاجة|غسالة|مكيف|home|garden|kitchen|vacuum|fridge|washer|ac)/i],
  },
  {
    category: 'sports',
    patterns: [/(?:رياضة|دراجة|جهاز مشي|أوزان|اوزان|sports|bicycle|treadmill|weights)/i],
  },
  {
    category: 'gaming_hobbies',
    patterns: [/(?:بلايستيشن|اكس بوكس|نينتندو|لعبة|العاب|هواية|playstation|xbox|nintendo|game|gaming|hobby)/i],
  },
  {
    category: 'books_education',
    patterns: [/(?:كتاب|كتب|تعليم|مدرسي|جامعة|book|books|education|school|university)/i],
  },
  {
    category: 'kids',
    patterns: [/(?:طفل|أطفال|اطفال|عربة أطفال|كرسي طفل|kids|baby|stroller|child seat)/i],
  },
  {
    category: 'tools_equipment',
    patterns: [/(?:عدة|أدوات|ادوات|معدات|دريل|منشار|tool|tools|equipment|drill|saw)/i],
  },
  {
    category: 'watches_accessories',
    patterns: [/(?:ساعة|ساعات|اكسسوار|إكسسوار|نظارة|محفظة|watch|watches|accessory|accessories|glasses|wallet)/i],
  },
  {
    category: 'beauty',
    patterns: [/(?:عناية|تجميل|عطر|مكياج|كريم|beauty|perfume|makeup|cosmetic|cream)/i],
  },
];

export function inferExpectedMarketplaceCategory(text: string) {
  const normalized = text.trim();

  if (!normalized) {
    return undefined;
  }

  return categoryRules.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(normalized)),
  )?.category;
}

function extractJsonObject(text: string) {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Image compliance checker did not return JSON.');
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return run(controller.signal).finally(() => clearTimeout(timeout));
}

export function parseImageComplianceDecision(text: string): ImageComplianceDecision {
  const parsed = imageComplianceSchema.parse(
    JSON.parse(extractJsonObject(text)),
  );
  const expectedCategory =
    parsed.expected_category ?? parsed.expectedCategory;
  const categoryMatch =
    parsed.category_match ?? parsed.categoryMatch ?? 'unclear';
  const reasons = [...parsed.reasons];
  const decision =
    parsed.decision === 'allow' &&
    expectedCategory &&
    categoryMatch === 'mismatch'
      ? 'needs_review'
      : parsed.decision;

  if (decision === 'needs_review' && categoryMatch === 'mismatch') {
    reasons.push('image_category_mismatch');
  }

  return {
    decision,
    confidence: parsed.confidence,
    reasons: [...new Set(reasons)],
    prohibitedCategory:
      parsed.prohibited_category ?? parsed.prohibitedCategory,
    detectedCategory: parsed.detected_category ?? parsed.detectedCategory,
    expectedCategory,
    categoryMatch,
    detectedProduct: parsed.detected_product ?? parsed.detectedProduct,
    shariaSensitive:
      parsed.sharia_sensitive ?? parsed.shariaSensitive ?? false,
  };
}

export function createImageComplianceUserMessage({
  messages,
  userRequest,
  language,
  expectedCategory,
  listingText,
}: {
  messages: ModelMessage[];
  userRequest: string;
  language: AppLanguage;
  expectedCategory?: string;
  listingText?: string;
}) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (
      !isModelMessageLike(message) ||
      message.role !== 'user' ||
      !Array.isArray(message.content)
    ) {
      continue;
    }

    const imageParts = message.content.filter(isModelImageFilePart);

    if (!imageParts.length) {
      continue;
    }

    const messageText = message.content
      .filter(isModelTextPart)
      .map((part) => part.text)
      .join(' ')
      .trim();
    const requestText = userRequest.trim() || messageText;
    const inferredExpectedCategory =
      expectedCategory ??
      inferExpectedMarketplaceCategory(`${requestText} ${listingText ?? ''}`);
    const text =
      language === 'en'
        ? `Inspect the attached marketplace image(s) before any chat reply. User request: "${requestText}". Expected category: "${inferredExpectedCategory ?? 'unknown'}". Listing text: "${listingText ?? ''}". Return only the required JSON.`
        : `افحص صور المنتج المرفقة قبل أي رد في المحادثة. طلب العميل: "${requestText}". التصنيف المتوقع: "${inferredExpectedCategory ?? 'غير معروف'}". بيانات الإعلان: "${listingText ?? ''}". أعد JSON فقط بالشكل المطلوب.`;

    return {
      role: 'user' as const,
      content: [{ type: 'text' as const, text }, ...imageParts],
    } satisfies ModelMessage;
  }

  return null;
}

export const imageComplianceSystemPrompt = `You are the SmartStore AI visual compliance checker for a Saudi marketplace.
Return JSON only. Do not answer the user.

Classify the attached marketplace product images before the chat assistant responds.

Use Saudi prohibited/restricted goods policy examples, including ZATCA traveler/customs examples such as intoxicants, narcotics, immoral media, counterfeit currency, fireworks, prohibited chewing smoke, tear gas, weapons, ammunition, secret-camera products, electric shocks, radar detectors, unregistered sexual tonics/abortion pills/herbs/lotions, sexual tools/devices, and eavesdropping devices.

Block if the image or described product appears to include:
- alcohol, intoxicants, brewing or distilling equipment
- narcotics, controlled drugs, drug paraphernalia, or substances marketed for intoxication
- pork or pig-derived products
- gambling, lottery, betting, casino, or raffle products
- adult, pornographic, sexual, obscene, or indecent products or media
- magic, occult, sorcery, shirk-promoting items, or items marketed for forbidden spiritual claims
- counterfeit, stolen, forged, fake currency, fake documents, or obvious IP-infringing goods
- real firearms, real guns, ammunition, explosives, fireworks, stun devices, or dangerous weapon accessories
- hidden surveillance or secret-camera devices
- products clearly offensive to Islamic values or illegal to trade in Saudi Arabia

Use needs_review for uncertainty, partial visibility, regulated products, tobacco/vape, medicines, prescriptions, telecom/radio devices, drones, financial accounts, chemicals, cosmetics with unclear compliance, or anything that might require manual approval.

Weapon-like distinction:
- A real firearm, live ammunition, or dangerous weapon must be block.
- A BB gun, pellet gun, airsoft gun, gel blaster, bead gun, toy gun, water pistol, plastic gun, Nerf-style toy, or realistic replica must not be treated as a confirmed real firearm unless the image clearly proves it is real.
- Weapon-like toys and replicas must be needs_review, not allow, because they can be restricted, confusing, or used to bypass policy.
- If the image is unclear and could be a real weapon or weapon-like toy, use needs_review unless there is clear evidence of a real firearm, then block.

Also compare the visible product against the expected category/listing text supplied by the user or system:
- category_match="match" if the visible product reasonably matches the expected category.
- category_match="mismatch" if the visible product is clearly a different category, such as a weapon image for a phone listing or alcohol image for a furniture listing.
- category_match="unclear" if the image is too partial, blurry, or no expected category was supplied.
- If category_match is mismatch, use needs_review unless the visible product is prohibited, then use block.

Use allow only for ordinary lawful marketplace products and listings.

Return this exact JSON shape:
{
  "decision": "allow" | "block" | "needs_review",
  "confidence": 0.0,
  "reasons": ["short reason"],
  "prohibited_category": "category_or_omitted",
  "detected_category": "marketplace category or omitted",
  "expected_category": "expected category or omitted",
  "category_match": "match" | "mismatch" | "unclear",
  "detected_product": "short product name if visible",
  "sharia_sensitive": true
}`;

export async function checkImageMarketplaceCompliance({
  messages,
  userRequest,
  language,
  expectedCategory,
  listingText,
}: {
  messages: ModelMessage[];
  userRequest: string;
  language: AppLanguage;
  expectedCategory?: string;
  listingText?: string;
}) {
  const imageMessage = createImageComplianceUserMessage({
    messages,
    userRequest,
    language,
    expectedCategory,
    listingText,
  });

  if (!imageMessage) {
    return {
      decision: 'allow',
      confidence: 1,
      reasons: [],
      categoryMatch: 'unclear',
      shariaSensitive: false,
    } satisfies ImageComplianceDecision;
  }

  const result = await withTimeout(imageComplianceTimeoutMs, (signal) =>
    generateText({
      model: getDeepseekChatModel('vision'),
      temperature: 0,
      maxOutputTokens: 520,
      abortSignal: signal,
      messages: [
        {
          role: 'system',
          content: imageComplianceSystemPrompt,
        },
        imageMessage,
      ],
    }),
  );

  return parseImageComplianceDecision(result.text);
}
