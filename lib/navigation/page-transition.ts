export type PageNavigationType = 'push' | 'replace' | 'traverse';
export type PageTransitionDirection = 'forward' | 'back';

export function getPageTransitionDirection(
  from: URL,
  to: URL,
  type: PageNavigationType,
  fromIndex?: number,
  toIndex?: number,
): PageTransitionDirection | null {
  if (from.origin !== to.origin || from.pathname === to.pathname
    || to.pathname === '/api' || to.pathname.startsWith('/api/')) return null;
  if (type === 'traverse' && fromIndex !== undefined && toIndex !== undefined && fromIndex !== toIndex) {
    return toIndex < fromIndex ? 'back' : 'forward';
  }
  const depth = (url: URL) => url.pathname.split('/').filter(Boolean).length;
  if (depth(to) < depth(from)) return 'back';
  return type === 'traverse' && depth(to) === depth(from) ? 'back' : 'forward';
}

export type PendingPageTransition = {
  fromPathname: string;
  captured: Promise<void>;
};

type ActiveTransition = PendingPageTransition & {
  releaseCapture: () => void;
  releaseCommit: () => void;
  native?: ViewTransition;
  timeout?: ReturnType<typeof setTimeout>;
};

type CommittedLocation = { url: URL; index?: number };
const listeners = new Set<(pending: PendingPageTransition | null) => void>();
let committed: CommittedLocation | null = null;
let active: ActiveTransition | null = null;

function historyIndex() {
  return (window as Window & { navigation?: { currentEntry?: { index: number } } })
    .navigation?.currentEntry?.index;
}

function publish(pending: PendingPageTransition | null) {
  for (const listener of listeners) listener(pending);
}

function finish(transition: ActiveTransition, skip: boolean) {
  transition.releaseCapture();
  transition.releaseCommit();
  clearTimeout(transition.timeout);
  if (skip) transition.native?.skipTransition();
  if (active !== transition) return;
  active = null;
  document.documentElement.removeAttribute('data-page-transition');
  publish(null);
}

export function cancelPageTransition() {
  if (active) finish(active, true);
}

export function subscribePageTransitions(listener: (pending: PendingPageTransition | null) => void) {
  listeners.add(listener);
  committed ??= { url: new URL(window.location.href), index: historyIndex() };
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      cancelPageTransition();
      committed = null;
    }
  };
}

export function beginPageTransition(href: string, type: PageNavigationType) {
  cancelPageTransition();
  if (!committed || !listeners.size || typeof document.startViewTransition !== 'function'
    || document.visibilityState === 'hidden') return;
  const destination = new URL(href, window.location.href);
  const direction = getPageTransitionDirection(committed.url, destination, type, committed.index, historyIndex());
  if (!direction) return;

  let releaseCapture!: () => void;
  let releaseCommit!: () => void;
  const captured = new Promise<void>(resolve => { releaseCapture = resolve; });
  const committedView = new Promise<void>(resolve => { releaseCommit = resolve; });
  const transition: ActiveTransition = { fromPathname: committed.url.pathname, captured, releaseCapture, releaseCommit };
  active = transition;
  document.documentElement.setAttribute('data-page-transition', direction);
  publish(transition);

  try {
    transition.native = document.startViewTransition(() => {
      releaseCapture();
      return committedView;
    });
    // A failed or stalled navigation must never leave the interface frozen.
    transition.timeout = setTimeout(() => finish(transition, true), 2000);
    void transition.native.ready.catch(() => finish(transition, true));
    void transition.native.finished.then(() => finish(transition, false), () => finish(transition, true));
  } catch {
    finish(transition, true);
  }
}

export function commitPageTransition(pathname: string) {
  const url = new URL(window.location.href);
  if (url.pathname !== pathname) return;
  committed = { url, index: historyIndex() };
  if (active && pathname !== active.fromPathname) {
    clearTimeout(active.timeout);
    active.releaseCommit();
  }
}
