import type { TestContext, SuiteContext } from 'node:test';
import { marketplaceTextAnalyzer, type MarketplaceTextAnalysis } from '@/agent/marketplace/text-understanding';
import { textAnalysis } from './text-understanding';

// Explicit provider fixtures, not an alternate production parser or a model-accuracy test.
const aliases = [
  { term: 'Toyota', variants: ['تويوتا', 'تايوتا', 'toyota'] },
  { term: 'Camry', variants: ['كامري', 'camry'] },
  { term: 'Nissan', variants: ['نيسان', 'nissan'] },
  { term: 'Patrol', variants: ['باترول', 'بترول', 'patrol'] },
  { term: 'hybrid', variants: ['هايبرد', 'هجين'] },
  { term: 'تبوك', variants: ['Tabuk', 'tabuk'] },
  { term: 'الرياض', variants: ['Riyadh', 'riyadh'] },
];
const search = (fields: Partial<MarketplaceTextAnalysis['search']> = {}) => ({ ...textAnalysis().search, ...fields });
const camry = (fields: Partial<MarketplaceTextAnalysis['search']> = {}) => textAnalysis({ category: 'cars', brand: 'Toyota', model: 'Camry', aliases, search: search(fields) });
const fixtures = new Map<string, MarketplaceTextAnalysis>([
  ['Toyota Camry', camry()],
  ['أريد كامري 2022 أو أحدث في تبوك تحت 80 ألف والأهم ممشى قليل', camry({ city: 'تبوك', yearMin: 2022, maxPrice: 80000, rankingPreferences: ['mileage'] })],
  ['أريد كامري في تبوك', camry({ city: 'تبوك' })],
  ['2022 وفوق', textAnalysis({ category: null, aliases, search: search({ searchMode: 'refine', yearMin: 2022 }) })],
  ['حدي 80 ألف', textAnalysis({ category: null, aliases, search: search({ searchMode: 'refine', maxPrice: 80000 }) })],
  ['الأهم ممشى قليل', textAnalysis({ category: null, aliases, search: search({ searchMode: 'refine', rankingPreferences: ['mileage'] }) })],
  ['خل الميزانية 90 ألف', textAnalysis({ category: null, aliases, search: search({ searchMode: 'refine', maxPrice: 90000 }) })],
  ['لا أريد أبيض', textAnalysis({ category: null, aliases, search: search({ searchMode: 'refine', excludedColors: ['أبيض'] }) })],
  ['أريد toyota camry hybrid في تبوك تحت 80 ألف', camry({ city: 'تبوك', maxPrice: 80000, requiredFeatures: ['hybrid'] })],
  ['أريد كامري في الرياض', camry({ city: 'الرياض' })],
  ['ابي نيسان بترول', textAnalysis({ category: 'cars', brand: 'Nissan', model: 'Patrol', aliases })],
  ['ابي ونيسان والبترول', textAnalysis({ category: 'cars', brand: 'Nissan', model: 'Patrol', aliases })],
  ['I want a car', textAnalysis({ category: 'cars', aliases })],
]);

export function mockSearchModel(context: TestContext | SuiteContext) {
  if (!('mock' in context)) throw new Error('Search model fixture requires a test context');
  const resultFor = (text: string) => {
    const fixture = fixtures.get(text);
    if (fixture) return fixture;
    const alias = aliases.find(entry => entry.term === text);
    if (alias) return textAnalysis({ category: null, aliases });
    try {
      const attributes = JSON.parse(text).attributes ?? {};
      return textAnalysis({ product: attributes.model, brand: attributes.brand, model: attributes.model, aliases });
    } catch { return textAnalysis({ category: null, aliases }); }
  };
  context.mock.method(marketplaceTextAnalyzer, 'analyze', async (text: string) => resultFor(text));
  context.mock.method(marketplaceTextAnalyzer, 'peek', resultFor);
}
