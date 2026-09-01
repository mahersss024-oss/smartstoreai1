import { z } from 'zod';

import type {
  ProductSearchProvider,
  ProductSearchProviderResponse,
  ProductSearchQuery,
  ProductSearchResult,
} from '@/agent/products/provider-contract';

const defaultProductApiTimeoutMs = 10_000;

const productSearchResultSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  merchantName: z.string().min(1).optional(),
  productName: z.string().min(1),
  price: z
    .object({
      amount: z.number(),
      currency: z.string().min(1),
      display: z.string().min(1),
    })
    .optional(),
  productUrl: z.string().url().optional(),
  affiliateUrl: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  availability: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}) satisfies z.ZodType<ProductSearchResult>;

const productSearchApiResponseSchema = z.object({
  results: z.array(productSearchResultSchema),
  sourceStatus: z
    .object({
      searchedProviders: z.array(z.string()).optional(),
      failedProviders: z.array(z.string()).optional(),
      generatedAt: z.string().optional(),
    })
    .optional(),
}) satisfies z.ZodType<ProductSearchProviderResponse>;

export type ProductDataApiConfig = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function getProductDataApiConfig(): ProductDataApiConfig {
  return {
    baseUrl: process.env.SMARTSTORE_PRODUCTS_API_URL?.trim(),
    apiKey: process.env.SMARTSTORE_PRODUCTS_API_KEY?.trim(),
  };
}

export function isProductDataApiConfigured(config = getProductDataApiConfig()) {
  return Boolean(config.baseUrl && config.apiKey);
}

export async function searchSmartStoreProductDataApi(
  query: ProductSearchQuery,
  config = getProductDataApiConfig(),
) {
  if (!isProductDataApiConfigured(config)) {
    return {
      results: [],
      sourceStatus: {
        searchedProviders: [],
        failedProviders: ['smartstore-products-api:not_configured'],
        generatedAt: new Date().toISOString(),
      },
    } satisfies ProductSearchProviderResponse;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? defaultProductApiTimeoutMs,
  );

  try {
    const response = await (config.fetchFn ?? fetch)(
      `${trimTrailingSlash(config.baseUrl ?? '')}/v1/products/search`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(query),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Product Data API failed with status ${response.status}.`);
    }

    const data = (await response.json()) as unknown;
    return productSearchApiResponseSchema.parse(data);
  } finally {
    clearTimeout(timeout);
  }
}

export function createSmartStoreProductDataProvider(
  config = getProductDataApiConfig(),
): ProductSearchProvider | null {
  if (!isProductDataApiConfigured(config)) {
    return null;
  }

  return {
    id: 'smartstore-products-api',
    name: 'SmartStore Product Data API',
    searchProducts: async (query) => {
      const response = await searchSmartStoreProductDataApi(query, config);
      return response.results;
    },
  };
}
