-- Preserve the existing literal normalized-title predicate, while exposing an
-- indexable LIKE expression. Keep these character maps in sync with title-search.ts.
CREATE FUNCTION public.marketplace_normalized_title(input text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT regexp_replace(
    translate(lower(normalize(coalesce(input, ''), NFKC)),
      U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06f0\06f1\06f2\06f3\06f4\06f5\06f6\06f7\06f8\06f9\0625\0623\0622\0671\0624\0626\0629\0649\06a9\06cc\200c\200e\200f',
      U&'01234567890123456789\0627\0627\0627\0627\0648\064a\0647\064a\0643\064a   '),
    U&'[\064b-\065f\0670\0640]', '', 'g'
  )
$function$;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Listing_published_title_trgm_idx"
  ON "Listing" USING GIN (public.marketplace_normalized_title("title") gin_trgm_ops)
  WHERE "status" = 'published';

-- Similarity reads every eligible candidate, in stable ID keyset order.
CREATE INDEX "Listing_published_category_id_idx"
  ON "Listing" ("category", "id") WHERE "status" = 'published';
