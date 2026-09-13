import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMarketplaceSearchUnderstanding } from '@/agent/marketplace/search-understanding';

test('parses dedicated search understanding model output', () => {
  const understanding = parseMarketplaceSearchUnderstanding(
    JSON.stringify({
      category: 'cars',
      brand: 'Nissan',
      model: 'Patrol',
      city: 'Tabuk',
      maxPrice: 240000,
      yearMin: 2024,
      rankingPreferences: ['year', 'condition'],
      descriptiveTerms: [],
      confidence: 0.93,
    }),
  );

  assert.deepEqual(understanding, {
    category: 'cars',
    brand: 'Nissan',
    model: 'Patrol',
    city: 'Tabuk',
    maxPrice: 240000,
    yearMin: 2024,
    rankingPreferences: ['year', 'condition'],
    descriptiveTerms: [],
  });
});

test('accepts snake case fields from the search understanding model', () => {
  const understanding = parseMarketplaceSearchUnderstanding(
    `Result: ${JSON.stringify({
      category: 'cars',
      brand: 'Toyota',
      model: 'Camry',
      min_price: 60000,
      max_price: 90000,
      year_min: 2020,
      mileage_max: 80000,
      sort_preference: 'lowest_mileage',
      descriptive_terms: ['hybrid'],
      confidence: '91%',
    })}`,
  );

  assert.equal(understanding.brand, 'Toyota');
  assert.equal(understanding.model, 'Camry');
  assert.equal(understanding.minPrice, 60000);
  assert.equal(understanding.maxPrice, 90000);
  assert.equal(understanding.yearMin, 2020);
  assert.equal(understanding.mileageMax, 80000);
  assert.equal(understanding.sortPreference, 'lowest_mileage');
  assert.deepEqual(understanding.descriptiveTerms, ['hybrid']);
});
