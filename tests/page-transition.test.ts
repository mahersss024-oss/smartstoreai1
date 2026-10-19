import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  beginPageTransition,
  cancelPageTransition,
  commitPageTransition,
  getPageTransitionDirection,
  subscribePageTransitions,
  type PendingPageTransition,
} from '@/lib/navigation/page-transition';

const url = (path: string) => new URL(path, 'https://market.example.test');

test('page navigation slides forward into details and back into shallower pages', () => {
  assert.equal(getPageTransitionDirection(url('/'), url('/listings/item'), 'push'), 'forward');
  assert.equal(getPageTransitionDirection(url('/listings/item'), url('/'), 'push'), 'back');
  assert.equal(getPageTransitionDirection(url('/account'), url('/favorites'), 'push'), 'forward');
  assert.equal(getPageTransitionDirection(url('/account'), url('/account/listings'), 'push'), 'forward');
});

test('browser history position determines both back and forward independently of page depth', () => {
  assert.equal(getPageTransitionDirection(url('/'), url('/account'), 'traverse', 5, 4), 'back');
  assert.equal(getPageTransitionDirection(url('/account/listings'), url('/account'), 'traverse', 4, 5), 'forward');
});

test('query, hash, same-page and external authentication navigations do not slide the page', () => {
  for (const destination of ['/?chat=1', '/#suggested-listings', '/', '/api/auth/google/start', 'https://accounts.example.test/login']) {
    assert.equal(getPageTransitionDirection(url('/'), url(destination), 'push'), null, destination);
  }
});

function browser(t: TestContext) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const attributes = new Map<string, string>();
  const location = { href: url('/').href };
  const captures: { update: () => Promise<void>; finish: () => void; fail: () => void; skipped: number }[] = [];
  const document = {
    visibilityState: 'visible',
    documentElement: {
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      removeAttribute: (key: string) => attributes.delete(key),
    },
    startViewTransition: (update: () => Promise<void>) => {
      let finish!: () => void;
      let fail!: () => void;
      const finished = new Promise<void>(resolve => { finish = resolve; });
      const ready = new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('capture failed')); });
      const capture = { update, finish, fail, skipped: 0 };
      captures.push(capture);
      return { finished, ready, skipTransition: () => { capture.skipped++; } };
    },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location, navigation: { currentEntry: { index: 1 } } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  const changes: (PendingPageTransition | null)[] = [];
  const unsubscribe = subscribePageTransitions(pending => { changes.push(pending); });
  t.after(() => {
    unsubscribe();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  return { attributes, location, captures, changes, document };
}

test('capture finishes before the DOM commit gate and the animation waits for the actual route', async t => {
  const state = browser(t);
  beginPageTransition('/account', 'push');
  const pending = state.changes.at(-1)!;
  assert.equal(pending.fromPathname, '/');
  assert.equal(state.attributes.get('data-page-transition'), 'forward');
  let committed = false;
  const update = state.captures[0].update().then(() => { committed = true; });
  await pending.captured;
  assert.equal(committed, false);
  commitPageTransition('/');
  assert.equal(committed, false);
  state.location.href = url('/account').href;
  commitPageTransition('/account');
  await update;
  assert.equal(committed, true);
  state.captures[0].finish();
  await Promise.resolve();
  assert.equal(state.attributes.has('data-page-transition'), false);
});

test('a superseded animation releases its gates and cannot clear a newer animation', async t => {
  const state = browser(t);
  beginPageTransition('/account', 'push');
  const first = state.changes.at(-1)!;
  beginPageTransition('/favorites', 'push');
  await first.captured;
  assert.equal(state.captures[0].skipped, 1);
  state.captures[0].finish();
  await Promise.resolve();
  assert.equal(state.attributes.get('data-page-transition'), 'forward');
  cancelPageTransition();
  assert.equal(state.captures[1].skipped, 1);
});

test('capture rejection and a thrown browser API both release navigation without an unhandled rejection', async t => {
  const state = browser(t);
  beginPageTransition('/account', 'push');
  const pending = state.changes.at(-1)!;
  state.captures[0].fail();
  await pending.captured;
  assert.equal(state.attributes.has('data-page-transition'), false);
  state.document.startViewTransition = () => { throw new Error('unavailable'); };
  assert.doesNotThrow(() => beginPageTransition('/favorites', 'push'));
  assert.equal(state.changes.at(-1), null);
});

test('stalled navigations time out without keeping the old page or its commit gate frozen', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = browser(t);
  beginPageTransition('/account', 'push');
  const pending = state.changes.at(-1)!;
  t.mock.timers.tick(2000);
  await pending.captured;
  assert.equal(state.attributes.has('data-page-transition'), false);
  assert.equal(state.captures[0].skipped, 1);
});

test('unsupported or hidden documents retain ordinary navigation without an animation', t => {
  const state = browser(t);
  state.document.visibilityState = 'hidden';
  beginPageTransition('/account', 'push');
  assert.equal(state.captures.length, 0);
  state.document.visibilityState = 'visible';
  Reflect.deleteProperty(state.document, 'startViewTransition');
  beginPageTransition('/account', 'push');
  assert.equal(state.captures.length, 0);
});
