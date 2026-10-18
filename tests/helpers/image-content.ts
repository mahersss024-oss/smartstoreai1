import type { TestContext } from 'node:test';
import { resetImageContentReviewCacheForTests } from '@/agent/marketplace/listing-image-content';

type ReviewDecision = 'allow' | 'block' | 'needs_review' | 'unavailable';

export function mockImageContentReview(t: TestContext, decisions: ReviewDecision | ReviewDecision[] = 'allow') {
  resetImageContentReviewCacheForTests();
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-image-review-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    const decision = Array.isArray(decisions) ? decisions[Math.min(calls, decisions.length - 1)] : decisions;
    calls += 1;
    if (decision === 'unavailable') {
      return Response.json({ error: { message: 'Image inspection unavailable' } }, { status: 401 });
    }
    return Response.json({
      id: 'image-review-test', object: 'chat.completion', created: 1, model: 'test-vision',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
        decision, confidence: 0.99, reasons: [decision === 'block' ? 'prohibited_content' : 'image_quality_or_category'],
        prohibited_category: decision === 'block' ? 'alcohol' : undefined,
        detected_product: 'test product', category_match: 'unclear', sharia_sensitive: decision === 'block',
      }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
  return () => calls;
}
