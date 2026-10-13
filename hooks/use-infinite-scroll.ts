'use client';

import { useEffect, useRef, type RefObject } from 'react';

type UseInfiniteScrollOptions = {
  enabled: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  rootRef?: RefObject<Element | null>;
  rootMargin?: string;
};

function findNearestScrollRoot(element: Element): Element | null {
  let parent = element.parentElement;

  while (parent && parent !== document.body && parent !== document.documentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;

    if (/(auto|scroll|overlay)/.test(overflowY)) {
      return parent;
    }

    parent = parent.parentElement;
  }

  return null;
}

export function useInfiniteScroll({
  enabled,
  isLoading,
  onLoadMore,
  rootRef,
  rootMargin = '640px 0px',
}: UseInfiniteScrollOptions): RefObject<HTMLDivElement | null> {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const triggerElement = triggerRef.current;

    if (!triggerElement || !enabled || isLoading) {
      return;
    }

    const scrollRoot = rootRef?.current ?? findNearestScrollRoot(triggerElement);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          onLoadMoreRef.current();
        }
      },
      {
        root: scrollRoot,
        rootMargin,
        threshold: 0,
      },
    );

    observer.observe(triggerElement);

    return () => {
      observer.disconnect();
    };
  }, [enabled, isLoading, rootMargin]);

  return triggerRef;
}
