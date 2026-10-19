# Hamad: Drafts And Platform Help

Hamad has exactly two customer-facing roles: preparing owned unpublished listing
drafts and answering questions about the platform, its policies and how to use it.
Product search, comparisons, price estimation, offer evaluation, negotiation,
purchase recommendations and marketplace management are not chat capabilities.

## Enforcement

- The chat tool registry exposes only draft creation, draft editing, explicit
  draft photo selection, actual image metadata and `getPlatformHelp`.
- Without `creationMethod=chat`, the agent receives the documentation tool only.
  A creation request offers conversational and manual creation before any draft
  write. Even with the method selected, support-only requests receive no write tools.
- The manual choice opens the existing manual form. Publication and all other
  sensitive actions remain customer-operated UI actions, never chat permissions.
- Incoming historical tool parts are discarded. Old search flags, selected
  product context and old comparison URLs cannot restore removed tools.
- Choosing Hamad after an image-first creation request inspects that immediately
  preceding customer upload. It never re-inspects an unrelated older product as
  the new draft, and raw historical images are stripped from the text-agent input.
- Chat no longer changes market search state or emits search-result cards.
- Output checking receives verified results from all agent steps. Rewriting is
  answer-only, cannot repeat writes, and must not restore removed services.

## Sources And Shared Services

Public policy pages and `getPlatformHelp` import the same structured documents
from `lib/platform/policies.ts`. Published wording is not changed by extraction.
Workflow guidance is maintained in `agent/platform-guide.ts`; undocumented
facts, account status, payment recipients and exceptions must not be invented.
Historical feature descriptions in a policy never grant assistant capabilities.

The old chat-only adaptive router is removed. No model profile, credentials,
database schema, public route or arithmetic engine is removed or replaced.
Shared text understanding, manual category inference, image/content inspection,
administration review, direct database market search and arithmetic engines remain.
Model concerns remain advisory; existing human moderation and deterministic
ownership, permission and upload checks continue to apply.

## Verification Boundary

Tests use isolated marketplace fixtures and intercepted model responses. They
check tools, creation choice, drafts, replay safety, policy sources, scope, account
isolation and desktop/mobile interaction. They do not measure live-model answer
accuracy, provider availability, production storage or production load.

### Initial Role Change Verification: 2026-10-19

- Full source suite: 827 passed, zero failures. The 17 opt-in database integration
  cases were skipped, not represented as successful database verification.
- Focused Chromium journeys: 58 passed across desktop and mobile. Two mobile-only
  cases were skipped in the desktop project. Coverage includes creation choices,
  legacy-tool rejection, account and conversation isolation, long chat history,
  market filtering/pagination, instant browse restoration and the mobile keyboard.
- After the final short creation-choice message, the creation and keyboard
  journeys were repeated: five passed, with the desktop keyboard case not applicable.
- The real chat route was tested with intercepted providers for policy-source
  retrieval, answer rewriting, saved-draft recovery, idempotent replay, attempted
  removed-tool calls, photo-first creation and unrelated-photo isolation. Support
  questions, including those with a photo, expose no draft write tools.
- Full ESLint, scoped final lint, production compilation/type checking and
  whitespace checks passed. Desktop/mobile screenshots were inspected.
- Initial browser startup exceeded its build timeout; a clean rebuild and rerun
  passed. A reporter argument required PowerShell quoting; no application change
  or weakened assertion was used to bypass either runner issue.

## Retired Code Cleanup

The unused stateful chat search/retrieval pipeline, its model-only interpretation
wrapper, search-owner keys and redundant scope-follow-up branch have been removed.
Retired search-result adapters, their CSS animations and the unproduced
`ai_results_updated` event are also removed. An unreferenced Arabic word matcher
and unused memory JSON cache were removed after checking their importers.

Obsolete tests of the deleted features were removed, while active chat security,
ownership, draft/reset, literal public search and UI contracts remain covered.
Search-state input types used by preserved calculations now live with the existing
structured intent contract; no arithmetic was changed. Pricing, comparison,
negotiation, ranking and recommendation calculations remain intentionally, as
requested. They do not restore chat tools. The existing database schema, including
historical search-state rows, was not changed or cleared.

`tests/retired-chat-cleanup.test.ts` guards against reintroducing the removed files,
styles, notifications and capabilities. Cleanup verification is focused; the
initial full-suite figures above are historical, not a claim that the full suite
was rerun for this cleanup.

Cleanup checks on 2026-10-19: 100 focused source/route/calculation checks and 12
desktop/mobile Chromium journeys passed, along with production compilation/type
checking, scoped ESLint and whitespace checks. Static import traversal from app
and script entry points found no disconnected `agent`/`lib` modules after adding
the explicitly preserved calculation modules as audit roots. This is module
reachability evidence, not a claim that every exported symbol in the project is
used or that live-model accuracy was evaluated. No full-suite, production load,
database migration or production data operation was run for this cleanup.
