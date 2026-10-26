import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { getPlatformHelp } from '@/agent/platform-guide';
import { isPublicLegalPath, publicLegalLinks } from '@/lib/platform/legal-routes';
import { platformPolicies, platformSupportEmail } from '@/lib/platform/policies';

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
});

test('documented policy help limits Hamad to drafts and help and keeps review decisions human', () => {
  const terms = getPlatformHelp('terms').source;
  assert.strictEqual(terms, platformPolicies.terms);
  assert.match(JSON.stringify(terms), /يوفر الموقع الرسمي روابط تنزيل التطبيقات والسياسات والدعم/);
  assert.doesNotMatch(JSON.stringify(terms), /عبر الموقع وتطبيقات/);
  const role = JSON.stringify(platformPolicies.terms.sections.find(section => section.title === 'دور حمد والمراجعة'));
  assert.match(role, /لحمد دوران فقط/);
  assert.match(role, /مسودات إعلانات غير منشورة/);
  assert.match(role, /المساعدة الموثقة/);
  assert.match(role, /البحث عن المنتجات والمقارنة والتسعير والتفاوض ليست خدمات يقدمها حمد/);
  assert.match(role, /ينفذ المستخدم النشر/);
  assert.match(role, /تعذر التقييم/);
  assert.match(role, /لا تؤدي وحدها إلى رفض المحتوى أو إيقافه أو حذفه تلقائيًا/);

  const listings = JSON.stringify(getPlatformHelp('listing_policy').source);
  assert.match(listings, /قرارات بشرية/);
  assert.match(listings, /ضوابط الرفع والملكية وقرارات المشرفين نافذة/);
  assert.doesNotMatch(listings, /قبول الإعلان آليًا/);
});

test('mobile privacy explains optional device access and current data processing', () => {
  const privacy = JSON.stringify(getPlatformHelp('privacy').source);
  assert.match(privacy, /Android وiPhone/);
  assert.match(privacy, /الكاميرا/);
  assert.match(privacy, /ترفع الصور التي تختار إرسالها إلى الخادم/);
  assert.match(privacy, /لا يرسل الإحداثيات إلى الخادم أو يحفظها/);
  assert.match(privacy, /اختيار المدينة يدويًا/);
  assert.match(privacy, /إشعارات الجهاز اختيارية/);
  assert.match(privacy, /سجل محادثات حمد المحلي/);
  assert.ok(privacy.includes(platformSupportEmail));
  assert.doesNotMatch(privacy, /لتقديم البحث أو المقارنة|مقارنة المنتجات/);
});

test('deletion policy provides the native action and independent support path with qualified retention', () => {
  const deletion = JSON.stringify(getPlatformHelp('deletion').source);
  assert.match(deletion, /حسابي ← تعديل حسابي ← حذف الحساب/);
  assert.match(deletion, /أكد الطلب داخل التطبيق/);
  assert.match(deletion, /دون إعادة تنزيل التطبيق/);
  assert.ok(deletion.includes(platformSupportEmail));
  assert.match(deletion, /لا تنفذ حذف الحساب من الموقع/);
  assert.match(deletion, /عند وجود أدلة محمية، يعطل الحساب/);
  assert.match(deletion, /تحذف اشتراكات إشعارات الحساب ورموز إشعارات أجهزته في الحالتين/);
  assert.match(deletion, /180 يومًا بعد إغلاقها/);
  assert.match(deletion, /إتلاف الأدلة ليس آليًا/);
  assert.match(deletion, /لا يضمن إزالة كل نسخة من التخزين المنفصل/);
  assert.doesNotMatch(deletion, /إعدادات الحساب أو إدارة الحساب|إذا كان الخيار متاحًا/);
});

test('public legal navigation includes every canonical policy and matches paths exactly', () => {
  assert.deepEqual(publicLegalLinks, Object.values(platformPolicies).map(policy => ({
    href: policy.path, label: policy.title,
  })));
  for (const { href } of publicLegalLinks) {
    assert.equal(isPublicLegalPath(href), true);
    assert.equal(isPublicLegalPath(`${href}/private`), false);
  }
  for (const path of ['/', '/account', '/privacy-extra', '/admin']) {
    assert.equal(isPublicLegalPath(path), false);
  }
});
