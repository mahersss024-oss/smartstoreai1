'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes, ReactNode } from 'react';

type ResilientImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  fallbackSrcs?: string[];
  fallback?: ReactNode;
  maxRetries?: number;
  loadTimeoutMs?: number;
  src: string;
};

type ImageLoadState = {
  attempt: number;
  failed: boolean;
  sourceIndex: number;
  src: string;
};

export function ResilientImage({
  alt = '',
  fallbackSrcs = [],
  fallback = null,
  maxRetries = 2,
  loadTimeoutMs = 15_000,
  onError,
  onLoad,
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
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const activeLoadState =
    loadState.src === src
      ? loadState
      : { attempt: 0, failed: false, sourceIndex: 0, src };
  const attempt = activeLoadState.attempt;
  const activeSource = sources[activeLoadState.sourceIndex] ?? src;
  const sourceIndex = activeLoadState.sourceIndex;
  const sourceCount = sources.length;

  useEffect(() => {
    const image = imageRef.current;
    if (!image || activeLoadState.failed || (image.complete && image.naturalWidth > 0)) return;
    let observer: IntersectionObserver | undefined;
    const start = () => {
      if (loadTimerRef.current || (image.complete && image.naturalWidth > 0)) return;
      loadTimerRef.current = setTimeout(() => {
        loadTimerRef.current = null;
        // A pending source should not delay a different available variant.
        setLoadState(current => {
          if (current.src !== src && sourceIndex !== 0) return current;
          if (sourceIndex + 1 < sourceCount) {
            return { src, sourceIndex: sourceIndex + 1, attempt: 0, failed: false };
          }
          return { src, sourceIndex, attempt: attempt + 1, failed: attempt >= maxRetries };
        });
      }, loadTimeoutMs);
    };
    if (props.loading === 'lazy' && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          start();
          observer?.disconnect();
        }
      });
      observer.observe(image);
    } else {
      start();
    }
    return () => {
      observer?.disconnect();
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
      loadTimerRef.current = null;
    };
  }, [src, activeSource, sourceIndex, sourceCount, attempt, activeLoadState.failed, loadTimeoutMs, maxRetries, props.loading]);

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
      key={`${src}:${sourceIndex}:${attempt}`}
      ref={imageRef}
      alt={alt}
      src={activeSource}
      onLoad={(event) => {
        if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
        onLoad?.(event);
      }}
      onError={(event) => {
        if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
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
