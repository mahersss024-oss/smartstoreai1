import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('account page exposes official contact profile settings', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');

  assert.match(page, /\/api\/account\/profile/);
  assert.match(page, /method: 'DELETE'/);
  assert.match(page, /profilePhoneNumber/);
  assert.match(page, /inputMode="tel"/);
  assert.match(page, /placeholder="05xxxxxxxx"/);
  assert.match(page, /profileDisplayName/);
  assert.match(page, /profilePictureFile/);
  assert.match(page, /\/api\/account\/profile\/picture/);
  assert.match(page, /uploadProfilePicture/);
  assert.match(page, /profilePicturePreview/);
  assert.match(page, /URL\.createObjectURL\(file\)/);
  assert.match(page, /visibleProfilePicture/);
  assert.match(page, /SellerAvatar/);
  assert.match(page, /<FloatingActionNotice/);
  assert.match(page, /open=\{Boolean\(profileNotice\)\}/);
  assert.match(page, /<ActionConfirmDialog/);
  assert.doesNotMatch(page, /window\.confirm/);
  assert.match(page, /رفع صورة العرض/);
  assert.match(page, /تغيير صورة العرض/);
  assert.match(page, /إزالة صورة العرض/);
  assert.match(page, /removeProfilePicture/);
  assert.doesNotMatch(page, /profilePictureUrl/);
  assert.doesNotMatch(page, /رابط صورة الحساب/);
  assert.doesNotMatch(page, /JPG أو PNG أو WEBP حتى 4MB/);
  assert.match(page, /displayName: profileName/);
  assert.doesNotMatch(page, /picture: profilePicture/);
  assert.match(page, /user: payload\.user \?\? null/);
  assert.doesNotMatch(page, /\.\.\.currentSession\.user,\s*\.\.\.payload\.user/);
  assert.match(page, /hasProfileNameChanges/);
  assert.match(page, /hasProfilePhoneChanges/);
  assert.match(page, /hasProfileChanges/);
  assert.match(page, /حفظ التغييرات/);
  assert.doesNotMatch(page, /حفظ الاسم/);
  assert.doesNotMatch(page, /حفظ الاسم الظاهر/);
  assert.doesNotMatch(page, /الاسم الظاهر/);
  assert.match(page, /الملف الشخصي/);
  assert.doesNotMatch(page, /بيانات التواصل الرسمية/);
  assert.match(page, /رقم الاتصال الحالي/);
  assert.doesNotMatch(page, /الرقم الرسمي المحفوظ/);
  assert.match(page, /saveProfile/);
  assert.match(page, /savedProfilePhone/);
  assert.match(page, /ThemeToggle/);
  assert.doesNotMatch(page, /اختر الوضع الليلي أو الفاتح من هنا/);
  assert.doesNotMatch(page, /سيظهر تنبيه أمان بدون منع الإرسال/);
  assert.match(page, /editProfilePhone/);
  assert.match(page, /deleteProfilePhone/);
  assert.match(page, /deleteAccount/);
  assert.match(page, /countContactPhoneCandidates/);
  assert.doesNotMatch(page, /grid gap-3 rounded-md border bg-white p-4 shadow-sm/);
  assert.doesNotMatch(page, /grid gap-4 rounded-md border bg-white p-4 shadow-sm/);
  assert.doesNotMatch(page, /flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white/);
});

test('account hub links do not prefetch every customer section on page load', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');
  const customerHubLinks = [
    '/account/listings',
    '/conversations',
    '/favorites',
    '/notifications',
    '/account/follows',
    '/commissions',
    '/terms',
    '/privacy',
    '/listing-policy',
    '/commission-policy',
    '/admin',
  ];

  for (const href of customerHubLinks) {
    assert.match(
      page,
      new RegExp(`href="${href.replace(/\//g, '\\/')}"\\s+prefetch=\\{false\\}`),
    );
  }
});

