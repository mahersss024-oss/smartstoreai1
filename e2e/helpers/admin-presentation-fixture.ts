import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSessionCookie } from '@/lib/auth/session';

export const now = '2026-10-17T10:00:00.000Z';
export const customer = {
  id: 'google:' + '1'.repeat(40),
  name: 'عميل الاختبار',
  email: 'customer@example.test',
  role: 'user',
  phoneNumber: '0500000000',
  createdAt: now,
  updatedAt: now,
  counts: {
    listings: 1,
    conversations: 1,
    messages: 3,
    favorites: 0,
    reports: 0,
    userReportsReceived: 1,
    commissions: 1,
    pushSubscriptions: 0,
  },
};
export const listing = {
  id: 'presentation-listing',
  sellerId: customer.id,
  seller: { name: customer.name, email: customer.email },
  title: 'إعلان الاختبار',
  description: 'وصف الإعلان الأصلي',
  category: 'other',
  city: 'الرياض',
  condition: 'used',
  price: 100,
  priceMode: null,
  status: 'published',
  images: [],
  views: 3,
  messageCount: 2,
  favoriteCount: 1,
  compliance: { decision: 'allow', reasons: [] },
};
export const report = {
  id: 'presentation-report',
  listingId: listing.id,
  reporterId: customer.id,
  reason: 'fraud',
  details: 'تفاصيل البلاغ الأصلية',
  status: 'open',
  createdAt: now,
  listing,
};
export const pagination = {
  page: 1,
  limit: 20,
  total: 1,
  hasMore: false,
  nextPage: null,
};

export async function prepare(page: Page, baseURL: string, role = 'admin') {
  const user = {
    id: 'presentation-admin',
    email: 'presentation-admin@example.test',
    role,
  };
  const [name, value] = createSessionCookie(user).split(';')[0].split('=');
  await page.context().addCookies([{ name, value, url: baseURL }]);
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { authenticated: true, user } }),
  );
  const writes: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  await page.route('**/api/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === 'GET' &&
      url.searchParams.get('view') === 'notifications'
    )
      return route.fulfill({
        json: { notifications: [], page: 1, hasMore: false },
      });
    if (url.searchParams.has('asset'))
      return route.fulfill({
        contentType: 'image/webp',
        body: readFileSync(
          join(process.cwd(), 'public/hamad-market-logo.webp'),
        ),
      });
    if (request.method() !== 'GET') {
      const body = request.postDataJSON();
      writes.push({ path: url.pathname, method: request.method(), body });
      return route.fulfill({
        json: { ok: true, user: { ...customer, ...body } },
      });
    }
    if (/\/moderation\/(reports|user-reports)\//.test(url.pathname))
      return route.fulfill({
        json: {
          evidenceCase: {
            id: 'case',
            status: 'open',
            captureStatus: 'complete',
            snapshotHash: 'a'.repeat(64),
            retainUntil: null,
            legalHold: false,
            snapshot: {
              listing: { ...listing, searchText: 'technical original text' },
              report,
              participants: [
                { id: customer.id, name: customer.name, email: customer.email },
              ],
              messages: [
                {
                  id: 'saved-message',
                  senderId: customer.id,
                  body: 'رسالة محفوظة دون تغيير',
                  createdAt: now,
                },
              ],
              commissions: [],
            },
          },
          assets: [{ id: 'image-1', status: 'stored', lastError: null }],
          events: Array.from({ length: 8 }, (_, i) => ({
            id: String(i),
            action: i ? 'asset.viewed' : 'case.opened',
            actorId: customer.id,
            createdAt: now,
            payload: i
              ? { assetId: 'b'.repeat(64), sha256: 'c'.repeat(64) }
              : { legacy: null },
          })),
          page: 1,
          hasMore: false,
        },
      });
    const json = url.pathname.endsWith('/users')
      ? { users: [customer], pagination }
      : url.pathname.endsWith('/listings')
        ? { listings: [listing], pagination }
        : url.pathname.endsWith('/commissions')
          ? {
              commissions: [
                {
                  id: 'fee',
                  listingId: listing.id,
                  listing,
                  sellerId: customer.id,
                  productValue: 100,
                  commissionAmount: 1,
                  commissionRatePercent: 1,
                  status: 'due',
                  createdAt: now,
                  updatedAt: now,
                },
              ],
              pagination,
            }
          : url.pathname.endsWith('/moderation')
            ? { listings: [], reports: [report], userReports: [] }
            : url.pathname.endsWith('/audit-log')
              ? {
                  records: [
                    {
                      id: 'audit',
                      action: 'update_listing',
                      targetType: 'listing',
                      targetId: listing.id,
                      metadata: {
                        before: { status: 'pending' },
                        after: { status: 'published' },
                      },
                      createdAt: now,
                      admin: user,
                    },
                  ],
                  pagination,
                }
              : url.pathname.endsWith('/maintenance')
                ? {
                    counts: {
                      deletedListings: 1,
                      deletedListingImages: 2,
                      closedReports: 1,
                      closedUserReports: 1,
                      searchStates: 0,
                      idempotencyKeys: 0,
                    },
                  }
                : url.pathname.endsWith('/site-message')
                  ? {
                      siteMessage: {
                        message: 'رسالة الاختبار',
                        type: 'info',
                        isEnabled: false,
                        expiresAt: null,
                      },
                    }
                  : url.searchParams.get('view') === 'workspace'
                    ? {
                        month: new Date().toISOString().slice(0, 7),
                        listings: [],
                        evidence: [],
                        commissions: [],
                        visits: [],
                        events: [],
                        hasMoreEvents: false,
                      }
                    : {
                        totalUsers: 9,
                        activeUsers: 2,
                        publishedListings: 5,
                        openReports: 1,
                      };
    return route.fulfill({ json });
  });
  return writes;
}
