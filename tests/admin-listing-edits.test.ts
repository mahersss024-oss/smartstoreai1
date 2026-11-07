import assert from 'node:assert/strict';
import test from 'node:test';
import { listingEditIsDirty, listingEditPatch, reconcileListingEdit, type ListingDraft } from '@/components/admin/listing-edits';

const listing: ListingDraft = {
  title: 'إعلان', description: 'الوصف', category: 'other', categoryOption: '', carModel: '',
  city: 'الرياض', condition: 'used', price: '100', priceMode: 'fixed', status: 'published',
};

test('an untouched draft adopts deletion and cannot restore the prior publication status', () => {
  const original = reconcileListingEdit(undefined, listing);
  const refreshed = reconcileListingEdit(original, { ...listing, status: 'deleted' });
  assert.equal(refreshed.draft.status, 'deleted');
  assert.equal(listingEditIsDirty(refreshed), false);
  const edited = { ...refreshed, draft: { ...refreshed.draft, description: 'تصحيح الوصف' } };
  assert.deepEqual(listingEditPatch(edited), { description: 'تصحيح الوصف' });
});

test('a refresh preserves local edits and rebases unrelated server fields without resubmitting them', () => {
  const original = reconcileListingEdit(undefined, listing);
  original.draft = { ...original.draft, title: 'عنوان المسودة' };
  const refreshed = reconcileListingEdit(original, { ...listing, price: '250', description: 'تحديث البائع' });
  assert.equal(refreshed.draft.title, 'عنوان المسودة');
  assert.equal(refreshed.draft.price, '250');
  assert.equal(refreshed.draft.description, 'تحديث البائع');
  assert.deepEqual(refreshed.conflicts, []);
  assert.deepEqual(listingEditPatch(refreshed), { title: 'عنوان المسودة' });
});

test('same-field concurrent changes remain conflicts across repeated refreshes until reviewed', () => {
  const original = reconcileListingEdit(undefined, listing);
  original.draft = { ...original.draft, title: 'عنوان المسودة' };
  const incoming = { ...listing, title: 'عنوان البائع' };
  const conflict = reconcileListingEdit(original, incoming);
  assert.deepEqual(conflict.conflicts, ['title']);
  assert.equal(conflict.draft.title, 'عنوان المسودة');
  assert.equal(conflict.base.title, 'عنوان البائع');
  assert.deepEqual(reconcileListingEdit(conflict, incoming).conflicts, ['title']);
  const acceptedByServer = reconcileListingEdit(conflict, { ...incoming, title: 'عنوان المسودة' });
  assert.deepEqual(acceptedByServer.conflicts, []);
  assert.equal(listingEditIsDirty(acceptedByServer), false);
});

test('price edits remain paired with their mode and clearing a price preserves an unknown amount', () => {
  const original = reconcileListingEdit(undefined, listing);
  assert.deepEqual(listingEditPatch({ ...original, draft: { ...listing, price: '' } }), { price: null, priceMode: null });
  assert.deepEqual(listingEditPatch({ ...original, draft: { ...listing, priceMode: 'bid' } }), { price: null, priceMode: 'bid' });
  assert.deepEqual(listingEditPatch(original), {});
});

test('a local fixed amount remains fixed when the seller changes the pricing mode', () => {
  const original = reconcileListingEdit(undefined, listing);
  original.draft = { ...listing, price: '200' };
  const refreshed = reconcileListingEdit(original, { ...listing, price: '', priceMode: 'bid' });
  assert.equal(refreshed.draft.price, '200');
  assert.equal(refreshed.draft.priceMode, 'fixed');
  assert.deepEqual(new Set(refreshed.conflicts), new Set(['price', 'priceMode']));
  assert.deepEqual(listingEditPatch({ ...refreshed, conflicts: [] }), { price: 200, priceMode: null });
});

test('a local car model stays with its category and brand when the server changes classification', () => {
  const base = { ...listing, category: 'cars', categoryOption: 'toyota', carModel: 'camry' };
  const original = reconcileListingEdit(undefined, base);
  original.draft = { ...base, carModel: 'corolla' };
  const refreshed = reconcileListingEdit(original, { ...base, category: 'phones', categoryOption: 'apple', carModel: '' });
  assert.deepEqual([refreshed.draft.category, refreshed.draft.categoryOption, refreshed.draft.carModel], ['cars', 'toyota', 'corolla']);
  assert.deepEqual(new Set(refreshed.conflicts), new Set(['category', 'categoryOption', 'carModel']));
  assert.deepEqual(listingEditPatch({ ...refreshed, conflicts: [] }), { category: 'cars', categoryOption: 'toyota', carModel: 'corolla' });
});