test('account hub options use the same row layout as profile settings', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');

  assert.match(page, /href="\/account\/listings" prefetch=\{false\}/);
  assert.match(page, /href="\/conversations" prefetch=\{false\}/);
  assert.match(page, /href="\/favorites" prefetch=\{false\}/);
  assert.match(page, /href="\/notifications" prefetch=\{false\}/);
  assert.match(page, /href="\/account\/follows" prefetch=\{false\}/);
  assert.match(page, /href="\/commissions" prefetch=\{false\}/);
  assert.match(page, /grid-cols-\[auto_minmax\(0,1fr\)\] items-center gap-3/);
  assert.match(page, /grid size-12 place-items-center rounded-md/);
  assert.doesNotMatch(page, /grid grid-cols-2 gap-2/);
  assert.doesNotMatch(page, /grid min-h-24 gap-2 rounded-md/);
}
);

test('theme toggle stays on home and account settings only', () => {
  const accountPage = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');
  const homePage = readFileSync(join(process.cwd(), 'app', 'page.tsx'), 'utf8');
  const pagesWithoutThemeToggle = [
    ['app', 'conversations', 'page.tsx'],
    ['app', 'conversations', '[conversationId]', 'page.tsx'],
    ['app', 'favorites', 'page.tsx'],
    ['app', 'account', 'listings', 'page.tsx'],
    ['app', 'account', 'follows', 'page.tsx'],
  ].map((segments) => readFileSync(join(process.cwd(), ...segments), 'utf8'));

  assert.match(accountPage, /<ThemeToggle language="ar" variant="switch" \/>/);
  assert.match(homePage, /<ThemeToggle language="ar" \/>/);
  assert.match(homePage, /<PushNotificationSettings variant="icon" \/>/);

  for (const source of pagesWithoutThemeToggle) {
    assert.doesNotMatch(source, /ThemeToggle/);
  }
});

test('account page labels each administrative role accurately', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');

  assert.match(page, /session\.user\?\.role === 'owner'/);
  assert.match(page, /\? 'مالك المنصة'/);
  assert.match(page, /session\.user\?\.role === 'admin'/);
  assert.match(page, /\? 'مدير'/);
  assert.match(page, /session\.user\?\.role === 'moderator'/);
  assert.match(page, /\? 'مشرف'/);
  assert.match(page, /\{administrativeRoleLabel\}/);
  assert.doesNotMatch(
    page,
    /session\.user\?\.role === 'moderator'[\s\S]{0,80}: 'مالك المنصة'/,
  );
});

test('account profile api accepts editable display name and secure profile picture URL', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'account', 'profile', 'route.ts'),
    'utf8',
  );

  assert.match(route, /displayName\?: unknown/);
  assert.match(route, /picture\?: unknown/);
  assert.match(route, /normalizeProfileDisplayName/);
  assert.match(route, /normalizeProfilePictureUrl/);
  assert.match(route, /url\.protocol !== 'https:'/);
  assert.match(route, /\{ name: displayName \}/);
  assert.match(route, /\{ picture \}/);
});

test('account profile picture upload stores a persistent display image for the account', () => {
  const route = readFileSync(
    join(
      process.cwd(),
      'app',
      'api',
      'account',
      'profile',
      'picture',
      'route.ts',
    ),
    'utf8',
  );
  const storage = readFileSync(
    join(process.cwd(), 'agent', 'marketplace', 'profile-image-storage.ts'),
    'utf8',
  );
  const objectStorage = readFileSync(
    join(process.cwd(), 'agent', 'marketplace', 'object-storage.ts'),
    'utf8',
  );

  assert.match(route, /export async function POST/);
  assert.match(route, /getAuthSession/);
  assert.match(route, /formData\.get\('image'\)/);
  assert.match(route, /maxProfileImageBytes = 4 \* 1024 \* 1024/);
  assert.match(route, /createSanitizedListingImageOriginal/);
  assert.match(route, /ListingImageSecurityError/);
  assert.match(route, /image_type_mismatch/);
  assert.match(route, /createPersistentProfileImageUrl/);
  assert.match(route, /verifyProfilePictureDelivery/);
  assert.match(route, /profile_picture_delivery_unavailable/);
  assert.match(route, /update: \{ picture \}/);
  assert.match(storage, /objectPrefix: 'profiles'/);
  assert.doesNotMatch(storage, /'image\/gif'/);
  assert.match(objectStorage, /objectPrefix\?: 'listings' \| 'profiles'/);
});

