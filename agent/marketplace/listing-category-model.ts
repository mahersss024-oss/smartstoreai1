import { createHash } from 'node:crypto';
import { listingSemanticText, marketplaceTextAnalyzer } from './text-understanding';
import { z } from 'zod';
import { getDeepseekModelName } from '@/agent/deepseek-provider';
import { marketplaceCategoryIds } from '@/lib/marketplace/categories';
import { getMarketplaceCategoryOption, marketplaceCategoryOptionsPrompt } from '@/lib/marketplace/category-options';
import { getMarketplaceCarModel, marketplaceCarModelsPrompt } from '@/lib/marketplace/car-models';
import type { ListingCategoryInput } from './listing-category';

export const listingCategoryTextSchema = z.object({
  title: z.string().trim().max(140).default(''),
  description: z.string().trim().max(4000).default(''),
}).refine(value => value.title.length >= 2 || value.description.length >= 2);

const outputSchema = z.object({
  category: z.enum(marketplaceCategoryIds).nullable(),
  categoryOption: z.string().max(80).optional(),
  carModel: z.string().max(80).optional(),
  confidence: z.number().min(0).max(1),
}).strict();

type CategoryText = z.infer<typeof listingCategoryTextSchema>;
type Suggestion = {
  category: z.infer<typeof outputSchema>['category'];
  status: 'suggested' | 'uncertain' | 'unavailable';
  categoryOption?: string;
  carModel?: string;
};

function catalogSelection(output: { category: string; categoryOption?: string; carModel?: string }) {
  const brand = getMarketplaceCategoryOption(output.category, output.categoryOption);
  return {
    ...(brand ? { categoryOption: brand.id } : {}),
    ...(output.category === 'cars' && brand && getMarketplaceCarModel(brand.id, output.carModel) ? { carModel: output.carModel } : {}),
  };
}

export function parseListingCategoryModelOutput(text: string): Suggestion {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const output = outputSchema.parse(JSON.parse(cleaned));
  return output.category && output.confidence >= 0.8
    ? { category: output.category, status: 'suggested', ...catalogSelection({ ...output, category: output.category }) }
    : { category: null, status: 'uncertain' };
}

async function inferCategory(input: CategoryText, signal: AbortSignal): Promise<Suggestion> {
  if (signal.aborted) return { category: null, status: 'unavailable' };
  const analysis = await marketplaceTextAnalyzer.analyze(listingSemanticText({ ...input, attributes: {} }));
  if (!analysis) return { category: null, status: 'unavailable' };
  return analysis.category && analysis.confidence >= 0.8
    ? { category: analysis.category, status: 'suggested', ...catalogSelection({ ...analysis, category: analysis.category }) }
    : { category: null, status: 'uncertain' };
}

export function createListingCategoryClassifier(
  infer = inferCategory,
  options: { timeoutMs?: number; now?: () => number } = {},
) {
  const cache = new Map<string, { value: Suggestion; expires: number }>();
  const pending = new Map<string, Promise<Suggestion>>();
  const now = options.now ?? Date.now;
  return {
    async suggest(raw: CategoryText): Promise<Suggestion> {
      const input = listingCategoryTextSchema.parse(raw);
      const key = createHash('sha256').update(JSON.stringify([getDeepseekModelName('search'), marketplaceCategoryOptionsPrompt, marketplaceCarModelsPrompt, input])).digest('hex');
      const cached = cache.get(key);
      if (cached && cached.expires > now()) return cached.value;
      if (pending.has(key)) return pending.get(key)!;
      if (pending.size >= 32) return { category: null, status: 'unavailable' };
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const task = (async (): Promise<Suggestion> => {
        try {
          const value = await Promise.race([
            Promise.resolve().then(() => infer(input, controller.signal)),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => { controller.abort(); reject(new Error('category_timeout')); }, options.timeoutMs ?? 6000);
            }),
          ]);
          if (cache.size >= 256) cache.delete(cache.keys().next().value!);
          cache.set(key, { value, expires: now() + 5 * 60_000 });
          return value;
        } catch {
          // No keyword fallback or raw listing text in failure logs.
          return { category: null, status: 'unavailable' };
        } finally {
          clearTimeout(timer!);
          pending.delete(key);
        }
      })();
      pending.set(key, task);
      return task;
    },
  };
}

export const listingCategoryClassifier = createListingCategoryClassifier();

export async function resolveListingCategoryWithModel(input: ListingCategoryInput) {
  if (!input.autoCategory) return input.category;
  const parsed = listingCategoryTextSchema.safeParse({ title: input.title ?? '', description: input.description ?? '' });
  if (!parsed.success) return 'other';
  return (await listingCategoryClassifier.suggest(parsed.data)).category ?? 'other';
}
