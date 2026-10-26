# Test Coverage and Remaining Work

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm test:inventory` | Discover source functions, pages, HTTP methods and JSX controls with the TypeScript parser. |
| `pnpm test:coverage` | Run the Node suite with native runtime coverage and produce an explicit gap report. |
| `pnpm test:routes` | Render discovered administrator pages as guest and customer on desktop/mobile Chromium. |
| `pnpm test:e2e` | Run public gateway/policy and administrator browser checks and the independent request-only API project. |
| `pnpm test:e2e --project=api-contracts` | Check HTTP methods, unauthenticated/staff access boundaries and authenticated listing draft contracts without a browser. |
| `pnpm test:db:integration` | Run database integration tests against an explicitly isolated test database. |
| `pnpm verify` | Type check, lint, Node tests, production build and dependency audit. |

Do not point write tests at a production database. The route browser suite refuses
non-loopback URLs. Its normal Playwright configuration prepares an isolated file
store. A loopback server supplied through `PLAYWRIGHT_BASE_URL` must also use an
isolated test store. OAuth/AI/storage/push delivery tests need separate sandbox
credentials; a mock response does not verify a live integration.

## Reports

- `coverage/inventory.json`: source location of every discovered item. Includes
  anonymous callbacks, reusable controls, scripts and the service worker.
- `coverage/unit-summary.json`: native Node runtime coverage for executed modules.
- `coverage/gaps.json`: files never loaded by Node tests, controls awaiting explicit
  behavior mapping, endpoint access policies and outstanding external checks.
- Playwright attachments named `discovered-controls-not-click-coverage`: rendered
  controls per page and role, not proof that their actions were exercised.

Native percentages exclude never-loaded modules and browser execution. Generated
transpiler helpers can affect native function/branch counts. These percentages
must not be described as total project or business-function coverage. Inventory
counts are source definitions, not distinct business features or runtime instances.
CSS, database migrations, infrastructure and CI configuration are not executable
TypeScript functions and require their own integration, visual and deployment checks.

## Baselines Versus Complete Behavior

The request-only API contracts verify OPTIONS/Allow, rejection of an unsupported
method, unauthenticated rejection, ordinary-user denial on staff endpoints, and
authenticated draft creation without publication. Node route-access tests also
verify forged and expired sessions. Administrator page checks exercise
rendering/access as guests and customers for `/admin` and `/admin/*` only. Public
listing/seller, account and other customer web journeys are outside the
current browser CI scope. The administrator baselines do not certify successful
administrator workflows or every state of each dynamic route.
Expected final URLs are asserted. Guest administration redirects are verified with
an intercepted OAuth-start boundary, so live identity-provider pages are never
needed for these baseline tests. A redirected page is not counted as successful
rendering of the protected content.

The route lifecycle test checks actual handlers for invalid creation, draft creation,
ownership, invalid edits, publication, favorites, self-contact prevention, private
conversation access, pause, republication, sale and deletion. Existing specifications
exercise further UI journeys. Source-text assertions remain structural tests, not
substitutes for executing a handler or clicking a control.

Customer browser scenarios were previously part of the CI matrix. The remaining
`e2e/account-actions.spec.ts` describes the retired public web deletion action with
intercepted requests and is not selected by the browser allowlist. Current public
policy coverage is `e2e/legal-pages.spec.ts`: five documents, navigation, responsive
light/dark reading, app handoff, and the independent support-email deletion request.
These public pages do not perform account deletion. The
historical public-page runs do not establish current native-app account behavior
or database deletion. Native UI verification belongs to the mobile repository;
shared account handlers continue to have Node/API authorization checks.

Complete functional coverage is still unfinished. For each inventoried control and
business operation, add a named scenario asserting its observable outcome, not just
its presence. Cover success, invalid input, permission denial, cancellation, repeat
submission, missing records, concurrency and dependency failure where applicable.
Exercise guest, buyer, seller, moderator, administrator and owner separately.
Test confirmation dialogs with both cancel and confirm using disposable fixtures.

All inventory additions are discovered on subsequent runs; discovery does not
enroll customer pages into the explicit browser allowlist. Unclassified endpoints
and stale guest exceptions fail the Node inventory test. No baseline pass upgrades
an item to `completeBehaviorVerified: true` automatically. Even 100% executed code
coverage would not prove that every possible input or interaction is correct.
