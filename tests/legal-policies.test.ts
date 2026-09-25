import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('registration agreement explicitly accepts platform policies', () => {
  const agreementPage = readProjectFile('app', 'commission-agreement', 'page.tsx');

  assert.match(agreementPage, /شروط الاستخدام/);
  assert.match(agreementPage, /سياسة الخصوصية/);
  assert.match(agreementPage, /سياسة الإعلانات/);
  assert.match(agreementPage, /سياسة رسوم المنصة/);
  assert.match(agreementPage, /أقر برسوم منصة 1%/);
});

test('privacy policy describes service providers without naming vendors', () => {
  const privacyPage = readProjectFile('app', 'privacy', 'page.tsx');

  assert.match(privacyPage, /مزودي خدمة موثوقين/);
  assert.doesNotMatch(privacyPage, /DeepSeek|Cloudinary|Render|Google|Apple/);
});
