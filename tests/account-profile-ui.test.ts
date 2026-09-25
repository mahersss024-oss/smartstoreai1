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
  assert.match(page, /رفع صورة عرض الحساب/);
  assert.doesNotMatch(page, /profilePictureUrl/);
  assert.doesNotMatch(page, /رابط صورة الحساب/);
  assert.doesNotMatch(page, /JPG أو PNG أو WEBP حتى 4MB/);
  assert.match(page, /displayName: profileName/);
  assert.match(page, /picture: profilePicture/);
  assert.match(page, /hasProfileIdentityChanges/);
  assert.match(page, /saveProfile/);
  assert.match(page, /savedProfilePhone/);
  assert.match(page, /editProfilePhone/);
  assert.match(page, /deleteProfilePhone/);
  assert.match(page, /deleteAccount/);
  assert.match(page, /countContactPhoneCandidates/);
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
});

test('sold listings expose a platform fee action after the sale marker', () => {
  const page = readFileSync(
    join(process.cwd(), 'app', 'account', 'listings', 'page.tsx'),
    'utf8',
  );

  assert.match(page, /listing\.rawStatus === 'sold'/);
  assert.match(page, /bg-blue-700\/80/);
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

test('customer listings explain drafts and use a branded sold watermark', () => {
  const listingsPage = readFileSync(
    join(process.cwd(), 'app', 'account', 'listings', 'page.tsx'),
    'utf8',
  );

  assert.match(listingsPage, /listing\.rawStatus === 'draft'/);
  assert.match(listingsPage, /pendingPublishListing/);
  assert.match(listingsPage, /bg-blue-700\/80/);
  assert.match(listingsPage, /backdrop-blur-\[1px\]/);
  assert.match(listingsPage, /border-cyan-100\/60/);
});

test('account page does not flash sign-in controls while session is loading', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');

  assert.match(page, /const \[isSessionLoading, setIsSessionLoading\] = useState\(true\)/);
  assert.match(page, /setIsSessionLoading\(false\)/);
  assert.match(page, /isSessionLoading \? \(/);
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
  assert.match(page, /targetCommission\?\.status === 'pending_amount'/);
});
