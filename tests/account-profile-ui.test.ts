import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('retained mobile web runtime keeps its guarded delete action', () => {
  const deletePage = readFileSync(join(process.cwd(), 'mobile-web', 'runtime', 'policy-page.tsx'), 'utf8');
  const deleteAction = readFileSync(
    join(process.cwd(), 'components', 'delete-account-action.tsx'),
    'utf8',
  );
  const policyPage = readFileSync(
    join(process.cwd(), 'components', 'legal-policy-page.tsx'),
    'utf8',
  );

  assert.match(deletePage, /<DeleteAccountAction \/>/);
  assert.match(policyPage, /children\?: ReactNode/);
  assert.match(deleteAction, /fetch\('\/api\/account\/profile', \{\s*method: 'DELETE'/);
  assert.match(deleteAction, /type="checkbox"/);
  assert.match(deleteAction, /disabled=\{!acknowledged\}/);
  assert.match(deleteAction, /<ActionConfirmDialog/);
  assert.match(deleteAction, /تأكيد حذف الحساب/);
  assert.match(deleteAction, /router\.replace\('\/'\)/);
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
  assert.match(route, /profileImageCleanupInput/);
  assert.match(route, /enqueueImageObjectCleanup/);
  assert.match(route, /processImageObjectCleanup/);
  assert.match(route, /profile_picture_storage_delete/);
});

test('account profile picture removal clears the database and stored object', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'account', 'profile', 'picture', 'route.ts'),
    'utf8',
  );

  assert.match(route, /export async function DELETE/);
  assert.match(route, /account_profile_picture_delete/);
  assert.match(route, /data: \{ picture: null \}/);
  assert.match(route, /deletePreviousProfilePictureBestEffort\(user\.id, previousPicture\)/);
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

test('listing publish requires the commission oath agreement without repeating it for fee calculation', () => {
  const commissionsPage = readFileSync(
    join(process.cwd(), 'app', 'commissions', 'page.tsx'),
    'utf8',
  );
  const agreementDialog = readFileSync(
    join(process.cwd(), 'components', 'commission-agreement-dialog.tsx'),
    'utf8',
  );

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

test('signed-in customer pages hide sign-in controls until session check finishes', () => {
  const protectedPages = [
    ['app', 'conversations', 'page.tsx'],
    ['app', 'favorites', 'page.tsx'],
    ['app', 'commissions', 'page.tsx'],
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
