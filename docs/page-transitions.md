# Page Navigation Motion

Route motion is a fixed part of the interface, not a user or administrator setting.
It has no feature flag, stored preference or reduced-motion override.

- Opening a page slides its content in from the left and the previous content out to the right.
- Returning to a shallower page reverses the direction. Browser back/forward use the history entry index when available.
- The duration is 280 ms. The existing mobile bottom navigation and app banner remain outside the moving content.
- Query/hash-only changes, same-page actions, API endpoints and external authentication redirects are not page slides.

## Implementation

`instrumentation-client.ts` starts the capture through Next's public
`onRouterTransitionStart` hook. `lib/navigation/page-transition.ts` coordinates
the browser's native View Transition API with `components/page-transition.tsx`.
The previous DOM is captured before the next pathname commits; the animation
starts after that commit. There is no artificial navigation delay.

The root wrapper is unkeyed. It does not clone pages, replace Next's router,
rewrite history state, change route URLs or create a second live page tree.
The bottom navigation has a separate stationary snapshot above the moving pages.
Account changes cancel any active snapshot.

Browsers without native capture, hidden documents, capture errors and a capture
waiting more than two seconds fall back to ordinary navigation. These safeguards
release both pending gates and do not cancel the underlying navigation.

The home route separately retains its public browsing state in tab-local runtime
memory: search input, filters, loaded results, pagination and list viewport. A
return visit revalidates the loaded result window with the same API filters,
without clearing the search or replacing the whole view with loading skeletons.
This memory is independent of native capture and existing assistant history.
It does not survive a full page reload or share state with other tabs.
No business actions, authorization rules, model calls, dependencies or database
tables are added or modified.

## Focused Verification

```sh
pnpm test tests/home-browse-state.test.ts tests/page-transition.test.ts tests/home-assistant-session.test.ts tests/chat-session-context.test.ts tests/chat-listing-display.test.ts tests/app-bridge.test.ts tests/mobile-interface-reorganization.test.ts
pnpm exec playwright test e2e/home-browse-memory.spec.ts e2e/page-transitions.spec.ts e2e/customer-journey.spec.ts e2e/chat-session-context.spec.ts --reporter=list
```

The browser tests run on desktop and mobile Chromium with isolated fixtures and
mocked model transport. They inspect actual native animation names, duration,
horizontal transforms and screenshots, rather than just checking a CSS class.
They cover forward/back traversal, stationary bottom navigation, query-only
history updates, navigation during an active animation, reduced-motion settings,
missing/throwing capture APIs, native Android insets/clipping, and the existing
customer and assistant journeys.
They do not measure production Core Web Vitals or certify other browser engines.

## Home Browse Memory

`lib/marketplace/home-browse-state.ts` retains one public browsing snapshot per
tab runtime. The home route records it before its DOM is removed, including
the scroll offset and floating toolbar state. It never stores chat messages,
files, geolocation coordinates, credentials or unpublished form data.

The latest input is retained even when navigation precedes the search debounce.
Cached cards are shown only if their completed request key matches that input
and all selected filters. On return, the existing listings API revalidates the
previously loaded pages sequentially with those same filters. Results commit
together; failures retain the known results and leaving the route aborts the
requests. A database change can legitimately reduce the result window and clamp
its scroll position. Explicit search/filter clearing remains authoritative.