test('account profile picture UI waits for public image delivery before adopting it', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');

  assert.match(page, /image\.onload = applyUploadedPicture/);
  assert.doesNotMatch(page, /image\.onerror = applyUploadedPicture/);
  assert.match(page, /تعذر عرضها من دومين الصور/);
});

test('account page clears a stored profile picture when its public image breaks', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');
  const avatar = readFileSync(join(process.cwd(), 'components', 'seller-avatar.tsx'), 'utf8');

  assert.match(avatar, /onPictureError\?: \(picture: string\) => void/);
  assert.match(avatar, /onPictureError\?\.\(picture\)/);
  assert.match(page, /clearBrokenProfilePicture/);
  assert.match(page, /onPictureError=\{clearBrokenProfilePicture\}/);
  assert.match(page, /fetch\('\/api\/account\/profile\/picture', \{\s*method: 'DELETE'/);
});

test('account profile picture replacement removes the previous stored profile image', () => {
  const route = readFileSync(
    join(
      process.cwd(),
      'app',
      'api',
      'account',
      'profile',
      'picture',
      'route.ts',
    ),
    'utf8',
  );

  assert.match(route, /previousPicture/);
  assert.match(route, /deletePreviousProfilePictureBestEffort/);
  assert.match(route, /deleteListingObject/);
  assert.match(route, /profile_picture_storage_delete/);
});

test('account profile picture removal clears the database and stored object', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'account', 'profile', 'picture', 'route.ts'),
    'utf8',
  );

  assert.match(page, /fetch\('\/api\/account\/profile\/picture'/);
  assert.match(page, /method: 'DELETE'/);
  assert.match(page, /تأكيد إزالة الصورة/);
  assert.match(page, /setPendingAccountConfirm\('remove_picture'\)/);
  assert.doesNotMatch(page, /window\.confirm/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /account_profile_picture_delete/);
  assert.match(route, /data: \{ picture: null \}/);
  assert.match(route, /deletePreviousProfilePictureBestEffort\(user\.id, previousPicture\)/);
});

test('account page keeps listing management free of chat listing shortcuts', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');

  assert.doesNotMatch(page, /ط¥ظ†ط´ط§ط، ط¥ط¹ظ„ط§ظ† ط¨ط§ظ„ظ…ط­ط§ط¯ط«ط©/);
  assert.doesNotMatch(page, /ط¥ط¶ط§ظپط© ط¥ط¹ظ„ط§ظ† ط¹ط¨ط± ط§ظ„ط´ط§طھ/);
  assert.match(page, /href="\/commissions"/);
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
  assert.doesNotMatch(page, /ط·آ§ط¸â€‍ط·آ¹ط¸ث†ط·آ¯ط·آ© ط¸â€‍ط¸â€‍ط·آ³ط¸ث†ط¸â€ڑ/);
});

test('account page links to a real follows list', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');
  const followsPage = readFileSync(
    join(process.cwd(), 'app', 'account', 'follows', 'page.tsx'),
    'utf8',
  );
  const followsRoute = readFileSync(
    join(process.cwd(), 'app', 'api', 'marketplace', 'me', 'follows', 'route.ts'),
    'utf8',
  );
  const repository = readFileSync(
    join(process.cwd(), 'agent', 'marketplace', 'repository.ts'),
    'utf8',
  );

  assert.match(page, /href="\/account\/follows"/);
  assert.match(page, /قائمة المتابعة/);
  assert.match(followsPage, /\/api\/marketplace\/me\/follows/);
  assert.match(
    followsPage,
    /\/api\/marketplace\/users\/\$\{encodeURIComponent\(userId\)\}\/follow/,
  );
  assert.match(followsPage, /المتابِعون/);
  assert.match(followsPage, /أتابعهم/);
  assert.match(followsPage, /إشعارات الإعلانات المتشابهة/);
  assert.match(followsPage, /similarListingFollows/);
  assert.match(followsPage, /toggleSimilarListingFollow/);
  assert.doesNotMatch(followsPage, /المتابَعون/);
  assert.match(followsPage, /useSmartstoreRealtime/);
  assert.match(followsPage, /follow_listing_published/);
  assert.doesNotMatch(followsPage, /latestListing/);
  assert.match(followsPage, /encodeListingHref/);
  assert.doesNotMatch(followsPage, /آخر إعلان/);
  assert.match(followsRoute, /listAccountFollows/);
  assert.match(repository, /export async function listAccountFollows/);
  assert.match(repository, /prisma\.sellerFollow\.findMany/);
  assert.match(repository, /similarListingFollow\.findMany/);
  assert.match(repository, /similarListingFollowCount/);
  assert.doesNotMatch(repository, /latestListingBySellerId/);
});

