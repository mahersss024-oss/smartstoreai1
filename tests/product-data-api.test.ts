import assert from 'node:assert/strict';
import test from 'node:test';

import { createProductProviderRegistry } from '@/agent/products/registry';
import {
  createSmartStoreProductDataProvider,
  isProductDataApiConfigured,
  searchSmartStoreProductDataApi,
} from '@/agent/products/smartstore-products-api';
import type {
  ProductSearchProvider,
  ProductSearchQuery,
} from '@/agent/products/provider-contract';

const sampleQuery: ProductSearchQuery = {
  query: 'Samsung Galaxy',
  region: {
    country: 'SA',
    currency: 'SAR',
    language: 'ar',
  },
  limit: 5,
  filters: {
    maxPrice: 1500,
  },
};

test('detects missing Product Data API configuration', () => {
  assert.equal(isProductDataApiConfigured({}), false);
  assert.equal(
    isProductDataApiConfigured({
      baseUrl: 'https://api.smartstore-ai.com',
      apiKey: 'secret',
    }),
    true,
  );
});

test('returns an unconfigured empty response without calling fetch', async () => {
  let called = false;

  const response = await searchSmartStoreProductDataApi(sampleQuery, {
    fetchFn: (() => {
      called = true;
      throw new Error('fetch should not be called');
    }) as typeof fetch,
  });

  assert.equal(called, false);
  assert.deepEqual(response.results, []);
  assert.deepEqual(response.sourceStatus?.searchedProviders, []);
});

test('calls the server-side Product Data API with authorization', async () => {
  const response = await searchSmartStoreProductDataApi(sampleQuery, {
    baseUrl: 'https://api.smartstore-ai.com/',
    apiKey: 'private-test-key',
    fetchFn: (async (input, init) => {
      assert.equal(input, 'https://api.smartstore-ai.com/v1/products/search');
      assert.equal(init?.method, 'POST');
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        'Bearer private-test-key',
      );

      return new Response(
        JSON.stringify({
          results: [
            {
              id: 'p1',
              provider: 'smartstore-products-api',
              merchantName: 'Noon',
              productName: 'Samsung Galaxy A35',
              price: {
                amount: 1199,
                currency: 'SAR',
                display: '1199 SAR',
              },
              productUrl: 'https://example.com/product',
              availability: 'in_stock',
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  });

  assert.equal(response.results[0]?.productName, 'Samsung Galaxy A35');
  assert.equal(response.results[0]?.price?.amount, 1199);
});

test('does not create a provider when API configuration is missing', () => {
  assert.equal(createSmartStoreProductDataProvider({}), null);
});

test('registry merges successful provider results and ignores failed providers', async () => {
  const goodProvider: ProductSearchProvider = {
    id: 'good',
    name: 'Good',
    searchProducts: async () => [
      {
        id: 'p1',
        provider: 'good',
        productName: 'Phone',
      },
    ],
  };
  const failedProvider: ProductSearchProvider = {
    id: 'failed',
    name: 'Failed',
    searchProducts: async () => {
      throw new Error('provider failed');
    },
  };

  const registry = createProductProviderRegistry([goodProvider, failedProvider]);
  const results = await registry.search(sampleQuery);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.productName, 'Phone');
});
