import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { getPublicListingPath, getPublicListingUrl } from '@/lib/listing-url';
import { getPublicSellerPath, getPublicSellerUrl } from '@/lib/seller-url';

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

test('public seller urls are stable profile links without listing context', () => {
  assert.equal(getPublicSellerPath('seller:share 1'), '/sellers/seller%3Ashare%201');
  assert.equal(
    getPublicSellerUrl('seller:share 1', 'https://www.smartstore-ai.com/'),
    'https://www.smartstore-ai.com/sellers/seller%3Ashare%201',
  );
});test('published listings expose share controls in detail pages', () => {
  const shareButton = readProjectFile('components', 'listing-share-button.tsx');
  const listingPage = readProjectFile('app', 'listings', '[listingId]', 'page.tsx');
  assert.match(shareButton, /navigator\.share/);
  assert.match(shareButton, /navigator\.clipboard/);
  assert.match(shareButton, /postToNative/);
  assert.match(listingPage, /generateMetadata/);
});

test('listing details exposes a copy action for the listing id', () => {
  const listingPage = readProjectFile('app', 'listings', '[listingId]', 'page.tsx');
  const copyButton = readProjectFile(
    'app',
    'listings',
    '[listingId]',
    'listing-id-copy-button.tsx',
  );

  assert.match(listingPage, /encodeURIComponent/);
  assert.match(copyButton, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(copyButton, /aria-label="نسخ رقم الإعلان"/);
});

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

test('listing detail secondary action state waits for idle time', () => {
  const safetyActions = readProjectFile(
    'app',
    'listings',
    '[listingId]',
    'listing-safety-actions.tsx',
  );
  const similarFollowButton = readProjectFile(
    'app',
    'listings',
    '[listingId]',
    'similar-follow-button.tsx',
  );
  const idleTask = readProjectFile('lib', 'client-idle-task.ts');

  assert.match(safetyActions, /scheduleIdleTask/);
  assert.match(similarFollowButton, /scheduleIdleTask/);
  assert.match(idleTask, /requestIdleCallback/);
  assert.match(idleTask, /cancelIdleCallback/);
});

test('listing details localizes visible attribute labels and common values', () => {
  const listingPage = readProjectFile('components', 'admin', 'customer-record-preview.tsx');
  const presentation = readProjectFile('lib', 'marketplace', 'listing-presentation.ts');

  assert.match(presentation, /model: 'الموديل'/);
  assert.match(presentation, /year: 'سنة الصنع'/);
  assert.match(presentation, /mileageKm: 'الممشى'/);
  assert.match(presentation, /transmission: 'ناقل الحركة'/);
  assert.match(presentation, /fuelType: 'نوع الوقود'/);
  assert.match(presentation, /inspectionStatus: 'حالة الفحص'/);
  assert.match(presentation, /paymentMethod: 'طريقة الدفع'/);
  assert.match(presentation, /deliveryMethod: 'طريقة التسليم'/);
  assert.match(presentation, /warrantyStatus: 'حالة الضمان'/);
  assert.match(presentation, /propertyType: 'نوع العقار'/);
  assert.match(presentation, /screenSize: 'حجم الشاشة'/);
  assert.match(presentation, /automatic: 'أوتوماتيك'/);
  assert.match(presentation, /gasoline: 'بنزين'/);
  assert.match(presentation, /valid: 'سليم'/);
  assert.match(presentation, /fixed: 'سعر ثابت'/);
  assert.match(presentation, /open_to_offers: 'يقبل العروض'/);
  assert.match(presentation, /bank_transfer: 'تحويل بنكي'/);
  assert.match(presentation, /free_shipping: 'شحن مجاني'/);
  assert.match(presentation, /under_warranty: 'تحت الضمان'/);
  assert.match(presentation, /apartment: 'شقة'/);
  assert.match(presentation, /return labels\[key\] \?\? labels\[normalizedKey\] \?\? labels\[camelKey\] \?\? 'تفصيل إضافي'/);
  assert.match(listingPage, /from '@\/lib\/marketplace\/listing-presentation'/);
  assert.match(listingPage, /formatAttributeLabel\(key\)/);
  assert.match(listingPage, /formatAttributeValue\(key, value\)/);
});

test('listing contact passes the selected listing into the conversation page', () => {
  const contactActions = readProjectFile(
    'app',
    'listings',
    '[listingId]',
    'contact-actions.tsx',
  );
  const listingPage = readProjectFile('app', 'listings', '[listingId]', 'page.tsx');
  const repository = readProjectFile('agent', 'marketplace', 'repository.ts');

  assert.match(contactActions, /\?listingId=\$\{encodeURIComponent\(listingId\)\}/);
  assert.match(contactActions, /sellerPhoneNumber/);
  assert.match(contactActions, /cleanSellerPhoneNumber/);
  assert.match(contactActions, /href=\{`tel:\$\{cleanSellerPhoneNumber\}`\}/);
  assert.match(contactActions, /setIsContactSheetOpen\(true\)/);
  assert.match(contactActions, /مراسلة داخل سوق حمد/);
  assert.match(contactActions, /التواصل مع المعلن/);
  assert.match(listingPage, /CustomerAppGateway/);
  assert.match(repository, /phoneNumber\?: string/);
  assert.match(repository, /phoneNumber: true/);
});

test('assistant context contains owned drafts only and directs manual review without retrieving other sellers', () => {
  const marketplaceTools = readProjectFile('agent', 'tools', 'marketplace.ts');
  const chatRoute = readProjectFile('app', 'api', 'chat', 'route.ts');
  const marketplaceInstructions = readProjectFile('agent', 'marketplace', 'agents.ts');

  assert.doesNotMatch(marketplaceTools, /searchMarketplaceListings|compareMarketplaceListings|listMarketplaceListings/);
  assert.match(chatRoute, /drafts\.filter\(listing => listing\.status === 'draft'\)/);
  assert.match(chatRoute, /reviewUrl: '\/account\/listings'/);
  assert.doesNotMatch(chatRoute, /getVerifiedSelectedListingContext|getListing\(parsed\.id\)/);
  assert.match(marketplaceInstructions, /customer reviews and publishes from \/account\/listings themselves/);
});
