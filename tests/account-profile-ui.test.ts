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

test('account page keeps listing management free of chat listing shortcuts', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');

  assert.doesNotMatch(page, /إنشاء إعلان بالمحادثة/);
  assert.doesNotMatch(page, /إضافة إعلان عبر الشات/);
  assert.match(page, /رسوم المنصة/);
});

test('account shortcuts link to customer listings instead of returning to market', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');
  const listingsPage = readFileSync(
    join(process.cwd(), 'app', 'account', 'listings', 'page.tsx'),
    'utf8',
  );

  assert.match(page, /href="\/account\/listings"/);
  assert.doesNotMatch(page, /id="account-listings"/);
  assert.match(listingsPage, /id="account-listings"/);
  assert.doesNotMatch(page, /ط§ظ„ط¹ظˆط¯ط© ظ„ظ„ط³ظˆظ‚/);
});

test('sold listings expose a platform fee action after the sale marker', () => {
  const page = readFileSync(
    join(process.cwd(), 'app', 'account', 'listings', 'page.tsx'),
    'utf8',
  );

  assert.match(page, /listing\.rawStatus === 'sold'/);
  assert.match(page, /تم البيع/);
  assert.match(page, /\/commissions\?listingId=\$\{listing\.id\}/);
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

test('signed-in customer pages do not fetch protected account data before session is known', () => {
  const protectedPages = [
    ['app', 'conversations', 'page.tsx'],
    ['app', 'favorites', 'page.tsx'],
    ['app', 'commissions', 'page.tsx'],
    ['app', 'conversations', '[conversationId]', 'page.tsx'],
  ];

  for (const segments of protectedPages) {
    const page = readFileSync(join(process.cwd(), ...segments), 'utf8');

    assert.match(page, /const sessionResponse = await fetch\('\/api\/auth\/session'/);
    assert.match(page, /if \(!nextSession\.authenticated\)/);
    assert.doesNotMatch(
      page,
      /Promise\.all\(\[[\s\S]*fetch\('\/api\/auth\/session'[\s\S]*api\/marketplace/,
    );
  }
});

test('platform fees page can focus the sold listing fee from the account link', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'commissions', 'page.tsx'), 'utf8');

  assert.match(page, /window\.location\.href/);
  assert.match(page, /targetListingId/);
  assert.match(page, /orderedCommissions/);
  assert.match(page, /أدخل قيمة البيع النهائية لهذا الإعلان/);
});
