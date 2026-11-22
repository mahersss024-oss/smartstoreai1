import { createHash } from 'node:crypto';
import { getPlatformHelp, platformHelpTopics } from '@/agent/platform-guide';

export function readHamadKnowledge(topic: (typeof platformHelpTopics)[number]) {
  const knowledge = getPlatformHelp(topic);
  const { source, relatedPolicies, catalog, catalogRules, configuredLimits } = knowledge;
  const content = { source, relatedPolicies, catalog: catalogRules ? catalog?.map(({ id, label }) => ({ id, label })) : undefined,
    catalogRules, configuredLimits };
  return {
    source_id: 'platform:' + topic,
    version: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
    updated_at: 'updatedAt' in source && typeof source.updatedAt === 'string' ? source.updatedAt : null,
    access_level: 'public' as const,
    content,
  };
}
