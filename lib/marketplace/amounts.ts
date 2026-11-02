import { z } from 'zod';

// Listing prices and sale values use PostgreSQL numeric(12, 2). Reject an
// unrepresentable amount before persistence, without changing normal rounding.
export const maxMarketplaceAmount = 9_999_999_999.99;
export const marketplaceAmountSchema = z.number().nonnegative().max(maxMarketplaceAmount);
