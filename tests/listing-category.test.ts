import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveListingCategory } from '@/agent/marketplace/listing-category';
import { evaluateListingComplianceBestEffort } from '@/agent/marketplace/policy';
import { createListingDraft, setListingStatusForSeller } from '@/agent/marketplace/store';
import type { ComplianceDecision } from '@/agent/marketplace/types';

test('storage preserves supplied categories without running keyword inference', () => {
  const input = { category: 'furniture', title: 'iPhone 15' };
  assert.equal(resolveListingCategory(input), 'furniture');
  assert.equal(resolveListingCategory({ ...input, autoCategory: true }), 'furniture');
  assert.equal(resolveListingCategory({ ...input, category: 'other', autoCategory: true }), 'other');
  assert.equal(resolveListingCategory({ ...input, category: 'invalid', autoCategory: true }), 'other');
  assert.equal(resolveListingCategory({ ...input, category: 'legacy' }), 'legacy');
});

test('storage does not reclassify a model-supplied draft or existing drafts', () => {
  const automatic = createListingDraft({ sellerId: 'category-auto', category: 'mobile_phones', autoCategory: true, title: 'iPhone 15' });
  const manual = createListingDraft({ sellerId: 'category-manual', category: 'furniture', title: 'iPhone 15' });
  assert.equal(automatic.category, 'mobile_phones');
  assert.equal(manual.category, 'furniture');
});

test('a technical policy outage remains explicit and holds photo-free publication for review', () => {
  const compliance = evaluateListingComplianceBestEffort('Desk', () => { throw new Error('unavailable'); });
  assert.equal(compliance.checkStatus, 'unavailable');
  const listing = createListingDraft({ sellerId: 'policy-outage', category: 'other', title: 'Desk' });
  listing.compliance = compliance;
  assert.equal(setListingStatusForSeller(listing.id, listing.sellerId, 'published')?.status, 'pending');
  assert.equal(listing.images.length, 0);
});

test('successful checks preserve actual blocks and genuine review requirements', () => {
  for (const decision of ['block', 'needs_review'] as const) {
    const compliance: ComplianceDecision = { decision, reasons: ['policy'], jurisdiction: 'SA', shariaSensitive: false };
    assert.equal(evaluateListingComplianceBestEffort('item', () => compliance), compliance);
    const listing = createListingDraft({ sellerId: `policy-${decision}`, category: 'other', title: 'Desk' });
    listing.compliance = compliance;
    assert.equal(setListingStatusForSeller(listing.id, listing.sellerId, 'published')?.status, decision === 'block' ? 'rejected' : 'pending');
  }
});
