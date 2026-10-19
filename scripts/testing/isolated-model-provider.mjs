import { createPlatformHelpCompletion } from './platform-help-model-fixture.mjs';

const originalFetch = globalThis.fetch;

// Test-only transport; individual tests may still install their own provider mocks.
globalThis.fetch = async function isolatedModelFetch(input, init) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === 'api.deepseek.com') {
    if (process.env.CI === '1' && process.env.DEEPSEEK_API_KEY === 'test-model-placeholder' &&
        process.env.SMARTSTORE_TEST_MODEL_FIXTURE === 'platform-help') {
      const body = input instanceof Request ? await input.text() : String(init?.body ?? '');
      return createPlatformHelpCompletion(body);
    }
    return new Response(JSON.stringify({ error: {
      code: 'test_model_provider_disabled',
      message: 'Live model requests are disabled in test fixtures.',
    } }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
};
