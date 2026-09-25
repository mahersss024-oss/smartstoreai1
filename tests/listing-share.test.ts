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
