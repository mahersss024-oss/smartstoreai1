import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDeepseekModelName,
  normalizeDeepseekChatBody,
} from '@/agent/deepseek-provider';
import { appConfig } from '@/app/app-config';

const modelEnvKeys = [
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
