import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateForbiddenMarketplaceTerms,
  findAmbiguousForbiddenRoots,
} from '@/agent/marketplace/forbidden-terms';
import {
  classifyMarketplaceIntent,
  evaluateSaudiMarketplaceCompliance,
  getAuthRequiredResponse,
} from '@/agent/marketplace/policy';
import { evaluateConversationMessageSafety } from '@/agent/marketplace/message-safety';

test('classifies marketplace questions as non account-bound', () => {
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
  assert.equal(decision.prohibitedCategory, 'alcohol_or_intoxicants');
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

test('dedicated forbidden terms model blocks Saudi prohibited and Islamic-sensitive terms', () => {
  const eavesdropping = evaluateForbiddenMarketplaceTerms('جهاز تنصت صغير للبيع');
  const radar = evaluateForbiddenMarketplaceTerms('كاشف رادار للسيارة');
  const obscene = evaluateForbiddenMarketplaceTerms('وسائط مخلة للبيع');

  assert.equal(eavesdropping.decision, 'block');
  assert.equal(eavesdropping.prohibitedCategory, 'surveillance_or_eavesdropping');
  assert.equal(radar.decision, 'block');
  assert.equal(radar.prohibitedCategory, 'radar_detectors_or_restricted_devices');
  assert.equal(obscene.decision, 'block');
  assert.equal(obscene.shariaSensitive, true);
});

test('dedicated forbidden terms model routes regulated terms to review', () => {
  const decision = evaluateForbiddenMarketplaceTerms('عندي قلم ليزر قوي');

  assert.equal(decision.decision, 'needs_review');
  assert.equal(decision.prohibitedCategory, 'restricted_laser_devices');
});

test('routes bead, airsoft, and toy guns to review instead of real weapon block', () => {
  const beadGun = evaluateSaudiMarketplaceCompliance('عندي مسدس خرز للبيع');
  const airsoft = evaluateSaudiMarketplaceCompliance('airsoft pistol for sale');
  const toyGun = evaluateSaudiMarketplaceCompliance('مسدس لعبة بلاستيك للأطفال');

  assert.equal(beadGun.decision, 'needs_review');
  assert.equal(beadGun.prohibitedCategory, 'weapon_lookalike_or_airsoft');
  assert.equal(airsoft.decision, 'needs_review');
  assert.equal(toyGun.decision, 'needs_review');
});

test('recognizes buyer searches for regulated products before scope routing', () => {
  const intent = classifyMarketplaceIntent('ابي مسدس خرز');
  const compliance = evaluateSaudiMarketplaceCompliance('ابي مسدس خرز');

  assert.equal(intent.intent, 'search_listing');
  assert.equal(compliance.decision, 'needs_review');
  assert.equal(compliance.prohibitedCategory, 'weapon_lookalike_or_airsoft');
});

test('blocks clearly real firearms and ammunition', () => {
  const realGun = evaluateSaudiMarketplaceCompliance('مسدس حقيقي للبيع');
  const liveAmmo = evaluateSaudiMarketplaceCompliance('ذخيرة ورصاص حي للبيع');
  const disguisedRealGun = evaluateSaudiMarketplaceCompliance('مسدس حقيقي لعبة');

  assert.equal(realGun.decision, 'block');
  assert.equal(realGun.prohibitedCategory, 'real_weapons_or_ammunition');
  assert.equal(liveAmmo.decision, 'block');
  assert.equal(disguisedRealGun.decision, 'block');
  assert.equal(disguisedRealGun.prohibitedCategory, 'real_weapons_or_ammunition');
});

test('does not block the color "رصاصي" as if it were ammunition', () => {
  assert.equal(
    evaluateForbiddenMarketplaceTerms('لون السيارة رصاصي').decision,
    'allow',
  );
  assert.equal(
    evaluateSaudiMarketplaceCompliance('سيارة لونها رصاصي').decision,
    'allow',
  );
  assert.equal(
    evaluateForbiddenMarketplaceTerms('مسدس رصاصي').decision,
    'block',
  );
});

test('matches forbidden words on Arabic word boundaries, not substrings', () => {
  // Words that merely contain a forbidden root must stay allowed.
  const allowed = [
    'بندق للبيع', // hazelnut, not "بندقية" (rifle)
    'عندي شركة', // company, not "شرك" (shirk)
    'العراق', // a country, not "عرق" (a spirit)
    'قنبر',
    'قنبيط',
    'سلاحف للبيع', // turtles, not "سلاح" (weapon)
    'مدخنة', // chimney, not "دخان" (smoke)
    'ترامس', // thermoses
  ];

  for (const text of allowed) {
    assert.equal(
      evaluateForbiddenMarketplaceTerms(text).decision,
      'allow',
      `expected allow for "${text}"`,
    );
  }
});

test('still blocks distinct words that use a forbidden root', () => {
  assert.equal(
    evaluateForbiddenMarketplaceTerms('بندقية حقيقية').decision,
    'block',
  );
  assert.equal(
    evaluateForbiddenMarketplaceTerms('شرك').decision,
    'block',
  );
  assert.equal(
    evaluateForbiddenMarketplaceTerms('عرق').decision,
    'block',
  );
  assert.equal(
    evaluateForbiddenMarketplaceTerms('سلاح').decision,
    'block',
  );
  assert.equal(
    evaluateForbiddenMarketplaceTerms('نبات القنب').decision,
    'block',
  );
});

test('routes sensitive regulated products to review', () => {
  const decision = evaluateSaudiMarketplaceCompliance('عندي فيب للبيع');

  assert.equal(decision.decision, 'needs_review');
  assert.equal(decision.prohibitedCategory, 'tobacco_or_vape');
});

test('does not block derived color words built on a forbidden root', () => {
  // "خمري" (a color) must not be treated as "خمر" (wine).
  assert.equal(
    evaluateForbiddenMarketplaceTerms('لون خمري').decision,
    'allow',
  );
  assert.equal(
    evaluateForbiddenMarketplaceTerms('سيارة لونها خمري').decision,
    'allow',
  );
  // The product itself must still be blocked.
  assert.equal(evaluateForbiddenMarketplaceTerms('خمر').decision, 'block');
  assert.equal(evaluateForbiddenMarketplaceTerms('خمور').decision, 'block');
});

test('resolves the shared word "حشيش" using surrounding context', () => {
  // "حشيش" as animal fodder must be allowed.
  assert.equal(
    evaluateForbiddenMarketplaceTerms('حشيش غنم للبيع').decision,
    'allow',
  );
  assert.equal(
    evaluateForbiddenMarketplaceTerms('أعلاف حشيش').decision,
    'allow',
  );
  // "حشيش" as the drug must stay blocked.
  assert.equal(
    evaluateForbiddenMarketplaceTerms('حشيش مخدر للبيع').decision,
    'block',
  );
  // A bare ambiguous term defaults to blocked (deterministic default).
  assert.equal(evaluateForbiddenMarketplaceTerms('حشيش').decision, 'block');
});

test('flags ambiguous roots that need the chat semantic layer', () => {
  // No decisive context -> the model is asked to resolve it.
  assert.deepEqual(findAmbiguousForbiddenRoots('حشيش للبيع'), ['حشيش']);
  // Decisive contexts (allowed or blocked) leave nothing for the model.
  assert.deepEqual(findAmbiguousForbiddenRoots('حشيش غنم للبيع'), []);
  assert.deepEqual(findAmbiguousForbiddenRoots('حشيش مخدر للبيع'), []);
  // Unrelated text has no ambiguous roots.
  assert.deepEqual(findAmbiguousForbiddenRoots('عندي جوال للبيع'), []);
});

test('allows "كحول" in perfumes and cosmetics but blocks drinks', () => {
  // Allowed: alcohol as an ingredient in allowed products.
  assert.equal(
    evaluateForbiddenMarketplaceTerms('عطر خالي من الكحول').decision,
    'allow',
  );
  assert.equal(
    evaluateForbiddenMarketplaceTerms('عطر غير كحولي').decision,
    'allow',
  );
  assert.equal(
    evaluateForbiddenMarketplaceTerms('مزيل عرق خالي من الكحول').decision,
    'allow',
  );
  assert.equal(
    evaluateForbiddenMarketplaceTerms('منتجات خالية من الكحول').decision,
    'allow',
  );
  // Blocked: the alcoholic drink itself.
  assert.equal(
    evaluateForbiddenMarketplaceTerms('مشروب كحولي').decision,
    'block',
  );
  assert.equal(evaluateForbiddenMarketplaceTerms('كحوليات').decision, 'block');
});

test('allows "عرق" as sweat/deodorant but blocks it as a spirit', () => {
  assert.equal(evaluateForbiddenMarketplaceTerms('مزيل عرق').decision, 'allow');
  assert.equal(evaluateForbiddenMarketplaceTerms('عرق سوس').decision, 'allow');
  assert.equal(evaluateForbiddenMarketplaceTerms('العراق').decision, 'allow');
  assert.equal(evaluateForbiddenMarketplaceTerms('عرق').decision, 'block');
  assert.equal(
    evaluateForbiddenMarketplaceTerms('عرق خمر').decision,
    'block',
  );
});

test('allows everyday kohl, cosmetics, and natural drinks', () => {
  const allowed = [
    'كحل',
    'كحلة',
    'مكحلة للعين',
    'مزيل العرق',
    'مشروب طبيعي',
    'مشروب من العصيرات والفواكه',
    'عصير طبيعي',
    'مشروبات غازية',
    'مشروب غازي',
    'مشروبات طاقة',
    'مشروب طاقة',
    'شراب للرجلين',
    'جوارب',
    'جوارب شراب',
  ];

  for (const text of allowed) {
    assert.equal(
      evaluateForbiddenMarketplaceTerms(text).decision,
      'allow',
      `expected allow for "${text}"`,
    );
  }
});

test('resolves negated ambiguous roots as allowed (X-free phrases)', () => {
  const allowed = [
    'عطر خالي من الكحول',
    'عطر بدون كحول',
    'عطر غير كحولي',
    'منزوع من الكحول',
    'مشروب غازي بدون كحول',
    'مشروب طاقة خالي من الكحول',
    'منتجات غير كحولية',
  ];

  for (const text of allowed) {
    assert.equal(
      evaluateForbiddenMarketplaceTerms(text).decision,
      'allow',
      `expected allow for "${text}"`,
    );
  }
});

test('does not let negation wording hide a real prohibited product', () => {
  // "غير" here describes the product, it is not an "X-free" phrase.
  const blocked = [
    'كحول غير طبيعي',
    'غير مفيد كحول',
    'بدون سبب كحول للبيع',
    'خالي تماما كحول',
    'مشروب كحولي',
    'شراب كحولي',
  ];

  for (const text of blocked) {
    assert.equal(
      evaluateForbiddenMarketplaceTerms(text).decision,
      'block',
      `expected block for "${text}"`,
    );
  }
});

test('allows "دخان" as physical smoke, not tobacco', () => {
  const allowed = [
    'لحم مدخن',
    'برجر مدخن',
    'دجاج مدخن',
    'سيارة تدخن من العادم',
    'دخان من العادم',
    'دخان حريق',
    'دخان الشواء',
    'دخان المصنع',
  ];

  for (const text of allowed) {
    assert.equal(
      evaluateForbiddenMarketplaceTerms(text).decision,
      'allow',
      `expected allow for "${text}"`,
    );
  }

  // Real tobacco wording stays in review.
  const review = [
    'دخان',
    'دخان معسل',
    'علبة دخان',
    'كرتون دخان',
    'شيشة',
    'فيب',
    'سيجارة',
    'سيجار',
    'سجائر',
    'سيجارة إلكترونية',
  ];

  for (const text of review) {
    assert.equal(
      evaluateForbiddenMarketplaceTerms(text).decision,
      'needs_review',
      `expected needs_review for "${text}"`,
    );
  }
});

test('separates "مسكر" (intoxicant) from "مسكرة" (mascara)', () => {
  const allowed = ['مسكرة', 'مسكره', 'ماسكرا', 'مسكرة أدوات التجميل'];

  for (const text of allowed) {
    assert.equal(
      evaluateForbiddenMarketplaceTerms(text).decision,
      'allow',
      `expected allow for "${text}"`,
    );
  }

  const blocked = ['مسكر', 'مسكرات', 'مسكرات ممنوعة'];

  for (const text of blocked) {
    assert.equal(
      evaluateForbiddenMarketplaceTerms(text).decision,
      'block',
      `expected block for "${text}"`,
    );
  }
});

test('allows cologne and sugar but reviews shisha tobacco', () => {
  const allowed = ['كولونيا', 'كولونيا بعد الحلاقة', 'سكر', 'سكر يوضع مع الشاي', 'سكر نبات'];

  for (const text of allowed) {
    assert.equal(
      evaluateForbiddenMarketplaceTerms(text).decision,
      'allow',
      `expected allow for "${text}"`,
    );
  }

  const review = ['معسل', 'معسل تفاح', 'تنباك', 'شمة', 'شمه'];

  for (const text of review) {
    assert.equal(
      evaluateForbiddenMarketplaceTerms(text).decision,
      'needs_review',
      `expected needs_review for "${text}"`,
    );
  }
});

test('does not treat poetic praise words as sorcery', () => {
  assert.equal(evaluateForbiddenMarketplaceTerms('إطلالة ساحرة').decision, 'allow');
  assert.equal(evaluateForbiddenMarketplaceTerms('ساحر').decision, 'allow');
  assert.equal(evaluateForbiddenMarketplaceTerms('ساحرة').decision, 'allow');
  // Real occult wording is still blocked.
  assert.equal(evaluateForbiddenMarketplaceTerms('سحر').decision, 'block');
  assert.equal(evaluateForbiddenMarketplaceTerms('تميمة').decision, 'block');
});

test('matches forbidden roots behind compound Arabic prefixes', () => {
  const blocked = ['بالسحر', 'وبالخمر', 'وبالكحول', 'بالسلاح', 'فالسحر', 'للسحر'];

  for (const text of blocked) {
    assert.equal(
      evaluateForbiddenMarketplaceTerms(text).decision,
      'block',
      `expected block for "${text}"`,
    );
  }

  // The country prefix guard must keep working.
  assert.equal(evaluateForbiddenMarketplaceTerms('العراق').decision, 'allow');
});

test('defeats evasion attempts that split forbidden words with separators', () => {
  assert.equal(
    evaluateForbiddenMarketplaceTerms('ر-ص-ا-ص للبيع').decision,
    'block',
  );
  assert.equal(
    evaluateForbiddenMarketplaceTerms('حش.يش للبيع').decision,
    'block',
  );
  assert.equal(
    evaluateForbiddenMarketplaceTerms('ك-ح-و-ل للبيع').decision,
    'block',
  );
  // Words that merely contain letters after collapsing stay allowed when they
  // are not forbidden roots.
  assert.equal(
    evaluateForbiddenMarketplaceTerms('س-ل-ا-ح-ف للبيع').decision,
    'allow',
  );
});

test('blocks forbidden terms inside buyer seller conversations', () => {
  const decision = evaluateConversationMessageSafety('اقدر اوفر لك جهاز تنصت');

  assert.equal(decision.decision, 'block');
  assert.ok(decision.reasons.includes('forbidden_or_regulated_marketplace_terms'));
});

test('allows direct contact details with inspection coordination', () => {
  const decision = evaluateConversationMessageSafety(
    'ممكن موعد معاينة السيارة بكرة وهذا رقمي 0501234567',
  );

  assert.equal(decision.decision, 'allow');
  assert.equal(decision.reasons.includes('external_contact_attempt'), false);
});

test('allows off-platform app handoff with inspection intent', () => {
  const decision = evaluateConversationMessageSafety(
    'للمعاينة راسلني واتساب على 0501234567',
  );

  assert.equal(decision.decision, 'allow');
  assert.equal(decision.reasons.includes('external_contact_attempt'), false);
});

test('marks auth response with a frontend-renderable sign-in marker', () => {
  assert.match(
    getAuthRequiredResponse('ar'),
    /\[\[SMARTSTORE_GOOGLE_AUTH_REQUIRED\]\]/,
  );
  assert.match(getAuthRequiredResponse('ar'), /Google أو Apple/);
  assert.match(getAuthRequiredResponse('en'), /Google or Apple/);
});
