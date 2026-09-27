'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes, ReactNode } from 'react';

type ResilientImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  fallback?: ReactNode;
  maxRetries?: number;
  src: string;
};

function withRetryToken(src: string, attempt: number) {
  if (attempt === 0 || src.startsWith('data:') || src.startsWith('blob:')) {
    return src;
  }

  try {
    const url = new URL(src, window.location.href);
    url.searchParams.set('imageRetry', String(attempt));
    return url.toString();
  } catch {
    return src;
  }
}

export function ResilientImage({
  alt = '',
  fallback = null,
  maxRetries = 2,
  onError,
  src,
  ...props
}: ResilientImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  if (failed) {
    return fallback;
  }

  return (
    <img
      {...props}
      alt={alt}
      src={withRetryToken(src, attempt)}
      onError={(event) => {
        onError?.(event);

        if (attempt >= maxRetries) {
          setFailed(true);
          return;
        }

        retryTimerRef.current = setTimeout(
          () => setAttempt((currentAttempt) => currentAttempt + 1),
          500 * (attempt + 1),
        );
      }}
    />
  );
}
