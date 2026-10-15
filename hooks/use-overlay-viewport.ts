'use client';

import { useCallback, type Ref } from 'react';

// Apply viewport coordinates only while an overlay is mounted. No page-scroll
// listener or React state updates are needed for keyboard and pinch-zoom changes.
export function useOverlayViewport<T extends HTMLElement>(forwardedRef?: Ref<T>) {
  return useCallback((element: T | null) => {
    const forwardedCleanup = typeof forwardedRef === 'function'
      ? forwardedRef(element) : undefined;
    if (forwardedRef && typeof forwardedRef !== 'function') forwardedRef.current = element;
    if (!element) return;

    const viewport = window.visualViewport;
    const updatePosition = () => {
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      element.style.setProperty('--overlay-top', `${top}px`);
      element.style.setProperty('--overlay-left', `${left}px`);
      element.style.setProperty('--overlay-width', `${width}px`);
      element.style.setProperty('--overlay-height', `${height}px`);
      element.style.setProperty('--overlay-center-x', `${left + width / 2}px`);
      element.style.setProperty('--overlay-center-y', `${top + height / 2}px`);
    };
    updatePosition();
    viewport?.addEventListener('resize', updatePosition);
    viewport?.addEventListener('scroll', updatePosition);
    if (!viewport) window.addEventListener('resize', updatePosition);
    return () => {
      viewport?.removeEventListener('resize', updatePosition);
      viewport?.removeEventListener('scroll', updatePosition);
      if (!viewport) window.removeEventListener('resize', updatePosition);
      if (typeof forwardedCleanup === 'function') forwardedCleanup();
      else if (typeof forwardedRef === 'function') forwardedRef(null);
      else if (forwardedRef) forwardedRef.current = null;
    };
  }, [forwardedRef]);
}
