import assert from 'node:assert/strict';
import test from 'node:test';
import { marketplaceTextAnalyzer, marketplaceTextPolicy } from '@/agent/marketplace/text-understanding';
import {
  classifyMarketplaceIntent, evaluateSaudiMarketplaceCompliance,
  evaluateListingComplianceBestEffort, getAuthRequiredResponse,
} from '@/agent/marketplace/policy';
import { evaluateConversationMessageSafety, containsDirectContactDetails } from '@/agent/marketplace/message-safety';
import { textAnalysis } from './helpers/text-understanding';

test('policy preserves contextual model decisions without reclassifying substrings', t => {
  for (const decision of ['allow', 'block', 'needs_review'] as const) {
    const output = textAnalysis({ compliance: { decision, reasons: [decision], shariaSensitive: decision !== 'allow' } });
    t.mock.method(marketplaceTextAnalyzer, 'peek', () => output);
    const actual = evaluateSaudiMarketplaceCompliance('context supplied by the customer');
    assert.equal(actual.decision, decision);
    assert.deepEqual(actual.reasons, [decision]);
    assert.equal(actual.jurisdiction, 'SA');
    assert.equal(actual.checkStatus, 'completed');
    assert.equal(actual.shariaSensitive, decision !== 'allow');
  }
});

test('missing analysis or inspection errors require review rather than approval', t => {
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => null);
  const unavailable = evaluateSaudiMarketplaceCompliance('not yet inspected');
  assert.equal(unavailable.decision, 'needs_review');
  assert.equal(unavailable.checkStatus, 'unavailable');
  const failed = evaluateListingComplianceBestEffort('text', () => { throw new Error('offline'); });
  assert.equal(failed.decision, 'needs_review');
  assert.equal(failed.checkStatus, 'unavailable');
});

test('intent classification consumes model output and retains authentication requirements', t => {
  for (const intent of ['create_listing', 'open_conversation', 'delete_listing', 'send_message'] as const) {
    t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis({ intent }));
    const actual = classifyMarketplaceIntent('customer request');
    assert.equal(actual.intent, intent);
    assert.equal(actual.requiresAuth, true);
    assert.equal(actual.requiresConfirmation, true);
  }
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => null);
  assert.equal(classifyMarketplaceIntent('unknown request').intent, 'general_info');
  assert.equal(classifyMarketplaceIntent('unknown request').requiresAuth, false);
});

test('conversation safety rejects blocked regulated and uninspected content', t => {
  for (const decision of ['block', 'needs_review'] as const) {
    t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis({
      compliance: { decision, reasons: ['policy'], shariaSensitive: false },
    }));
    assert.equal(evaluateConversationMessageSafety('message').decision, 'block');
  }
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => null);
  assert.equal(evaluateConversationMessageSafety('message').decision, 'block');
});

test('permitted contact coordination remains allowed after contextual inspection', t => {
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis());
  const message = 'Inspection coordination: 0501234567';
  assert.equal(evaluateConversationMessageSafety(message).decision, 'allow');
  assert.deepEqual(evaluateConversationMessageSafety(message).reasons, []);
  assert.equal(containsDirectContactDetails(message), true);
});

test('policy instructions retain prohibited and restricted commerce safeguards', () => {
  for (const topic of ['intoxicants', 'narcotics', 'ammunition', 'covert surveillance',
    'gambling', 'pork', 'counterfeit', 'occult', 'medicines', 'tobacco', 'airsoft']) {
    assert.ok(marketplaceTextPolicy.includes(topic), topic);
  }
  assert.ok(marketplaceTextPolicy.includes('not matching substrings'));
});

test('auth guidance retains its frontend-renderable sign-in marker', () => {
  assert.match(getAuthRequiredResponse('ar'), /\[\[SMARTSTORE_GOOGLE_AUTH_REQUIRED\]\]/);
  assert.equal(getAuthRequiredResponse('en'), getAuthRequiredResponse('ar'));
});
