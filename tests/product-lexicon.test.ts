import assert from 'node:assert/strict';
import test from 'node:test';
import { marketplaceProducts, getProductIdentity } from '@/lib/marketplace/product-lexicon';
import { isMarketplaceCategory } from '@/lib/marketplace/categories';
import { resolveListingCategory } from '@/agent/marketplace/listing-category';
import { inferExpectedMarketplaceCategory } from '@/agent/marketplace/vision-compliance';
import { getMarketplaceSearchTermVariants, parseMarketplaceSearchQuery } from '@/agent/marketplace/search';
import { parseStructuredSearchIntent } from '@/agent/marketplace/structured-search-intent';
import { getComparableListings } from '@/agent/marketplace/market-intelligence';
import { createListingDraft } from '@/agent/marketplace/store';

for (const product of marketplaceProducts) {
  test(`shared product ${product.id} recognizes every alias across search, intake and image context`, () => {
    assert.ok(isMarketplaceCategory(product.category));
    for (const alias of product.aliases) {
      const title = `${alias} للبيع`;
      assert.equal(parseMarketplaceSearchQuery(title).category, product.category, title);
      assert.equal(parseStructuredSearchIntent(title).category, product.category, title);
      assert.equal(resolveListingCategory({ category: 'other', autoCategory: true, title }), product.category, title);
      assert.equal(inferExpectedMarketplaceCategory(title), product.category, title);
      assert.equal(resolveListingCategory({ category: 'furniture', autoCategory: false, title }), 'furniture');
    }
  });
}

test('Saudi heavy-vehicle phrases stay specific without interpreting isolated qualifiers as products', () => {
  for (const title of ['وايت سكس', 'الوايت للبيع', 'والسطحة للبيع', 'تريله مرسيدس', 'سطحه ايسوزو', 'قلاب سكس', 'وايت تريلا']) {
    assert.equal(parseMarketplaceSearchQuery(title).category, 'heavy_equipment', title);
  }
  for (const text of ['قابل للتفاوض', 'سطح المنزل', 'دبابيس', 'tabletcase', 'blackwatch', 'سكس']) {
    assert.equal(getProductIdentity(text), undefined, text);
  }
  assert.equal(parseMarketplaceSearchQuery('قطع غيار تريله').category, 'auto_parts');
  assert.ok(getMarketplaceSearchTermVariants('سطحه').includes('سطحة'));
  assert.ok(getMarketplaceSearchTermVariants('تريله').includes('تريلا'));
});

function listing(id: string, title: string, category = 'heavy_equipment') {
  return { ...createListingDraft({ sellerId: `seller-${id}`, category, title, city: 'تبوك' }), id, status: 'published' as const };
}

test('similarity recognizes tanker synonyms and excludes tow trucks, trailers, parts and services', () => {
  const target = listing('target', 'وايت سكس للبيع');
  const same = listing('same', 'صهريج سكس للبيع');
  const candidates = [same, listing('tow', 'سطحة للبيع'), listing('trailer', 'تريله للبيع'), listing('parts', 'قطع غيار وايت سكس للبيع'), listing('service', 'خدمة وايت سكس توصيل مياه'), listing('size', 'وايت تريلا للبيع')];
  assert.deepEqual(getComparableListings(target, candidates).map(item => item.id), ['same']);
});

test('brand alone does not make different product families comparable', () => {
  const target = listing('fridge', 'ثلاجة سامسونج نظيفة', 'home_appliances');
  const washer = listing('washer', 'غسالة سامسونج نظيفة', 'home_appliances');
  target.attributes = { brand: 'Samsung' };
  washer.attributes = { brand: 'Samsung' };
  assert.deepEqual(getComparableListings(target, [washer]), []);
  const sofa = listing('sofa', 'كنب نظيف للبيع', 'furniture');
  const couch = listing('couch', 'كنبة للبيع', 'furniture');
  assert.deepEqual(getComparableListings(sofa, [couch]).map(item => item.id), ['couch']);
});

test('specific product names do not broaden search into generic product families', () => {
  for (const [term, synonym, unrelated] of [
    ['ايفون', 'iphone', 'جوال'], ['ماكبوك', 'macbook', 'laptop'],
    ['ايباد', 'ipad', 'tablet'], ['بلايستيشن', 'playstation', 'xbox'],
    ['ثلاجة', 'fridge', 'water dispenser'], ['قلاية هوائية', 'air fryer', 'deep fryer'],
  ]) {
    const variants = getMarketplaceSearchTermVariants(term);
    assert.ok(variants.includes(synonym), term);
    assert.ok(!variants.includes(unrelated), term);
  }
});

test('every supported product family matches its aliases without admitting a different family', () => {
  for (const product of marketplaceProducts) {
    const target = listing(`target-${product.id}`, product.aliases[0], product.category);
    const same = listing(`same-${product.id}`, product.aliases.at(-1)!, product.category);
    const unrelated = marketplaceProducts.filter(other => other.id !== product.id && other.category === product.category)
      .map(other => listing(other.id, other.aliases[0], other.category));
    assert.deepEqual(getComparableListings(target, [same, ...unrelated]).map(item => item.id), [same.id], product.id);
  }
});

test('explicit English spare parts remain distinct from the named vehicle', () => {
  for (const title of ['spare parts water tanker', 'for sale auto parts tractor trailer']) {
    assert.equal(parseMarketplaceSearchQuery(title).category, 'auto_parts', title);
    assert.equal(inferExpectedMarketplaceCategory(title), 'auto_parts', title);
  }
  assert.deepEqual(getComparableListings(listing('truck', 'water tanker'), [listing('parts', 'spare parts water tanker')]), []);
});
