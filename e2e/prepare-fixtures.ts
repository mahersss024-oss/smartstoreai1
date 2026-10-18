import { createListingDraft, publishListing } from '@/agent/marketplace/store';

if (!process.env.SMARTSTORE_DATA_DIR || process.env.SMARTSTORE_MARKETPLACE_STORE !== 'file') {
  throw new Error('E2E fixtures require an explicitly isolated file store.');
}

for (const project of ['desktop-chromium', 'mobile-chromium-layout']) {
  const listing = createListingDraft({
    id: `e2e-report-${project}`,
    sellerId: 'e2e-report-seller',
    category: 'other',
    title: 'Desk',
    description: 'Solid desk',
    city: 'الرياض',
    price: 100,
  });
  // This synthetic fixture has an explicit policy outcome; no live provider is used.
  listing.compliance = {
    decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false,
    checkStatus: 'completed',
  };
  publishListing(listing.id);
}
