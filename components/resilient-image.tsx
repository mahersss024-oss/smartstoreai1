'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes, ReactNode } from 'react';

type ResilientImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  fallbackSrcs?: string[];
  fallback?: ReactNode;
  maxRetries?: number;
  src: string;
};

type ImageLoadState = {
  attempt: number;
  failed: boolean;
  sourceIndex: number;
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
  fallbackSrcs = [],
  fallback = null,
  maxRetries = 2,
  onError,
  src,
  ...props
}: ResilientImageProps) {
  const sources = [src, ...fallbackSrcs].filter((value, index, list) => {
    return value && list.indexOf(value) === index;
  });
  const [loadState, setLoadState] = useState<ImageLoadState>({
    attempt: 0,
    failed: false,
    sourceIndex: 0,
    src,
  });
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeLoadState =
    loadState.src === src
      ? loadState
      : { attempt: 0, failed: false, sourceIndex: 0, src };
  const attempt = activeLoadState.attempt;
  const activeSource = sources[activeLoadState.sourceIndex] ?? src;

  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, [src]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  if (activeLoadState.failed) {
    return fallback;
  }

  return (
    <img
      {...props}
      alt={alt}
      src={withRetryToken(activeSource, attempt)}
      onError={(event) => {
        onError?.(event);

        if (attempt >= maxRetries) {
          const nextSourceIndex = activeLoadState.sourceIndex + 1;

          if (nextSourceIndex < sources.length) {
            setLoadState({
              attempt: 0,
              failed: false,
              sourceIndex: nextSourceIndex,
              src,
            });
            return;
          }

          setLoadState({ ...activeLoadState, failed: true });
          return;
        }

        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
        }

        retryTimerRef.current = setTimeout(
          () =>
            setLoadState((currentState) => {
              const currentAttempt =
                currentState.src === src ? currentState.attempt : 0;

              return {
                attempt: currentAttempt + 1,
                failed: false,
                sourceIndex:
                  currentState.src === src ? currentState.sourceIndex : 0,
                src,
              };
            }),
          500 * (attempt + 1),
        );
      }}
    />
  );
}
