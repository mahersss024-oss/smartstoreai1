import { generateText, type ModelMessage } from 'ai';
import { z } from 'zod';

import { getDeepseekChatModel } from '@/agent/deepseek-provider';
import type { AppLanguage } from '@/app/i18n';

const imageComplianceTimeoutMs = 18_000;
const imageComplianceMaxAttempts = 2;
const imageComplianceRetryDelayMs = 700;

const optionalModelText = (maxLength: number) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && !value.trim() ? undefined : value,
    z.string().trim().min(1).max(maxLength).optional(),
  );

const decisionSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');

  if (['allow', 'allowed', 'approve', 'approved', 'ok', 'pass'].includes(normalized)) {
    return 'allow';
  }

  if (
    ['block', 'blocked', 'reject', 'rejected', 'prohibited', 'not_allowed'].includes(
      normalized,
    )
  ) {
    return 'block';
  }

  if (
    ['needs_review', 'need_review', 'manual_review', 'review', 'unclear', 'escalate'].includes(
      normalized,
    )
  ) {
    return 'needs_review';
  }

  return normalized;
}, z.enum(['allow', 'block', 'needs_review']));

const confidenceSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const parsed = Number(value.trim());

    return Number.isFinite(parsed) ? parsed : value;
  }

  return value;
}, z.number().min(0).max(1).default(0.5));

const categoryMatchSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalized = value.trim().toLowerCase();

    if (['match', 'matched', 'same', 'true'].includes(normalized)) {
      return 'match';
    }

    if (
      ['mismatch', 'not_match', 'not_matching', 'different', 'false'].includes(
        normalized,
      )
    ) {
      return 'mismatch';
    }

    return 'unclear';
  },
  z.enum(['match', 'mismatch', 'unclear']).optional(),
);

const booleanSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['true', 'yes', '1'].includes(normalized)) {
      return true;
    }

    if (['false', 'no', '0'].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean().optional());

const reasonsSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }

  if (value === null || value === undefined) {
    return [];
  }

  return value;
}, z.array(z.string().trim().min(1).max(600)).default([]));

const imageComplianceSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  return {
    ...candidate,
    decision: candidate.decision ?? candidate.status ?? candidate.result,
    reasons: candidate.reasons ?? candidate.reason ?? candidate.message,
  };
}, z.object({
  decision: decisionSchema,
  confidence: confidenceSchema,
  reasons: reasonsSchema,
  prohibited_category: optionalModelText(160),
  prohibitedCategory: optionalModelText(160),
  detected_category: optionalModelText(160),
  detectedCategory: optionalModelText(160),
  expected_category: optionalModelText(160),
  expectedCategory: optionalModelText(160),
  category_match: categoryMatchSchema,
  categoryMatch: categoryMatchSchema,
  detected_product: optionalModelText(240),
  detectedProduct: optionalModelText(240),
  sharia_sensitive: booleanSchema,
  shariaSensitive: booleanSchema,
}));

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

