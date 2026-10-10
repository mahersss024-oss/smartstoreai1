'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const pullThreshold = 72;
const maxPullDistance = 96;
const pullStartMaxY = 104;
const pullIntentMinDistance = 14;
const horizontalIntentRatio = 0.4;

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      [
        'input',
        'textarea',
        'select',
        'a',
        'button',
        'summary',
        '[contenteditable="true"]',
        '[role="button"]',
        '[role="link"]',
        '[role="slider"]',
        '[data-radix-popper-content-wrapper]',
        '.smartstore-ai-bubble',
        '[data-no-pull-refresh]',
      ].join(','),
    ),
  );
}

function isTouchDevice() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

export function PullToRefresh() {
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const resetPull = useCallback(() => {
    startPointRef.current = null;
    setPullDistance(0);
  }, []);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    window.dispatchEvent(new CustomEvent('smartstore:pull-refresh'));
    window.setTimeout(() => window.location.reload(), 120);
  }, []);

  useEffect(() => {
    if (!isTouchDevice()) {
      return;
    }

    const onTouchStart = (event: TouchEvent) => {
      if (
        event.touches.length !== 1 ||
        window.scrollY > 0 ||
        isInteractiveTarget(event.target)
      ) {
        startPointRef.current = null;
        return;
      }

      const touch = event.touches[0];
      if (touch.clientY > pullStartMaxY) {
        startPointRef.current = null;
        return;
      }

      startPointRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const onTouchMove = (event: TouchEvent) => {
      const startPoint = startPointRef.current;

      if (!startPoint || event.touches.length !== 1 || window.scrollY > 0) {
        return;
      }

      const touch = event.touches[0];
      const deltaX = touch.clientX - startPoint.x;
      const deltaY = touch.clientY - startPoint.y;

      if (
        deltaY < pullIntentMinDistance ||
        Math.abs(deltaX) > deltaY * horizontalIntentRatio
      ) {
        setPullDistance(0);
        return;
      }

      setPullDistance(Math.min(maxPullDistance, deltaY * 0.45));
    };

    const onTouchEnd = () => {
      if (pullDistance >= pullThreshold && !isRefreshing) {
        void refresh();
        return;
      }

      resetPull();
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', resetPull, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', resetPull);
    };
  }, [isRefreshing, pullDistance, refresh, resetPull]);

  if (!pullDistance && !isRefreshing) {
    return null;
  }

  const isReady = pullDistance >= pullThreshold;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[60] flex justify-center lg:hidden"
      style={{
        transform: `translateY(${Math.max(0, pullDistance - 44)}px)`,
      }}
    >
      <div
        className={`grid size-10 place-items-center rounded-full border bg-white/95 text-blue-600 shadow-lg shadow-slate-950/15 transition dark:border-white/10 dark:bg-slate-900/95 ${
          isReady || isRefreshing ? 'scale-100 opacity-100' : 'scale-90 opacity-80'
        }`}
      >
        <RefreshCw
          className={`size-5 ${isRefreshing ? 'animate-spin' : ''}`}
          style={{
            transform: isRefreshing
              ? undefined
              : `rotate(${Math.min(180, pullDistance * 2)}deg)`,
          }}
        />
      </div>
    </div>
  );
}
