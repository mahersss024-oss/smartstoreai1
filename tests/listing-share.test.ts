import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { getPublicListingPath, getPublicListingUrl } from '@/lib/listing-url';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('public listing urls are stable and shareable', () => {
  assert.equal(getPublicListingPath('listing:share 1'), '/listings/listing%3Ashare%201');
  assert.equal(
    getPublicListingUrl('listing:share 1', 'https://www.smartstore-ai.com/'),
    'https://www.smartstore-ai.com/listings/listing%3Ashare%201',
  );
});

test('published listings expose share controls in seller account and details pages', () => {
  const shareButton = readProjectFile('components', 'listing-share-button.tsx');
  const accountListingsPage = readProjectFile('app', 'account', 'listings', 'page.tsx');
  const listingPage = readProjectFile('app', 'listings', '[listingId]', 'page.tsx');

  assert.match(shareButton, /navigator\.share/);
  assert.match(shareButton, /navigator\.clipboard/);
  assert.match(shareButton, /postToNative/);
  assert.match(accountListingsPage, /listing\.status === 'published'/);
  assert.match(accountListingsPage, /<ListingShareButton/);
  assert.match(listingPage, /<ListingShareButton/);
});

test('listing owner details page keeps only share action visible', () => {
  const listingPage = readProjectFile('app', 'listings', '[listingId]', 'page.tsx');
  const safetyActions = readProjectFile(
    'app',
    'listings',
    '[listingId]',
    'listing-safety-actions.tsx',
  );

  assert.match(listingPage, /getAuthSession/);
  assert.match(listingPage, /const isOwnListing = session\?\.user\.id === listing\.sellerId/);
  assert.match(listingPage, /!\s*isOwnListing && <ListingContactActions/);
  assert.match(listingPage, /!\s*isOwnListing && \(/);
  assert.match(listingPage, /isOwnListing \? 'col-span-2' : ''/);
  assert.match(listingPage, /isOwnListing=\{isOwnListing\}/);
  assert.match(safetyActions, /isOwnListing = false/);
  assert.match(safetyActions, /useState\(!isOwnListing\)/);
  assert.match(safetyActions, /canShowReport = showReport && !isOwnListing/);
  assert.match(safetyActions, /canShowFavorite = showFavorite && canFavorite && !isOwnListing/);
}
);

test('listing details actions surface network failures clearly', () => {
  const contactActions = readProjectFile(
    'app',
    'listings',
    '[listingId]',
    'contact-actions.tsx',
  );
  const safetyActions = readProjectFile(
    'app',
    'listings',
    '[listingId]',
    'listing-safety-actions.tsx',
  );

  assert.match(contactActions, /catch \{/);
  assert.match(contactActions, /تعذر فتح المحادثة الآن/);
  assert.match(safetyActions, /catch \{/);
  assert.match(safetyActions, /تعذر إرسال البلاغ الآن/);
});

test('listing details localizes visible attribute labels and common values', () => {
  const listingPage = readProjectFile('app', 'listings', '[listingId]', 'page.tsx');

  assert.match(listingPage, /model: 'الموديل'/);
  assert.match(listingPage, /year: 'سنة الصنع'/);
  assert.match(listingPage, /mileageKm: 'الممشى'/);
  assert.match(listingPage, /transmission: 'ناقل الحركة'/);
  assert.match(listingPage, /fuelType: 'نوع الوقود'/);
  assert.match(listingPage, /inspectionStatus: 'حالة الفحص'/);
  assert.match(listingPage, /paymentMethod: 'طريقة الدفع'/);
  assert.match(listingPage, /deliveryMethod: 'طريقة التسليم'/);
  assert.match(listingPage, /warrantyStatus: 'حالة الضمان'/);
  assert.match(listingPage, /propertyType: 'نوع العقار'/);
  assert.match(listingPage, /screenSize: 'حجم الشاشة'/);
  assert.match(listingPage, /automatic: 'أوتوماتيك'/);
  assert.match(listingPage, /gasoline: 'بنزين'/);
  assert.match(listingPage, /valid: 'سليم'/);
  assert.match(listingPage, /fixed: 'سعر ثابت'/);
  assert.match(listingPage, /open_to_offers: 'يقبل العروض'/);
  assert.match(listingPage, /bank_transfer: 'تحويل بنكي'/);
  assert.match(listingPage, /free_shipping: 'شحن مجاني'/);
  assert.match(listingPage, /under_warranty: 'تحت الضمان'/);
  assert.match(listingPage, /apartment: 'شقة'/);
  assert.match(listingPage, /return labels\[key\] \?\? labels\[normalizedKey\] \?\? labels\[camelKey\] \?\? 'تفصيل إضافي'/);
  assert.match(listingPage, /formatAttributeLabel\(key\)/);
  assert.match(listingPage, /formatAttributeValue\(key, value\)/);
});

test('home listing contact button opens listing details instead of asking chat to open a conversation', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /onOpen\(listing\)/);
  assert.doesNotMatch(homePage, /أريد التواصل مع البائع بخصوص الإعلان رقم/);
});

test('assistant marketplace context can share real listing links without opening conversations', () => {
  const marketplaceTools = readProjectFile('agent', 'tools', 'marketplace.ts');
  const chatRoute = readProjectFile('app', 'api', 'chat', 'route.ts');
  const marketplaceInstructions = readProjectFile('agent', 'marketplace', 'agents.ts');

  assert.match(marketplaceTools, /listingUrl: getPublicListingUrl\(listing\.id\)/);
  assert.match(chatRoute, /listingUrl:/);
  assert.match(chatRoute, /getPublicListingUrl\(listing\.id/);
  assert.match(chatRoute, /\[فتح الإعلان\]\(\$\{listingUrl\}\)/);
  assert.match(marketplaceInstructions, /\[فتح الإعلان\]\(listingUrl\)/);
  assert.match(chatRoute, /links only/);
  assert.match(chatRoute, /do not create or open conversations from assistant chat/);
});

test('assistant message renderer turns listing links into a listing card inside chat', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /function getListingHrefFromMarkdownLink/);
  assert.match(homePage, /normalizedLabel === 'فتح الإعلان'/);
  assert.match(homePage, /normalizedLabel === 'open listing'/);
  assert.match(homePage, /\^\\\/listings\\\/\[\^\/\]\+/);
  assert.match(homePage, /return `\$\{url\.pathname\}\$\{url\.search\}\$\{url\.hash\}`/);
  assert.match(homePage, /function ListingChatLinkCard/);
  assert.match(homePage, /<Link[\s\S]*href=\{href\}/);
  assert.match(homePage, /listing\?: ListingCard/);
  assert.match(homePage, /listing\?\.image/);
  assert.match(homePage, /chatListingCardsById/);
  assert.match(homePage, /getListingIdFromHref\(listingHref\)/);
  assert.match(homePage, /عرض بطاقة الإعلان/);
  assert.match(homePage, /return renderTextMessagePart\(part\.text, index, listingsById\)/);
  assert.match(homePage, /فتح الإعلان/);
});
