import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyMarketplaceIntent,
  evaluateSaudiMarketplaceCompliance,
  getAuthRequiredResponse,
} from '@/agent/marketplace/policy';

test('allows marketplace questions without authentication', () => {
  const decision = classifyMarketplaceIntent('كيف يعمل الشات في السوق؟');

  assert.equal(decision.intent, 'general_info');
  assert.equal(decision.requiresAuth, false);
});

test('requires authentication for creating a listing', () => {
  const decision = classifyMarketplaceIntent('عندي آيفون 14 برو للبيع');

  assert.equal(decision.intent, 'create_listing');
  assert.equal(decision.requiresAuth, true);
  assert.equal(decision.requiresConfirmation, true);
});

test('requires authentication for buyer seller conversations', () => {
  const decision = classifyMarketplaceIntent('افتح شات مع البائع');

  assert.equal(decision.intent, 'open_conversation');
  assert.equal(decision.requiresAuth, true);
});

test('blocks products prohibited by Saudi and Islamic marketplace policy', () => {
  const decision = evaluateSaudiMarketplaceCompliance('عندي مشروب كحولي للبيع');

  assert.equal(decision.decision, 'block');
  assert.equal(decision.jurisdiction, 'SA');
  assert.equal(decision.shariaSensitive, true);
  assert.equal(decision.prohibitedCategory, 'alcohol');
});

test('blocks pork and pig-derived products', () => {
  const decision = evaluateSaudiMarketplaceCompliance('عندي جيلاتين خنزير للبيع');

  assert.equal(decision.decision, 'block');
  assert.equal(decision.shariaSensitive, true);
  assert.equal(decision.prohibitedCategory, 'pork_or_pig_derived');
});

test('blocks explosives, secret cameras, and forged goods', () => {
  assert.equal(
    evaluateSaudiMarketplaceCompliance('أبيع ألعاب نارية').decision,
    'block',
  );
  assert.equal(
    evaluateSaudiMarketplaceCompliance('عندي ساعة فيها كاميرا مخفية').decision,
    'block',
  );
  assert.equal(
    evaluateSaudiMarketplaceCompliance('وثيقة مزورة للبيع').decision,
    'block',
  );
});

test('routes sensitive regulated products to review', () => {
  const decision = evaluateSaudiMarketplaceCompliance('عندي فيب للبيع');

  assert.equal(decision.decision, 'needs_review');
  assert.equal(decision.prohibitedCategory, 'tobacco_or_vape');
});

test('marks auth response with a frontend-renderable Google sign-in marker', () => {
  assert.match(
    getAuthRequiredResponse('ar'),
    /\[\[SMARTSTORE_GOOGLE_AUTH_REQUIRED\]\]/,
  );
});
