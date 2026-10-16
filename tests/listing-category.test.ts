import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveListingCategory } from '@/agent/marketplace/listing-category';
import { evaluateListingComplianceBestEffort } from '@/agent/marketplace/policy';
import { createListingDraft, setListingStatusForSeller } from '@/agent/marketplace/store';
import type { ComplianceDecision } from '@/agent/marketplace/types';

test('automatic categorization is opt-in and never overrides a manual selection', () => {
  const input = { category: 'furniture', title: 'iPhone 15' };
  assert.equal(resolveListingCategory(input), 'furniture');
  assert.equal(resolveListingCategory({ ...input, autoCategory: false }), 'furniture');
  assert.equal(resolveListingCategory({ ...input, autoCategory: true }), 'mobile_phones');
});

test('automatic categorization prefers the title and falls back to description or other', () => {
  const input = { category: 'other', autoCategory: true };
  assert.equal(resolveListingCategory({ ...input, title: 'iPhone 15', description: 'Trade for a Toyota car' }), 'mobile_phones');
  assert.equal(resolveListingCategory({ ...input, title: 'For sale', description: 'Wooden chair' }), 'furniture');
  assert.equal(resolveListingCategory({ ...input, title: 'Toyota Camry' }), 'cars');
  assert.equal(resolveListingCategory({ ...input, category: 'cars', title: 'Unspecified item' }), 'other');
  assert.equal(resolveListingCategory({ ...input, title: 'Canon camera' }), 'cameras');
  assert.equal(resolveListingCategory(input, () => { throw new Error('unavailable'); }), 'other');
});

test('new drafts use local automatic categorization without reclassifying existing drafts', () => {
  const automatic = createListingDraft({ sellerId: 'category-auto', category: 'other', autoCategory: true, title: 'iPhone 15' });
  const manual = createListingDraft({ sellerId: 'category-manual', category: 'furniture', title: 'iPhone 15' });
  assert.equal(automatic.category, 'mobile_phones');
  assert.equal(manual.category, 'furniture');
});

test('a technical policy outage remains explicit and does not prevent photo-free publication', () => {
  const compliance = evaluateListingComplianceBestEffort('Desk', () => { throw new Error('unavailable'); });
  assert.equal(compliance.checkStatus, 'unavailable');
  const listing = createListingDraft({ sellerId: 'policy-outage', category: 'other', title: 'Desk' });
  listing.compliance = compliance;
  assert.equal(setListingStatusForSeller(listing.id, listing.sellerId, 'published')?.status, 'published');
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
