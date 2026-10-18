const originalFetch = globalThis.fetch;

// Test-only transport; individual tests may still install their own provider mocks.
globalThis.fetch = async function isolatedModelFetch(input, init) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === 'api.deepseek.com') {
    return new Response(JSON.stringify({ error: {
      code: 'test_model_provider_disabled',
      message: 'Live model requests are disabled in test fixtures.',
    } }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
};
