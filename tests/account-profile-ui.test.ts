import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('account page exposes official contact profile settings', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');

  assert.match(page, /\/api\/account\/profile/);
  assert.match(page, /method: 'DELETE'/);
  assert.match(page, /بيانات التواصل الرسمية/);
  assert.match(page, /inputMode="tel"/);
  assert.match(page, /placeholder="05xxxxxxxx"/);
  assert.match(page, /حفظ البيانات/);
  assert.match(page, /الرقم الرسمي المحفوظ/);
  assert.match(page, /تعديل/);
  assert.match(page, /حذف/);
  assert.match(page, /حذف الحساب/);
  assert.match(page, /countContactPhoneCandidates/);
});

test('account page does not flash sign-in controls while session is loading', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');

  assert.match(page, /const \[isSessionLoading, setIsSessionLoading\] = useState\(true\)/);
  assert.match(page, /setIsSessionLoading\(false\)/);
  assert.match(page, /isSessionLoading \? \(/);
  assert.match(page, /جاري التحقق من الحساب/);
  assert.match(page, /: !session\.authenticated \? \(/);
});

test('signed-in customer pages hide sign-in controls until session check finishes', () => {
  const protectedPages = [
    ['app', 'conversations', 'page.tsx'],
    ['app', 'favorites', 'page.tsx'],
    ['app', 'commissions', 'page.tsx'],
  ];

  for (const segments of protectedPages) {
    const page = readFileSync(join(process.cwd(), ...segments), 'utf8');

    assert.match(page, /isLoading && !session\.authenticated \? \(/);
    assert.match(page, /جاري التحقق من الحساب/);
    assert.match(page, /: !session\.authenticated \? \(/);
  }
});