export type ImageComplianceReviewMode = 'all_images' | 'primary_only';

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
    category: 'cameras',
    patterns: [/(?:كاميرا|كاميره|كاميرات|كانون|نيكون|فوجي|سوني الفا|camera|cameras|canon|nikon|fujifilm|sony alpha)/i],
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
    category: 'women_supplies',
    patterns: [/(?:مستلزمات نسائية|نسائي|نسائية|حريمي|عباية|عبايات|طرحة|طرح|حجاب|women supplies|women|female|ladies|abaya|hijab)/i],
  },
  {
    category: 'men_supplies',
    patterns: [/(?:مستلزمات رجالية|رجالي|رجالية|ثوب رجالي|شماغ|غترة|عقال|men supplies|men|male|mens|thobe|shemagh|ghutra)/i],
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

function getErrorStatusCode(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  const status =
    candidate.status ?? candidate.statusCode ?? candidate.response?.status;

  return typeof status === 'number' ? status : undefined;
}

function shouldRetryImageComplianceError(error: unknown) {
  const status = getErrorStatusCode(error);

  if (status !== undefined) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }

  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('fetch failed')
  );
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function parseImageComplianceDecision(text: string): ImageComplianceDecision {
  const parsed = imageComplianceSchema.parse(
    JSON.parse(extractJsonObject(text)),
  );
  const expectedCategory =
    parsed.expected_category ?? parsed.expectedCategory;
  const categoryMatch =
    parsed.category_match ?? parsed.categoryMatch ?? 'unclear';
  const reasons = parsed.reasons.map((reason) =>
    reason.length > 180 ? `${reason.slice(0, 177)}...` : reason,
  );
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

export function createImageComplianceUserMessages({
  messages,
  userRequest,
  language,
  expectedCategory,
  listingText,
  reviewMode = 'all_images',
}: {
  messages: ModelMessage[];
  userRequest: string;
  language: AppLanguage;
  expectedCategory?: string;
  listingText?: string;
  reviewMode?: ImageComplianceReviewMode;
}) {
  const imageMessage = createImageComplianceUserMessage({
    messages,
    userRequest,
    language,
    expectedCategory,
    listingText,
  });

  if (!imageMessage || !Array.isArray(imageMessage.content)) {
    return [];
  }

  const imageParts = imageMessage.content.filter(isModelImageFilePart);
  const textPart = imageMessage.content.find(isModelTextPart);

  if (reviewMode === 'primary_only') {
    const primaryImagePart = imageParts[0];

    if (!primaryImagePart) {
      return [];
    }

    const primaryText = `${textPart?.text ?? ''}\nPrimary listing image review mode: inspect image 1 only. Secondary images in the same listing are accepted only after technical upload checks and inherit trust from the approved primary image.`;

    return [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: primaryText },
          primaryImagePart,
        ],
      } satisfies ModelMessage,
    ];
  }

  if (imageParts.length <= 1) {
    return [imageMessage];
  }

  return imageParts.map((imagePart, index) => {
    const imageNumber = index + 1;
    const perImageText = `${textPart?.text ?? ''}\nImage ${imageNumber} of ${imageParts.length}. Inspect this image independently as part of the same marketplace listing.`;

    return {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: perImageText }, imagePart],
    } satisfies ModelMessage;
  });
}

function countLatestUserImageParts(messages: ModelMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (
      !isModelMessageLike(message) ||
      message.role !== 'user' ||
      !Array.isArray(message.content)
    ) {
      continue;
    }

    const imagePartCount = message.content.filter(isModelImageFilePart).length;

    if (imagePartCount) {
      return imagePartCount;
    }
  }

  return 0;
}

function firstDefined<T>(values: Array<T | undefined>) {
  return values.find((value): value is T => value !== undefined);
}

