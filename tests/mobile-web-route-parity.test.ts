import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

import { isSafeInternalPath } from '@/lib/native/deep-links';

const appRoot = join(process.cwd(), 'app');
const routerSource = readFileSync(
  join(process.cwd(), 'mobile-web', 'runtime', 'router.tsx'),
  'utf8',
);
const routeHostSource = readFileSync(
  join(process.cwd(), 'mobile-web', 'runtime', 'route-host.tsx'),
  'utf8',
);

function collectPageRoutes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'api' || entry.name.startsWith('_')) return [];
      return collectPageRoutes(entryPath);
    }

    if (entry.name !== 'page.tsx') return [];

    const route = relative(appRoot, directory)
      .split(sep)
      .filter((segment) => segment && !/^\([^/]+\)$/.test(segment))
      .join('/');
    return [`/${route}`.replace(/\/$/, '') || '/'];
  });
}

function readRouteSet(source: string) {
  const routeSet = source.match(/const staticRoutes = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(routeSet, 'the mobile router must declare its local static routes');
  return [...routeSet[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('the mobile web host represents current app routes and keeps the retired root unavailable', () => {
  const appRoutes = collectPageRoutes(appRoot).sort();
  const dynamicRoutes = appRoutes.filter((route) => route.includes('['));
  const staticAppRoutes = appRoutes.filter((route) => !route.includes('['));
  const localRoutes = readRouteSet(routerSource).sort();
  const hostedStaticRoutes = [...routeHostSource.matchAll(/if \(pathname === '([^']+)'\)/g)]
    .map((match) => match[1])
    .sort();

  assert.ok(!staticAppRoutes.includes('/'), 'the public market homepage remains removed');
  assert.deepEqual(localRoutes, [...staticAppRoutes, '/'].sort());
  assert.deepEqual(hostedStaticRoutes, [...staticAppRoutes, '/'].sort());
  assert.ok(routeHostSource.includes("if (pathname === '/') return <MobileNotFoundPage />;"));
  assert.deepEqual(dynamicRoutes, [
    '/conversations/[conversationId]',
    '/listings/[listingId]',
    '/sellers/[sellerId]',
  ]);

  for (const route of appRoutes) {
    const deepLinkPath = route.replace(/\[[^/]+\]/g, 'sample_123');
    assert.equal(
      isSafeInternalPath(deepLinkPath),
      true,
      `the application deep-link validator must allow ${route}`,
    );
  }

  for (const [route, matchName, collection] of [
    ['/conversations/[conversationId]', 'conversationMatch', 'conversations'],
    ['/listings/[listingId]', 'listingMatch', 'listings'],
    ['/sellers/[sellerId]', 'sellerMatch', 'sellers'],
  ]) {
    const matchLine = routeHostSource
      .split(/\r?\n/)
      .find((line) => line.includes(`const ${matchName} = pathname.match`));
    assert.ok(matchLine?.includes(collection), `${route} has a matching route pattern`);
    assert.match(routeHostSource, new RegExp(`if \\(${matchName}\\)`));
    assert.ok(
      routerSource.includes(String.raw`/^\/${collection}\/[^/]+$/`),
      `${route} can be loaded by the local router`,
    );
  }
});
test('surviving web pages do not link to removed account routes', () => {
  const retainedPages = [
    'app/favorites/page.tsx',
    'app/conversations/page.tsx',
    'app/notifications/page.tsx',
    'app/commissions/page.tsx',
  ];
  const pageSources = retainedPages.map(path => readFileSync(join(process.cwd(), path), 'utf8'));
  const adminShell = readFileSync(join(process.cwd(), 'components/admin/admin-shell.tsx'), 'utf8');
  for (const pageSource of pageSources) assert.doesNotMatch(pageSource, /href=["']\/account(?:[/?#]|$)/);
  assert.match(adminShell, /href="\/admin"/);
  assert.doesNotMatch(adminShell, /href="\/account"/);
});
