import assert from 'node:assert/strict';
import test from 'node:test';

import { getAppBaseUrl } from '@/lib/app-url';

test('production app base url ignores untrusted request origins', () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousPublicAppUrl = env.NEXT_PUBLIC_APP_URL;

  env.NODE_ENV = 'production';
  delete env.NEXT_PUBLIC_APP_URL;

  try {
    assert.equal(
      getAppBaseUrl(new Request('https://attacker.example/api/auth/google/start')),
      'https://souqhamad.com',
    );
    assert.equal(
      getAppBaseUrl(
        new Request('https://souqhamad.com/api/auth/google/start'),
      ),
      'https://souqhamad.com',
    );
  } finally {
    env.NODE_ENV = previousNodeEnv;

    if (previousPublicAppUrl === undefined) {
      delete env.NEXT_PUBLIC_APP_URL;
    } else {
      env.NEXT_PUBLIC_APP_URL = previousPublicAppUrl;
    }
  }
});

test('configured production app base url still takes precedence', () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousPublicAppUrl = env.NEXT_PUBLIC_APP_URL;

  env.NODE_ENV = 'production';
  env.NEXT_PUBLIC_APP_URL = 'https://www.souqhamad.com/';

  try {
    assert.equal(
      getAppBaseUrl(new Request('https://attacker.example/api/auth/google/start')),
      'https://souqhamad.com',
    );
  } finally {
    env.NODE_ENV = previousNodeEnv;

    if (previousPublicAppUrl === undefined) {
      delete env.NEXT_PUBLIC_APP_URL;
    } else {
      env.NEXT_PUBLIC_APP_URL = previousPublicAppUrl;
    }
  }
});