function uniqueDefined(values: Array<string | undefined>) {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

export function aggregateImageComplianceDecisions(
  decisions: ImageComplianceDecision[],
) {
  if (!decisions.length) {
    return {
      decision: 'allow',
      confidence: 1,
      reasons: [],
      categoryMatch: 'unclear',
      shariaSensitive: false,
    } satisfies ImageComplianceDecision;
  }

  const blockingDecision = decisions.find(
    (decision) => decision.decision === 'block',
  );
  const reviewDecision = decisions.find(
    (decision) => decision.decision === 'needs_review',
  );
  const finalDecision = blockingDecision
    ? 'block'
    : reviewDecision
      ? 'needs_review'
      : 'allow';
  const categoryMatch = decisions.some(
    (decision) => decision.categoryMatch === 'mismatch',
  )
    ? 'mismatch'
    : decisions.some((decision) => decision.categoryMatch === 'unclear')
      ? 'unclear'
      : 'match';
  const detectedCategories = uniqueDefined(
    decisions.map((decision) => decision.detectedCategory),
  );
  const detectedProducts = uniqueDefined(
    decisions.map((decision) => decision.detectedProduct),
  );
  const hasMultipleDetectedCategories = detectedCategories.length > 1;
  const shouldReviewMixedImages =
    decisions.length > 1 && !blockingDecision && hasMultipleDetectedCategories;
  const aggregatedDecision = shouldReviewMixedImages
    ? 'needs_review'
    : finalDecision;
  const aggregatedCategoryMatch = shouldReviewMixedImages
    ? 'mismatch'
    : categoryMatch;
  const reasons = [
    ...(decisions.length > 1
      ? [`inspected_${decisions.length}_images`]
      : []),
    ...(shouldReviewMixedImages ? ['multiple_distinct_products_in_images'] : []),
    ...decisions.flatMap((decision) => decision.reasons),
  ];

  return {
    decision: aggregatedDecision,
    confidence: Math.min(...decisions.map((decision) => decision.confidence)),
    reasons: [...new Set(reasons)].slice(0, 12),
    prohibitedCategory: firstDefined(
      [blockingDecision, reviewDecision, ...decisions].map(
        (decision) => decision?.prohibitedCategory,
      ),
    ),
    detectedCategory:
      detectedCategories.length === 1
        ? detectedCategories[0]
        : hasMultipleDetectedCategories
          ? 'multiple'
          : undefined,
    expectedCategory: firstDefined(
      decisions.map((decision) => decision.expectedCategory),
    ),
    categoryMatch: aggregatedCategoryMatch,
    detectedProduct: detectedProducts.length
      ? detectedProducts.join(', ').slice(0, 240)
      : undefined,
    shariaSensitive: decisions.some((decision) => decision.shariaSensitive),
  } satisfies ImageComplianceDecision;
}

async function generateImageComplianceText(imageMessage: ModelMessage) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= imageComplianceMaxAttempts; attempt += 1) {
    try {
      const result = await withTimeout(imageComplianceTimeoutMs, (signal) =>
        generateText({
          model: getDeepseekChatModel('vision'),
          instructions: imageComplianceSystemPrompt,
          maxOutputTokens: 520,
          abortSignal: signal,
          messages: [imageMessage],
        }),
      );

      return result.text;
    } catch (error) {
      lastError = error;

      if (
        attempt >= imageComplianceMaxAttempts ||
        !shouldRetryImageComplianceError(error)
      ) {
        throw error;
      }

      await wait(imageComplianceRetryDelayMs);
    }
  }

  throw lastError;
}

export const imageComplianceSystemPrompt = `You are the سوق حمد visual compliance checker for a Saudi marketplace.
Return JSON only. Do not answer the user.

Classify every attached marketplace product image before the chat assistant responds.

Multi-image rule:
- Inspect every attached image, not only the first image.
- If any attached image contains a prohibited product or prohibited content, the final decision must be block.
- If any attached image is unclear, regulated, sensitive, or mismatches the expected category/listing text, the final decision must be needs_review unless another image requires block.
- Use allow only when all attached images are ordinary lawful marketplace products and all reasonably match the expected listing context.
- Mention the number of inspected images in reasons when there is more than one image.

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
  reviewMode = 'all_images',
}: {
  messages: ModelMessage[];
  userRequest: string;
  language: AppLanguage;
  expectedCategory?: string;
  listingText?: string;
  reviewMode?: ImageComplianceReviewMode;
}): Promise<ImageComplianceDecision> {
  const imageMessages = createImageComplianceUserMessages({
    messages,
    userRequest,
    language,
    expectedCategory,
    listingText,
    reviewMode,
  });

  if (!imageMessages.length) {
    return {
      decision: 'allow',
      confidence: 1,
      reasons: [],
      categoryMatch: 'unclear',
      shariaSensitive: false,
    } satisfies ImageComplianceDecision;
  }

  const decisions: ImageComplianceDecision[] = [];

  for (const imageMessage of imageMessages) {
    decisions.push(
      parseImageComplianceDecision(
        await generateImageComplianceText(imageMessage),
      ),
    );
  }

  const decision = aggregateImageComplianceDecisions(decisions);

  if (reviewMode !== 'primary_only') {
    return decision;
  }

  const totalImageCount = countLatestUserImageParts(messages);

  if (totalImageCount <= 1) {
    return decision;
  }

  return {
    ...decision,
    reasons: [
      ...new Set([
        ...decision.reasons,
        'primary_image_reviewed_only',
        `secondary_images_trusted_after_primary_review_${totalImageCount - 1}`,
      ]),
    ].slice(0, 12),
  } satisfies ImageComplianceDecision;
}
