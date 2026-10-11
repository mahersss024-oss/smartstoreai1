'use client';

import { useState } from 'react';

import {
  detectAppPlatform,
  isInsideNativeApp,
} from '@/lib/native/app-bridge';

type AuthProviderVisibility = {
  google: boolean;
  apple: boolean;
};

function detectAuthProviderVisibility(): AuthProviderVisibility {
  if (!isInsideNativeApp()) {
    return { google: true, apple: true };
  }

  const platform = detectAppPlatform();

  if (platform === 'android') {
    return { google: true, apple: false };
  }

  if (platform === 'ios') {
    return { google: false, apple: true };
  }

  return { google: true, apple: true };
}

export function useAuthProviderVisibility(): AuthProviderVisibility {
  const [visibility] = useState<AuthProviderVisibility>(() =>
    detectAuthProviderVisibility(),
  );

  return visibility;
}
