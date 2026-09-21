import { generateText } from 'ai';
import { z } from 'zod';

import { getDeepseekChatModel } from '@/agent/deepseek-provider';
import { findAmbiguousForbiddenRoots } from './forbidden-terms';

/**
 * Optional semantic layer for the forbidden terms checker.
 *
 * This is ONLY called from the chat route, and ONLY when the deterministic
 * checker hit an ambiguous root whose surrounding context was not decisive
 * (e.g. a bare "حشيش" with no "غنم"/"مخدر" nearby). Every other caller keeps
 * using the synchronous, deterministic `evaluateForbiddenMarketplaceTerms`.
 *
 * The layer is fail-closed: when the model cannot be reached or returns an
 * unusable answer, we keep the deterministic default (block).
 */

const modelTimeoutMs = 8_000;

const semanticDecisionSchema = z.object({
  decision: z.enum(['prohibited', 'allowed']),
  confidence: z.number().min(0).max(1),
  reason_code: z.string().min(1).max(80),
});

export type AmbiguousResolution = {
  /** The roots that were sent to the semantic layer. */
  roots: string[];
  /** True when the model classified the text as a prohibited product. */
  prohibited: boolean;
  reasonCode: string;
};

/**
 * Returns the ambiguous roots in the text that need semantic resolution.
 * Empty array means there is nothing for the model to decide.
 */
export function getAmbiguousRootsNeedingModel(text: string) {
  return findAmbiguousForbiddenRoots(text);
}

async function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function extractJsonObject(text: string) {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Forbidden-terms model did not return JSON.');
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function parseSemanticDecision(text: string) {
  return semanticDecisionSchema.parse(
    JSON.parse(extractJsonObject(text)) as unknown,
  );
}

/**
 * Resolves ambiguous forbidden roots with the moderation model.
 *
 * Fail-closed: on any error (timeout, network, parse) we return
 * `prohibited: true` so the deterministic default (block) is preserved.
 */
export async function resolveAmbiguousForbiddenRoots(
  text: string,
  roots: string[] = getAmbiguousRootsNeedingModel(text),
): Promise<AmbiguousResolution> {
  if (roots.length === 0) {
    return { roots: [], prohibited: false, reasonCode: 'no_ambiguous_roots' };
  }

  try {
    const result = await withTimeout(modelTimeoutMs, (signal) =>
      generateText({
        model: getDeepseekChatModel('moderation'),
        maxOutputTokens: 200,
        abortSignal: signal,
        instructions: `You are the سوق حمد forbidden-terms resolver for the Saudi marketplace.
Return JSON only. Do not answer the user.
A marketplace listing text contains a word that is spelled the same for a prohibited product and an allowed one (for example "حشيش" can mean the drug marijuana or animal fodder).
Decide whether, in THIS text, the word refers to a prohibited product or an allowed one.
Answer "prohibited" when it is a real prohibited product (drugs, alcohol, weapons, etc.).
Answer "allowed" when it is clearly an allowed item (animal fodder, a color, food, a common object, etc.).
Use the full sentence meaning and context. If unsure, answer "prohibited".`,
        prompt: JSON.stringify({
          required_schema: {
            decision: 'prohibited | allowed',
            confidence: 'number from 0 to 1',
            reason_code: 'short machine code',
          },
          ambiguous_roots: roots,
          text: text.slice(0, 1_500),
        }),
      }),
    );

    const decision = parseSemanticDecision(result.text);

    return {
      roots,
      prohibited: decision.decision === 'prohibited',
      reasonCode: decision.reason_code,
    };
  } catch {
    // Fail-closed: keep the deterministic default (block).
    return { roots, prohibited: true, reasonCode: 'semantic_resolver_failure' };
  }
}
