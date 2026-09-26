import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('account page exposes official contact profile settings', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');

  assert.match(page, /\/api\/account\/profile/);
  assert.match(page, /method: 'DELETE'/);
  assert.match(page, /Phone/);
  assert.match(page, /inputMode="tel"/);
  assert.match(page, /placeholder="05xxxxxxxx"/);
  assert.match(page, /profileDisplayName/);
  assert.match(page, /profilePictureFile/);
  assert.match(page, /\/api\/account\/profile\/picture/);
  assert.match(page, /uploadProfilePicture/);
  assert.match(page, /profilePicturePreview/);
  assert.match(page, /URL\.createObjectURL\(file\)/);
  assert.match(page, /visibleProfilePicture/);
  assert.match(page, /decoding="async"/);
  assert.match(page, /رفع صورة عرض الحساب/);
  assert.doesNotMatch(page, /profilePictureUrl/);
  assert.doesNotMatch(page, /رابط صورة الحساب/);
  assert.doesNotMatch(page, /JPG أو PNG أو WEBP حتى 4MB/);
  assert.match(page, /displayName: profileName/);
  assert.match(page, /picture: profilePicture/);
  assert.match(page, /hasProfileNameChanges/);
  assert.match(page, /حفظ الاسم الظاهر/);
  assert.match(page, /saveProfile/);
  assert.match(page, /savedProfilePhone/);
  assert.match(page, /editProfilePhone/);
  assert.match(page, /deleteProfilePhone/);
  assert.match(page, /deleteAccount/);
  assert.match(page, /countContactPhoneCandidates/);
  assert.doesNotMatch(page, /grid gap-3 rounded-md border bg-white p-4 shadow-sm/);
  assert.doesNotMatch(page, /grid gap-4 rounded-md border bg-white p-4 shadow-sm/);
  assert.doesNotMatch(page, /flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white/);
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
  assert.match(route, /createPersistentProfileImageUrl/);
  assert.match(route, /update: \{ picture \}/);
  assert.match(storage, /objectPrefix: 'profiles'/);
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
  assert.match(route, /deleteListingObject/);
  assert.match(route, /profile_picture_storage_delete/);
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
  assert.match(followsPage, /المتابعون/);
  assert.match(followsPage, /المتابَعون/);
  assert.match(followsRoute, /listAccountFollows/);
  assert.match(repository, /export async function listAccountFollows/);
  assert.match(repository, /prisma\.sellerFollow\.findMany/);
});

test('account conversations shortcut highlights new message alerts on web', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');
  const alertHook = readFileSync(
    join(process.cwd(), 'hooks', 'use-conversation-message-alert.ts'),
    'utf8',
  );

  assert.match(page, /useConversationMessageAlert/);
  assert.match(page, /userId: session\.user\?\.id \?\? null/);
  assert.match(page, /hasConversationAlert/);
  assert.match(page, /href="\/conversations"/);
  assert.match(page, /shadow-\[0_0_18px_rgba\(244,63,94,0\.28\)\]/);
  assert.match(page, /from-rose-300 to-red-600/);
  assert.match(alertHook, /eventTypes: \['message_created', 'conversation_updated'\]/);
  assert.match(alertHook, /smartstore_conversation_alert/);
  assert.match(alertHook, /senderId !== currentUserId/);
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

test('listing publish and sale amount require the commission oath agreement', () => {
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
  assert.match(commissionsPage, /pendingSaleAgreement/);
  assert.match(commissionsPage, /mode="saleAmount"/);
  assert.match(agreementDialog, /أقسم بالله/);
  assert.match(agreementDialog, /أو بسببها/);
  assert.match(agreementDialog, /رسوم المنصة حق على المعلن/);
  assert.match(agreementDialog, /1% من قيمة البيع/);
});

test('customer listings explain drafts and keep image management lightweight', () => {
  const listingsPage = readFileSync(
    join(process.cwd(), 'app', 'account', 'listings', 'page.tsx'),
    'utf8',
  );

  assert.match(listingsPage, /listing\.rawStatus === 'draft'/);
  assert.match(listingsPage, /pendingPublishListing/);
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
