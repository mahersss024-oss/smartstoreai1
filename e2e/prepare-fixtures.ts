import { createListingDraft, publishListing } from '@/agent/marketplace/store';
import { createListingId } from '@/lib/marketplace/listing-id';

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

  for (const id of [createListingId('e2e-reference-seller', project), `chat-draft-e2e-reference-${project}`]) {
    const reference = createListingDraft({
      id, sellerId: 'e2e-reference-seller', category: 'furniture', title: 'Reference desk',
      description: 'Search fixture without the ID in its title', city: 'الرياض', price: 150,
    });
    reference.compliance = { ...listing.compliance };
    publishListing(reference.id);
  }

  for (const descriptionOnly of [false, true]) {
    const searchFixture = createListingDraft({
      id: `e2e-${descriptionOnly ? 'description' : 'title'}-search-${project}`,
      sellerId: 'e2e-title-search-seller', category: 'other', price: 100, city: 'الرياض',
      title: `${descriptionOnly ? 'DescriptionControl' : 'TitleSearch'}-${project}`,
      description: `${descriptionOnly ? 'TitleSearch' : 'DescriptionOnly'}-${project}`,
    });
    searchFixture.compliance = { ...listing.compliance };
    publishListing(searchFixture.id);
  }
}
