import type {
  ProductProviderRegistry,
  ProductSearchProvider,
  ProductSearchQuery,
} from '@/agent/products/provider-contract';
import { createSmartStoreProductDataProvider } from '@/agent/products/smartstore-products-api';

function getConfiguredProviders() {
  return [createSmartStoreProductDataProvider()].filter(
    (provider): provider is ProductSearchProvider => Boolean(provider),
  );
}

export function createProductProviderRegistry(
  providers = getConfiguredProviders(),
): ProductProviderRegistry {
  return {
    providers,
    search: async (query: ProductSearchQuery) => {
      const settledResults = await Promise.allSettled(
        providers.map((provider) => provider.searchProducts(query)),
      );

      return settledResults.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      );
    },
  };
}

export const productProviderRegistry = createProductProviderRegistry();
