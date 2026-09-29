'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@ui/button';

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

export function SimilarListingFollowButton({
  listingId,
}: {
  listingId: string;
}) {
  const router = useRouter();
  const requestKeyRef = useRef<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState('');

  const endpoint = `/api/marketplace/listings/${encodeURIComponent(listingId)}/similar-follow`;

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      setIsLoading(true);

      try {
        const response = await fetch(endpoint, { cache: 'no-store' });

        if (response.status === 401) {
          return;
        }

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          isFollowing?: boolean;
        };

        if (!cancelled) {
          setIsFollowing(Boolean(payload.isFollowing));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadState();

    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const toggleFollow = useCallback(async () => {
    if (isLoading || requestKeyRef.current) {
      return;
    }

    requestKeyRef.current = createClientIdempotencyKey('similar-listing-follow');
    setIsLoading(true);
    setMessage('');

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Idempotency-Key': requestKeyRef.current,
        },
      });

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (!response.ok) {
        setMessage('تعذر تحديث متابعة الإعلانات المشابهة الآن.');
        return;
      }

      const payload = (await response.json()) as {
        isFollowing?: boolean;
      };
      const nextIsFollowing = Boolean(payload.isFollowing);

      setIsFollowing(nextIsFollowing);
      setMessage(
        nextIsFollowing
          ? 'سيصلك تنبيه عند نشر إعلان مشابه بدرجة قوية.'
          : 'تم إيقاف متابعة الإعلانات المشابهة.',
      );
    } catch {
      setMessage('تعذر تحديث متابعة الإعلانات المشابهة الآن.');
    } finally {
      requestKeyRef.current = null;
      setIsLoading(false);
    }
  }, [endpoint, isLoading, router]);

  return (
    <div className="grid gap-2">
      <Button
        className="h-10 w-full rounded-md"
        disabled={isLoading}
        onClick={() => void toggleFollow()}
        type="button"
        variant={isFollowing ? 'outline' : 'default'}
      >
        {isFollowing ? <BellOff className="size-4" /> : <Bell className="size-4" />}
        {isFollowing ? 'إيقاف متابعة المشابه' : 'تابع الإعلانات المشابهة'}
      </Button>
      {message ? (
        <p className="text-xs leading-6 text-muted-foreground">{message}</p>
      ) : null}
    </div>
  );
}
