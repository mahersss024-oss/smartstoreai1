'use client';

import { useCallback, useEffect, useRef } from 'react';

/** Scope requests to the current permission/filter state and accept only the latest response. */
export function useAdminRequest(allowed: boolean, scope = '') {
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => {
    generation.current++;
    active.current?.abort();
    active.current = null;
  }, []);
  useEffect(() => {
    if (!allowed) invalidate();
    return invalidate;
  }, [allowed, scope, invalidate]);
  const begin = useCallback(() => {
    invalidate();
    const version = generation.current;
    const controller = new AbortController();
    active.current = controller;
    return {
      signal: controller.signal,
      isCurrent: () => version === generation.current && !controller.signal.aborted,
    };
  }, [invalidate]);
  return { begin, invalidate };
}
