import { Prisma } from '@prisma/client';
import { getMarketplaceCategoryOptions, marketplaceCategoryOptionAttribute } from '@/lib/marketplace/category-options';
import { normalizeMarketplaceSearchText } from './search';

/** Exclude only canonical saved branches the exact scorer always rejects.
 * Missing, sentinel, legacy and differently normalized values still reach the scorer.
 * This is a conservative prefilter, never a candidate limit or replacement score.
 */
export function similarListingCandidateFilterSql(target: { category: string; attributes: Record<string, unknown> }) {
  const rawBranch = target.attributes[marketplaceCategoryOptionAttribute];
  const branch = typeof rawBranch === 'string' || typeof rawBranch === 'number'
    ? normalizeMarketplaceSearchText(String(rawBranch)) : '';
  if (!branch || ['other', 'custom', 'unknown'].includes(branch)) return Prisma.sql`TRUE`;
  const conflicts = getMarketplaceCategoryOptions(target.category).map(option => option.id).filter(id => {
    const normalized = normalizeMarketplaceSearchText(id);
    return normalized && !['other', 'custom', 'unknown', branch].includes(normalized);
  });
  return conflicts.length
    ? Prisma.sql`coalesce("attributes" -> ${marketplaceCategoryOptionAttribute}, 'null'::jsonb)
        NOT IN (${Prisma.join(conflicts.map(id => Prisma.sql`${JSON.stringify(id)}::jsonb`))})`
    : Prisma.sql`TRUE`;
}
