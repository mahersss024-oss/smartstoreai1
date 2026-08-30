export type ProductProviderRegion = {
  country: string;
  city?: string;
  currency?: string;
  language?: 'ar' | 'en';
};

export type ProductSearchQuery = {
  query: string;
  region: ProductProviderRegion;
  limit?: number;
};

export type ProductSearchResult = {
  id: string;
  provider: string;
  merchantName?: string;
  productName: string;
  price?: {
    amount: number;
    currency: string;
    display: string;
  };
  productUrl?: string;
  affiliateUrl?: string;
  imageUrl?: string;
  availability?: string;
  updatedAt?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ProductSearchProvider = {
  id: string;
  name: string;
  searchProducts: (query: ProductSearchQuery) => Promise<ProductSearchResult[]>;
};

export type ProductProviderRegistry = {
  providers: ProductSearchProvider[];
  search: (query: ProductSearchQuery) => Promise<ProductSearchResult[]>;
};