test('seller profile secondary follow and rating state waits for idle time', () => {
  const actions = readFileSync(
    join(process.cwd(), 'app', 'sellers', '[sellerId]', 'seller-profile-actions.tsx'),
    'utf8',
  );
  const idleTask = readFileSync(join(process.cwd(), 'lib', 'client-idle-task.ts'), 'utf8');

  assert.match(actions, /scheduleIdleTask/);
  assert.match(actions, /\/api\/marketplace\/users\/\$\{encodedSellerId\}\/follow/);
  assert.match(actions, /\/api\/marketplace\/users\/\$\{encodedSellerId\}\/ratings/);
  assert.match(idleTask, /requestIdleCallback/);
});

test('account conversations shortcut stays neutral while alert logic lives in navigation', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');
  const mobileNavigation = readFileSync(
    join(process.cwd(), 'components', 'mobile-bottom-navigation.tsx'),
    'utf8',
  );
  const alertHook = readFileSync(
    join(process.cwd(), 'hooks', 'use-conversation-message-alert.ts'),
    'utf8',
  );

  assert.match(page, /href="\/conversations"/);
  assert.doesNotMatch(page, /useConversationMessageAlert/);
  assert.doesNotMatch(page, /hasConversationAlert/);
  assert.doesNotMatch(page, /shadow-\[0_0_18px_rgba\(244,63,94,0\.28\)\]/);
  assert.doesNotMatch(page, /from-rose-300 to-red-600/);
  assert.match(mobileNavigation, /useConversationMessageAlert/);
  assert.match(mobileNavigation, /alert: hasConversationAlert/);
  assert.doesNotMatch(alertHook, /useSmartstoreRealtime/);
  assert.match(alertHook, /visibilitychange/);
  assert.match(alertHook, /window\.addEventListener\('focus'/);
  assert.match(alertHook, /smartstore_conversation_alert/);
  assert.match(alertHook, /syncUnreadConversations/);
  assert.match(alertHook, /const isUserIdControlled = userId !== undefined/);
  assert.match(alertHook, /if \(currentUserId\) \{\s*void syncUnreadConversations\(\);\s*return;\s*\}/);
  assert.doesNotMatch(alertHook, /if \(currentUserId\) \{\s*setHasConversationAlert\(false\);/);
  assert.match(alertHook, /if \(isUserIdControlled\) \{\s*setHasConversationAlert\(false\);\s*return;\s*\}/);
});

test('sold listings expose a platform fee action after the sale marker', () => {
  const page = readFileSync(
    join(process.cwd(), 'app', 'account', 'listings', 'page.tsx'),
    'utf8',
  );

  assert.match(page, /listing\.rawStatus === 'sold'/);
  assert.match(page, /<Percent className="size-3\.5" \/>/);
  assert.match(page, /\/commissions\?listingId=\$\{listing\.id\}/);
});

test('listing publish requires the commission oath agreement without repeating it for fee calculation', () => {
  const listingsPage = readFileSync(
    join(process.cwd(), 'app', 'account', 'listings', 'page.tsx'),
    'utf8',
  );
  const commissionsPage = readFileSync(
    join(process.cwd(), 'app', 'commissions', 'page.tsx'),
    'utf8',
  );
  const agreementDialog = readFileSync(
    join(process.cwd(), 'components', 'commission-agreement-dialog.tsx'),
    'utf8',
  );

  assert.match(listingsPage, /pendingPublishListing/);
  assert.match(listingsPage, /mode="publish"/);
  assert.doesNotMatch(commissionsPage, /pendingSaleAgreement/);
  assert.doesNotMatch(commissionsPage, /mode="saleAmount"/);
  assert.doesNotMatch(commissionsPage, /CommissionAgreementDialog/);
  assert.match(agreementDialog, /أقسم بالله/);
  assert.match(agreementDialog, /أو بسببها/);
  assert.match(agreementDialog, /رسوم المنصة حق على المعلن/);
  assert.match(agreementDialog, /1% من قيمة البيع/);
  assert.match(
    agreementDialog,
    /وَأَوْفُوا بِعَهْدِ الله إِذَا عَاهَدْتُمْ وَلَا تَنْقُضُوا الْأَيْمَانَ بَعْدَ تَوْكِيدِهَا وَقَدْ جَعَلْتُمُ الله عَلَيْكُمْ كَفِيلًا إِنَّ الله يَعْلَمُ مَا تَفْعَلُونَ/,
  );
});

test('customer listings explain drafts and keep image management lightweight', () => {
  const listingsPage = readFileSync(
    join(process.cwd(), 'app', 'account', 'listings', 'page.tsx'),
    'utf8',
  );

  assert.match(listingsPage, /listing\.rawStatus === 'draft'/);
  assert.match(listingsPage, /pendingPublishListing/);
  assert.match(listingsPage, /إضافة إعلان/);
  assert.doesNotMatch(listingsPage, /قائمة إعلانات العميل/);
  assert.doesNotMatch(listingsPage, /<h2 className="text-base font-bold">إعلاناتي<\/h2>/);
  assert.doesNotMatch(listingsPage, /bg-blue-700\/80/);
  assert.doesNotMatch(listingsPage, /backdrop-blur-\[1px\]/);
  assert.doesNotMatch(listingsPage, /border-cyan-100\/60/);
  assert.doesNotMatch(listingsPage, /aspect-\[16\/10\] w-full/);
  assert.match(listingsPage, /loading="lazy"/);
  assert.match(listingsPage, /decoding="async"/);
  assert.match(listingsPage, /\[content-visibility:auto\]/);
  assert.doesNotMatch(listingsPage, /stats\.published/);
  assert.doesNotMatch(listingsPage, /stats\.drafts/);
  assert.doesNotMatch(listingsPage, /stats\.paused/);
  assert.doesNotMatch(listingsPage, /stats\.sold/);
});

test('customer listings support an eight-image batch and use explicit action labels', () => {
  const listingsPage = readFileSync(
    join(process.cwd(), 'app', 'account', 'listings', 'page.tsx'),
    'utf8',
  );

  assert.match(listingsPage, /multiple/);
  assert.match(listingsPage, /Array\.from\(event\.currentTarget\.files \?\? \[\]\)/);
  assert.match(listingsPage, /Math\.max\(8 - listing\.images\.length, 0\)/);
  assert.match(listingsPage, /files\.slice\(0, remainingImageSlots\)/);
  assert.match(listingsPage, /queueUploadableImagePreparation\(filesToUpload\)/);
  assert.match(listingsPage, /imageManagerListingId/);
  assert.match(listingsPage, /imageManagerListing\.images\.map\(\(image\) =>/);
  assert.match(listingsPage, /setImageManagerListingId\(listing\.id\)/);
  assert.match(listingsPage, /setImagePreviewState/);
  assert.match(listingsPage, /formatImageCount\(imageCount\)/);
  assert.match(listingsPage, /جاري تحميل \$\{imageUploadProgress\.current\} من/);
  assert.match(listingsPage, /upload-progress-track/);
  assert.match(listingsPage, /upload-progress-fill/);
  assert.match(listingsPage, /إدارة الصور/);
  assert.doesNotMatch(listingsPage, /تحميل الصور/);
  assert.doesNotMatch(listingsPage, /grid max-w-full grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8/);
  assert.match(listingsPage, /إيقاف النشر/);
  assert.match(listingsPage, /تم البيع/);
  assert.match(listingsPage, /حذف الإعلان/);
  assert.match(listingsPage, /pendingListingControl/);
  assert.match(listingsPage, /loading=\{pendingControlAction === 'publish'\}/);
  assert.match(listingsPage, /loadingText="جاري النشر\.\.\."/);
  assert.match(listingsPage, /loadingText="جاري الحذف\.\.\."/);
  assert.match(listingsPage, /loading=\{savingListingId === listing\.id\}/);
  assert.match(listingsPage, /loading=\{updatingImageId === image\.id\}/);
  assert.match(listingsPage, /<FloatingActionNotice/);
  assert.match(listingsPage, /<ActionConfirmDialog/);
  assert.match(listingsPage, /open=\{Boolean\(actionResult\)\}/);
  assert.match(listingsPage, /open=\{Boolean\(imageActionNotice\)\}/);
  assert.doesNotMatch(listingsPage, /currentActionResult/);
  assert.doesNotMatch(listingsPage, /currentImageActionNotice/);
  assert.match(listingsPage, /إغلاق نتيجة الإجراء/);
  assert.match(listingsPage, /تم نشر الإعلان بنجاح/);
  assert.match(listingsPage, /تم حذف الإعلان بنجاح/);
  assert.match(listingsPage, /تم حفظ الإعلان/);
  assert.match(listingsPage, /تم حفظ التعديلات\. يمكنك نشر الإعلان من خياراته هنا\./);
  assert.doesNotMatch(
    listingsPage,
    /إذا أردت نشره، انتقل إلى حسابي ← إعلاناتي ثم اختر نشر الإعلان/,
  );
  assert.match(listingsPage, /share: true/);
  assert.match(listingsPage, /pendingImageDelete/);
  assert.match(listingsPage, /هل تريد حذف هذه الصورة من الإعلان؟/);
  assert.doesNotMatch(
    listingsPage,
    /window\.confirm\('هل تريد حذف هذه الصورة من الإعلان؟'\)/,
  );
  assert.match(listingsPage, /تم حذف الصورة/);
  assert.doesNotMatch(listingsPage, /حسنًا/);
  assert.doesNotMatch(listingsPage, /window\.confirm/);
  assert.doesNotMatch(listingsPage, /window\.alert/);
});

test('shared buttons show immediate press and async feedback', () => {
  const button = readFileSync(
    join(process.cwd(), 'components', 'ui', 'button.tsx'),
    'utf8',
  );
  const globals = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

  assert.match(button, /action-feedback-button/);
  assert.match(button, /active:scale-\[0\.98\]/);
  assert.match(button, /loadingText/);
  assert.match(button, /aria-busy=\{loading \|\| undefined\}/);
  assert.match(button, /animate-spin/);
  assert.match(button, /if \(asChild\)/);
  assert.match(button, /disabled=\{disabled \|\| loading\}/);
  assert.match(globals, /action-feedback-shimmer/);
  assert.match(globals, /upload-progress-track/);
  assert.match(globals, /upload-progress-indeterminate/);
});

test('floating action notices use premium theme-aware styling', () => {
  const notice = readFileSync(
    join(process.cwd(), 'components', 'floating-action-notice.tsx'),
    'utf8',
  );

  assert.match(notice, /bg-card\/95/);
  assert.match(notice, /text-card-foreground/);
  assert.match(notice, /dark:border-white\/10/);
  assert.match(notice, /isRichNotice/);
  assert.match(notice, /bg-gradient-to-l/);
  assert.match(notice, /statusLabel/);
  assert.match(notice, /focus-visible:ring-ring/);
  assert.doesNotMatch(notice, /bg-white text-slate-900/);
});

test('customer can edit or delete listings while pending review', () => {
  const listingsPage = readFileSync(
    join(process.cwd(), 'app', 'account', 'listings', 'page.tsx'),
    'utf8',
  );

  assert.match(listingsPage, /function canEditListing\(listing: ListingCard\)/);
  assert.match(listingsPage, /function canDeleteListing\(listing: ListingCard\)/);
  assert.match(listingsPage, /listing\.rawStatus !== 'deleted'/);
  assert.doesNotMatch(listingsPage, /listing\.rawStatus !== 'pending'/);
  assert.match(listingsPage, /\{canEditListing\(listing\) && \(/);
  assert.match(listingsPage, /\{canDeleteListing\(listing\) && \(/);
});

test('published customer listings hide publish while keeping management actions', () => {
  const listingsPage = readFileSync(
    join(process.cwd(), 'app', 'account', 'listings', 'page.tsx'),
    'utf8',
  );

  assert.match(listingsPage, /function canPublishListing\(listing: ListingCard\)/);
  assert.match(listingsPage, /\['draft', 'paused', 'rejected'\]\.includes/);
  assert.doesNotMatch(listingsPage, /\['draft', 'pending', 'published'/);
  assert.match(listingsPage, /function canPauseListing\(listing: ListingCard\)/);
  assert.match(listingsPage, /listing\.rawStatus === 'published'/);
  assert.match(listingsPage, /function canMarkListingSold\(listing: ListingCard\)/);
  assert.match(listingsPage, /listing\.rawStatus === 'published' \|\| listing\.rawStatus === 'paused'/);
  assert.match(listingsPage, /\{canPublishListing\(listing\) && \(/);
  assert.match(listingsPage, /\{canPauseListing\(listing\) && \(/);
  assert.match(listingsPage, /\{canMarkListingSold\(listing\) && \(/);
});

test('account page does not flash sign-in controls while session is loading', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');
  const sessionHook = readFileSync(
    join(process.cwd(), 'hooks', 'use-auth-session.tsx'),
    'utf8',
  );

  assert.match(page, /useAuthSession/);
  assert.match(sessionHook, /const \[isSessionLoading, setIsSessionLoading\] = useState\(true\)/);
  assert.match(sessionHook, /fetch\('\/api\/auth\/session'/);
  assert.match(page, /isSessionLoading \? \(/);
  assert.match(page, /: !session\.authenticated \? \(/);
});

test('signed-in customer pages hide sign-in controls until session check finishes', () => {
  const protectedPages = [
    ['app', 'conversations', 'page.tsx'],
    ['app', 'favorites', 'page.tsx'],
    ['app', 'commissions', 'page.tsx'],
    ['app', 'account', 'follows', 'page.tsx'],
  ];

  for (const segments of protectedPages) {
    const page = readFileSync(join(process.cwd(), ...segments), 'utf8');

    assert.match(page, /useAuthSession/);
    assert.match(page, /isSessionLoading/);
    assert.match(page, /!session\.authenticated/);
  }
});

test('signed-in customer pages do not fetch protected account data before session is known', () => {
  const protectedPages = [
    ['app', 'conversations', 'page.tsx'],
    ['app', 'favorites', 'page.tsx'],
    ['app', 'commissions', 'page.tsx'],
    ['app', 'conversations', '[conversationId]', 'page.tsx'],
    ['app', 'account', 'follows', 'page.tsx'],
  ];

  for (const segments of protectedPages) {
    const page = readFileSync(join(process.cwd(), ...segments), 'utf8');

    assert.match(page, /useAuthSession/);
    assert.match(page, /if \(isSessionLoading\)/);
    assert.doesNotMatch(
      page,
      /fetch\('\/api\/auth\/session'/,
    );
  }
});

test('platform fees page can focus the sold listing fee from the account link', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'commissions', 'page.tsx'), 'utf8');

  assert.match(page, /window\.location\.href/);
  assert.match(page, /targetListingId/);
  assert.match(page, /orderedCommissions/);
  assert.match(page, /targetCommission\?\.status === 'pending_amount'/);
});

test('platform fees summary highlights due fees and labels transactions clearly', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'commissions', 'page.tsx'), 'utf8');

  assert.match(page, /الرسوم المستحقة/);
  assert.match(page, /عدد المعاملات/);
  assert.match(page, /rounded-md bg-blue-600/);
  assert.doesNotMatch(page, /عدد السجلات/);
});

test('customer listing edit keeps the card in place after save', () => {
  const listingsPage = readFileSync(
    join(process.cwd(), 'app', 'account', 'listings', 'page.tsx'),
    'utf8',
  );

  assert.match(listingsPage, /setListings\(\(currentListings\) =>/);
  assert.match(listingsPage, /currentListing\.id === savedListing\.id/);
  assert.doesNotMatch(
    listingsPage,
    /setActionResult\([\s\S]{0,400}await refreshListings\(1\)/,
  );
});
