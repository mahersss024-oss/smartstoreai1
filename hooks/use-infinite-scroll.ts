'use client';

import { useEffect, useRef, type RefObject } from 'react';

type UseInfiniteScrollOptions = {
  enabled: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  rootRef?: RefObject<Element | null>;
};

const loadMoreDistancePx = 640;

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
    const scrollTarget = scrollRoot ?? window;
    let didRequestLoad = false;

    const requestLoadMore = () => {
      if (didRequestLoad) {
        return;
      }

      didRequestLoad = true;
      onLoadMoreRef.current();
    };

    const isNearScrollEnd = () => {
      if (scrollRoot) {
        return (
          scrollRoot.scrollHeight - scrollRoot.scrollTop - scrollRoot.clientHeight <=
          loadMoreDistancePx
        );
      }

      const scrollingElement = document.scrollingElement ?? document.documentElement;

      return (
        scrollingElement.scrollHeight - window.scrollY - window.innerHeight <=
        loadMoreDistancePx
      );
    };

    const checkScrollPosition = () => {
      if (isNearScrollEnd()) {
        requestLoadMore();
      }
    };

    checkScrollPosition();
    scrollTarget.addEventListener('scroll', checkScrollPosition, {
      passive: true,
    });

    return () => {
      scrollTarget.removeEventListener('scroll', checkScrollPosition);
    };
  }, [enabled, isLoading, rootRef]);

  return triggerRef;
}
