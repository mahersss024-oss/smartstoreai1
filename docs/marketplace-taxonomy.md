# Marketplace Taxonomy

## Contract

- Existing category IDs and listing URLs remain unchanged.
- `lib/marketplace/categories.ts` defines categories, labels, groups and the model category prompt.
- `lib/marketplace/category-options.ts` defines exactly one optional brand/type level for each category. It is a catalog of explicit choices, not a keyword dictionary.
- Clothing categories contain types, not brand lists. There is no lost-and-found category.
- Property includes `shops_transfer` (محلات للتنازل). Services and the other added sections are ordinary listings, not booking, payment, recruitment or verification workflows.
- Cars alone also offer an optional model-family choice under their brand, sourced from `lib/marketplace/car-models.ts`. Other categories still stop at brand/type. There are no year, trim or specification subdivisions; existing listing fields remain available.
- Manual creation describes condition in the seller's description, without a separate condition selector or an implicit `used` value. Previously stored conditions and other editing workflows are unchanged.

## Storage And Search

The optional choice is stored as the stable ID in `Listing.attributes.marketplaceCategoryOption`. The existing JSON field is used without schema changes or backfills. Missing choices remain missing; legacy titles and free-text brands are not guessed into new filters.

Creation and editing validate that the choice belongs to its category. Unrelated updates preserve it. An explicit null clears it; a category change drops an old incompatible choice. Other attributes remain intact.

An explicit catalog brand also updates the existing `brand` attribute to its Arabic label. Changing or clearing a catalog-controlled brand removes the stale controlled value, while unrelated seller-provided attributes and uncataloged free-text brands remain intact.

Public search combines the category and exact JSON choice with existing title, city and other filters before pagination. It never calls a model. The file store mirrors database filtering. Home browse memory also includes the choice in its result key and navigation snapshot.

Cars store a model-family ID in `Listing.attributes.marketplaceCarModel`, using the same existing JSON field. The model must belong to the selected car brand. Unrelated edits preserve it; changing brand/category clears it, and explicit null clears only that choice. A catalog-controlled `model` text value is maintained in Arabic, without rewriting uncataloged legacy details. Choosing `other` keeps an unlisted vehicle possible. No existing records, URLs or database schema are migrated.

Manual creation, seller/admin editing, public/admin filters, the existing category classifier and Hamad draft tools share this car catalog. Public search still uses only database/file filters, never model interpretation. The classifier can suggest category, brand and model together from title and description; invalid model/brand combinations are discarded, not guessed. The car selection participates in home browse memory and its cache key.

The catalog is a reference selection of familiar current and legacy model families, not a statistical sales/popularity ranking or a guarantee of current local availability. Manufacturer references for less familiar families include [SOUEAST](https://www.soueast-motor.com/soueast/), [ZXAUTO](https://en.zxauto.com.cn/TERRALORD.html), [OMODA and JAECOO](https://www.omodajaecoo.com/global/globalWebsite/) and [Deepal](https://www.deepal-eg.com/en/). Years and trim levels belong in customer text rather than more catalog levels.

Manual creation, seller editing, admin editing/filtering and draft tools use this catalog. The classifier uses title and description together to suggest a valid choice using the existing analysis result; unknown or invalid choices are omitted and customer corrections take precedence. No new model is introduced, and Hamad retains only draft preparation and platform help.

## Verification

`tests/marketplace-category-options.test.ts` checks catalog membership, every brand/type through the local listing lifecycle, exact filtering, SQL parameters, ownership, invalid inputs, explicit clearing, category changes and draft-only chat tools. Browser coverage lives in `e2e/marketplace-categories.spec.ts`.

`tests/marketplace-car-models.test.ts` additionally covers every named car brand/model, clearing dependent choices, exact combined filtering, parameterized SQL, admin audits and draft-only tools. `e2e/marketplace-car-models.spec.ts` exercises manual suggestions/saves, public filtering/navigation, seller editing and admin filtering/editing on desktop and mobile. Provider responses in these checks are isolated fixtures, not a live semantic accuracy evaluation.

Focused verification on 2026-10-19: 88 unit/route/contract checks passed; 18 desktop and 18 mobile Chromium browser cases passed across the category, car-model and manual-description specs. Production build/type checking and scoped ESLint passed. Screenshots of car creation, public filters and admin editing were inspected on desktop/mobile. The catalog contains 88 named brands and 634 named model families, plus an `other` choice for each named brand. No production data or live model calls were used, and unrelated full-project/load suites were not rerun for this change. Changes remain local and unpushed.
