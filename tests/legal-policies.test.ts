import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { platformPolicies } from '@/lib/platform/policies';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('registration agreement explicitly accepts platform policies', () => {
  const agreementPage = readProjectFile('app', 'commission-agreement', 'page.tsx');

  assert.match(agreementPage, /شروط الاستخدام/);
  assert.match(agreementPage, /سياسة الخصوصية/);
  assert.match(agreementPage, /سياسة الإعلانات/);
  assert.match(agreementPage, /سياسة رسوم المنصة/);
  assert.match(agreementPage, /أقر باطلاعي وموافقتي على السياسات الأربع/);
  assert.match(agreementPage, /رسوم المنصة 1% من قيمة البيع المكتمل عبر سوق حمد/);
  for (const href of ['/terms', '/privacy', '/listing-policy', '/commission-policy']) {
    assert.match(
      agreementPage,
      new RegExp(`href="${href.replace(/\//g, '\\/')}"[\\s\\S]{0,160}prefetch=\\{false\\}`),
    );
  }
});

test('privacy policy describes service providers without naming vendors', () => {
  const privacyPage = readProjectFile('app', 'privacy', 'page.tsx');

  assert.match(privacyPage, /platformPolicies\.privacy/);
  const policy = JSON.stringify(platformPolicies.privacy);
  assert.match(policy, /مزودي خدمة موثوقين/);
  assert.doesNotMatch(policy, /DeepSeek|Cloudinary|Render|Google|Apple/);
});test('policy pages keep legal links concise and discoverable', () => {
  const legalPolicyPage = readProjectFile('components', 'legal-policy-page.tsx');
  assert.match(legalPolicyPage, /href: '\/delete-account'/);
  assert.match(legalPolicyPage, /<Link href=\{link\.href\} prefetch=\{false\}>/);
  assert.doesNotMatch(legalPolicyPage, /<Link href="\/"/);
});
