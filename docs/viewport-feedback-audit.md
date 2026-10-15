# Viewport feedback audit

## Scope and findings

This audit follows existing action handlers through their existing presentation
components. It does not add action messages, change outcomes, or move inline field
validation into a modal. Routes, API contracts, persistence, permissions, and action
ordering are outside the change.

| Existing presentation | Cause before correction | Minimal correction |
| --- | --- | --- |
| Listing contact options | Fixed overlay inside `contain: layout paint` scrolling content; its containing block was not the viewport | Portal the same markup to body, retain callbacks and outside dismissal; remove only this sheet's dim/blur backdrop |
| Commission agreement | Fixed overlay can inherit a contained ancestor; long content can exceed short screens | Body portal with a hydration gate and scrollable viewport bounds; preserve acknowledgement and confirmation |
| Chat attachment and manual listing previews | Fixed overlays nested in transformed assistant/toolbar trees | Body portals for existing previews; prevent portal pointer events from initiating toolbar drag |
| Conversation message actions | Inline fixed sheet can be constrained by its ancestors | Body portal, bounded sheet, same deletion/cancellation callbacks |
| Shared Radix confirmation/image dialogs | Already portaled, but layout-viewport centering could exceed the visible keyboard viewport | Shared ref-driven visual-viewport coordinates and maximum height; retain Radix focus, Escape and dismissal behavior |
| Existing action notices | Already portaled with their own viewport listener | Factor the same listener into `useOverlayViewport`; retain text, tone, duration, status semantics and dismissal |
| City selector options | Absolute popup clipped by toolbar/form overflow; could extend beyond a viewport edge | Portal existing popup; constrain width/height and flip at edges, retain search/selection/outside/Escape |
| Radix select/dropdown | Existing portal and collision handling already appropriate | Keep placement logic; use layer 90 so options remain above shared layer-80 dialogs |

`app/account/listings/page.tsx` retains the image manager's existing 86dvh/42rem
height cap through a CSS variable, alongside the shared visible-height limit.
`app/globals.css` contains only positioning, safe-area, and overflow constraints.

The shared hook attaches only while an overlay is mounted, writes CSS variables
without React state, and cleans up viewport listeners. It does not poll or listen
to document scroll. The anchored city selector alone tracks ancestor scrolling
while open, since its trigger moves; scrolling inside its own options is ignored.

## Presentations intentionally retained

- Listing fullscreen gallery already uses a body portal.
- Radix menus keep their existing collision handling and keyboard behavior.
- Field validation, form-local errors, button pending labels, page data-load
  warnings, and conversation state banners retain their original contexts.
- Header auth options remain anchored to the non-transformed header.
- Native selects/share sheets and system authentication prompts remain native.
- No global containment, scrolling, header, bottom navigation, or theme redesign.
- No additional loading/success message where the action did not already have one.

Shared notice/confirmation consumers reviewed include home manual publishing,
account/profile and account listings, seller actions and identity, listing contact,
safety and similar-follow actions, conversations and individual messages,
notifications and push settings, commissions and account deletion, plus admin
users/listings/moderation/commissions/maintenance. Shared prompt-input menus and
command dialogs continue using the existing Radix primitives. This inventory is
a code review, not a claim that every business outcome was executed in a browser.

## Verification

New `e2e/viewport-feedback.spec.ts` exercises contact options at scroll fractions
0, 0.5 and 1 within synthetic 10,000px content, both themes, narrow portrait,
landscape, tablet and desktop sizes. It checks body placement, visible bounds,
transparent backdrop, unchanged scroll offset, single overlay, and no requests
on opening/closing. The existing conversation-error feedback is also checked.

The shared confirmation test covers short landscape screens, Escape and resizing
an explicitly simulated visual viewport. City options cover visible bounds,
search, selection and Escape. Existing report, marketplace toolbar, registration,
customer journey and performance suites provide regression coverage.

The manual-form test opens the existing image preview using a local asset, checks
that the image is decoded, closes it without losing the attachment, then opens
the publication agreement and checks portrait/landscape bounds and its disabled
confirmation before acknowledgement. It never submits the synthetic product.
Additional cases open the assistant's attachment preview in portrait and
landscape without sending it, and open/cancel message options on a mocked
conversation without deleting its message or issuing an action mutation.

## Command results

- `pnpm test`: 551 cases, 548 passed, 3 database-integration cases skipped.
- `pnpm lint`: passed; targeted ESLint also passed after the final test additions.
- `pnpm exec tsc --noEmit`: passed after the final test additions.
- Production build: passed through Playwright's managed build/start command.
- Final `pnpm test:e2e`: 40 passed, 2 intentional project-specific skips,
  no failures or retries, approximately 6 minutes including production build.
  The desktop project skips the mobile-only keyboard case; the mobile project
  skips the performance audit because that audit sets all eight sizes itself.
- Final local performance audit: maximum LCP 840ms, maximum CLS approximately
  0.00998 across the audited pages/sizes; theme-toggle CLS delta 0 and observed
  INP 120ms. These are local fixture measurements, not field/production metrics.
- Final repeat `pnpm test`: 548 passed, 3 database-integration skips, no failures.
- `git diff --check`: passed (Windows LF/CRLF conversion warnings only).
- An earlier run found an incorrect test locator for the agreement's disabled
  button (its label changes after acknowledgement); the test was corrected to
  check the existing pre-acknowledgement label, without changing application code.

Browser emulation and a
synthetic keyboard viewport are not tests on physical iOS/iPadOS/Android devices,
native keyboards, or the installed WebView wrapper. Native share/auth UI and
production network/provider behavior require separate device/staging validation.
Real database integration requires an explicitly configured test database.
