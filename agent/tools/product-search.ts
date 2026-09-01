import { tool } from 'ai';
import { z } from 'zod';

import { productProviderRegistry } from '@/agent/products/registry';

export const searchProducts = tool({
  description:
    'Search connected online product data providers for real product names, prices, availability, images, and product or affiliate links. Use only for online ecommerce product requests.',
  inputSchema: z.object({
    query: z.string().min(2).describe('Product search query.'),
    region: z.object({
      country: z.string().min(2),
      city: z.string().optional(),
      currency: z.string().optional(),
      language: z.enum(['ar', 'en']).optional(),
    }),
    limit: z.number().int().min(1).max(20).optional(),
    filters: z
      .object({
        minPrice: z.number().nonnegative().optional(),
        maxPrice: z.number().nonnegative().optional(),
        brand: z.string().min(1).optional(),
        category: z.string().min(1).optional(),
        merchantNames: z.array(z.string().min(1)).optional(),
        availability: z.enum(['in_stock', 'out_of_stock', 'unknown']).optional(),
      })
      .optional(),
  }),
  execute: async (query) => {
    if (productProviderRegistry.providers.length === 0) {
      return {
        status: 'unconfigured',
        message:
          'Product Data API is not configured. Do not invent prices, availability, images, or links.',
        results: [],
      };
    }

    const results = await productProviderRegistry.search(query);

    return {
      status: results.length > 0 ? 'success' : 'empty',
      message:
        results.length > 0
          ? 'Use only these connected-store product results.'
          : 'No matching products were found in connected stores.',
      results,
    };
  },
});
