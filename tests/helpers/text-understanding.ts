import type { TestContext, SuiteContext } from 'node:test';
import { marketplaceTextAnalysisSchema, marketplaceTextAnalyzer, type MarketplaceTextAnalysis } from '@/agent/marketplace/text-understanding';

export function textAnalysis(overrides: Partial<MarketplaceTextAnalysis> = {}): MarketplaceTextAnalysis {
  return marketplaceTextAnalysisSchema.parse({
    category: 'other', confidence: 0.95, offerKind: 'product', aliases: [], search: {},
    compliance: { decision: 'allow', reasons: [], shariaSensitive: false }, ...overrides,
  });
}

// These tests verify application boundaries, not the semantic accuracy of a provider.
export function mockAllowedTextAnalysis(context: TestContext | SuiteContext) {
  if (!('mock' in context)) throw new Error('Text mock requires a test context');
  const result = textAnalysis();
  context.mock.method(marketplaceTextAnalyzer, 'analyze', async () => result);
  context.mock.method(marketplaceTextAnalyzer, 'peek', () => result);
}

export function mockStructuredProductAnalysis(context: TestContext | SuiteContext) {
  if (!('mock' in context)) throw new Error('Text mock requires a test context');
  const aliases = [
    { term: 'Toyota', variants: ['\u062a\u0648\u064a\u0648\u062a\u0627'] },
    { term: 'Camry', variants: ['\u0643\u0627\u0645\u0631\u064a'] },
    { term: 'hybrid', variants: ['\u0647\u0627\u064a\u0628\u0631\u062f'] },
  ];
  context.mock.method(marketplaceTextAnalyzer, 'peek', (text: string) => {
    let attributes: Record<string, unknown>;
    try { attributes = JSON.parse(text).attributes ?? {}; } catch {
      return aliases.some(entry => entry.term === text) ? textAnalysis({ aliases }) : null;
    }
    if (typeof attributes.brand !== 'string' || typeof attributes.model !== 'string') return null;
    return textAnalysis({ product: attributes.model, brand: attributes.brand, model: attributes.model });
  });
}
