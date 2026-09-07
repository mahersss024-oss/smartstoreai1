import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  fetchDeepseekWithRetry,
  getDeepseekApiKey,
  getDeepseekModelName,
  isTransientDeepseekResponse,
  normalizeDeepseekChatBody,
} from '@/agent/deepseek-provider';
import { appConfig } from '@/app/app-config';

const modelEnvKeys = [
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODEL',
  'DEEPSEEK_CHAT_MODEL',
  'DEEPSEEK_SCOPE_MODEL',
  'DEEPSEEK_MODERATION_MODEL',
  'DEEPSEEK_VISION_MODEL',
] as const;

function withModelEnvironment(
  values: Partial<Record<(typeof modelEnvKeys)[number], string>>,
  run: () => void,
) {
  const previousValues = Object.fromEntries(
    modelEnvKeys.map((key) => [key, process.env[key]]),
  );

  for (const key of modelEnvKeys) {
    delete process.env[key];
  }

  Object.assign(process.env, values);

  try {
    run();
  } finally {
    for (const key of modelEnvKeys) {
      const previousValue = previousValues[key];

      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
}

test('uses configured default DeepSeek models for every profile', () => {
  withModelEnvironment({}, () => {
    assert.equal(getDeepseekModelName('chat'), appConfig.models.chat);
    assert.equal(getDeepseekModelName('scope'), appConfig.models.scope);
    assert.equal(
      getDeepseekModelName('moderation'),
      appConfig.models.moderation,
    );
    assert.equal(getDeepseekModelName('vision'), appConfig.models.vision);
  });
});

test('allows one global DeepSeek model override', () => {
  withModelEnvironment({ DEEPSEEK_MODEL: 'deepseek-v4-pro' }, () => {
    assert.equal(getDeepseekModelName('chat'), 'deepseek-v4-pro');
    assert.equal(getDeepseekModelName('scope'), 'deepseek-v4-pro');
    assert.equal(getDeepseekModelName('moderation'), 'deepseek-v4-pro');
    assert.equal(getDeepseekModelName('vision'), 'deepseek-v4-pro');
  });
});

test('uses profile-specific DeepSeek model overrides first', () => {
  withModelEnvironment(
    {
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_SCOPE_MODEL: 'deepseek-v4-pro',
      DEEPSEEK_VISION_MODEL: 'deepseek-v4-flash-vision-exp',
    },
    () => {
      assert.equal(getDeepseekModelName('chat'), 'deepseek-v4-flash');
      assert.equal(getDeepseekModelName('scope'), 'deepseek-v4-pro');
      assert.equal(getDeepseekModelName('moderation'), 'deepseek-v4-flash');
      assert.equal(
        getDeepseekModelName('vision'),
        'deepseek-v4-flash-vision-exp',
      );
    },
  );
});

test('prefers local DeepSeek key over stale machine environment key', () => {
  const previousCwd = process.cwd();
  const tempDirectory = mkdtempSync(join(tmpdir(), 'smartstore-env-'));
  const previousKey = process.env.DEEPSEEK_API_KEY;

  try {
    process.chdir(tempDirectory);
    process.env.DEEPSEEK_API_KEY = 'sk-stale-machine-key';
    writeFileSync('.env.local', 'DEEPSEEK_API_KEY=sk-local-file-key\n');

    assert.equal(getDeepseekApiKey(), 'sk-local-file-key');
  } finally {
    process.chdir(previousCwd);

    if (previousKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = previousKey;
    }

    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('normalizes DeepSeek requests for non-thinking marketplace responses', () => {
  const normalized = JSON.parse(
    normalizeDeepseekChatBody(
      JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'developer', content: 'hidden rule' },
          { role: 'user', content: 'مرحبا' },
        ],
      }),
    ),
  ) as {
    thinking: { type: string };
    messages: Array<{ role: string; content: string }>;
  };

  assert.deepEqual(normalized.thinking, { type: 'disabled' });
  assert.equal(normalized.messages[0]?.role, 'system');
  assert.equal(normalized.messages[1]?.role, 'user');
});

test('recognizes transient DeepSeek response statuses', () => {
  assert.equal(isTransientDeepseekResponse(429), true);
  assert.equal(isTransientDeepseekResponse(502), true);
  assert.equal(isTransientDeepseekResponse(401), false);
  assert.equal(isTransientDeepseekResponse(400), false);
});

test('retries transient DeepSeek fetch responses', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  try {
    globalThis.fetch = (async () => {
      calls += 1;

      return new Response(calls === 1 ? 'temporary' : 'ok', {
        status: calls === 1 ? 502 : 200,
      });
    }) as typeof fetch;

    const response = await fetchDeepseekWithRetry('https://api.deepseek.test', {
      method: 'POST',
    });

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
