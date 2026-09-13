'use client';

import { useEffect, useState } from 'react';
import { Flag, Heart, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@ui/button';
import { cn } from '@/lib/utils';

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

type SessionPayload = {
  authenticated: boolean;
  user: { id: string } | null;
};

export function ListingSafetyActions({
  listingId,
  sellerId,
}: {
  listingId: string;
  sellerId: string;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [canFavorite, setCanFavorite] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    async function checkFavoritePermission() {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });

        if (!response.ok) {
          if (isCurrent) {
            setCanFavorite(true);
          }
          return;
        }

        const session = (await response.json()) as SessionPayload;

        if (isCurrent) {
          setCanFavorite(session.user?.id !== sellerId);
        }
      } catch {
        if (isCurrent) {
          setCanFavorite(true);
        }
      }
    }

    checkFavoritePermission();

    return () => {
      isCurrent = false;
    };
  }, [sellerId]);

  const saveFavorite = async () => {
    setIsSaving(true);
    setNotice('');
    const previousFavorite = isFavorite;

    try {
      setIsFavorite(!previousFavorite);

      const response = await fetch(
        `/api/marketplace/listings/${listingId}/favorite`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': createClientIdempotencyKey('favorite-toggle'),
          },
        },
      );

      if (response.status === 401) {
        setIsFavorite(previousFavorite);
        router.push('/api/auth/google/start');
        return;
      }

      if (response.status === 409) {
        setIsFavorite(previousFavorite);
        setNotice('لا يمكن حفظ إعلانك أنت في المفضلة.');
        return;
      }

      if (!response.ok) {
        setIsFavorite(previousFavorite);
        setNotice('تعذر تحديث المفضلة الآن.');
        return;
      }

      const payload = (await response.json()) as { status?: string };
      setIsFavorite(payload.status !== 'removed');
      setNotice(
        payload.status === 'removed'
          ? 'تمت إزالة الإعلان من المفضلة.'
          : 'تم حفظ الإعلان في المفضلة.',
      );
    } catch {
      setIsFavorite(previousFavorite);
      setNotice('طھط¹ط°ط± طھط­ط¯ظٹط« ط§ظ„ظ…ظپط¶ظ„ط© ط§ظ„ط¢ظ†.');
    } finally {
      setIsSaving(false);
    }
  };

  const reportCurrentListing = async () => {
    setIsReporting(true);
    setNotice('');

    try {
      const response = await fetch(
        `/api/marketplace/listings/${listingId}/reports`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': createClientIdempotencyKey('listing-report'),
          },
          body: JSON.stringify({
            reason: 'prohibited_item',
            details: 'بلاغ من صفحة تفاصيل الإعلان.',
          }),
        },
      );

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (!response.ok) {
        setNotice('تعذر إرسال البلاغ الآن.');
        return;
      }

      setNotice('تم إرسال البلاغ للمراجعة.');
    } finally {
      setIsReporting(false);
    }
  };

  return (
    <div className="grid gap-2">
      <div className={cn('grid gap-2', canFavorite ? 'grid-cols-2' : 'grid-cols-1')}>
        {canFavorite && (
        <Button
          variant="outline"
          className={cn(
            'rounded-md',
            isFavorite &&
              'border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-300/40 dark:bg-blue-500/15 dark:text-blue-200',
          )}
          disabled={isSaving}
          onClick={saveFavorite}
          aria-pressed={isFavorite}
        >
          <Heart className={cn('size-4', isFavorite && 'fill-current')} />
          حفظ
        </Button>
        )}
        <Button
          variant="outline"
          className="rounded-md"
          disabled={isReporting}
          onClick={reportCurrentListing}
        >
          <Flag className="size-4" />
          إبلاغ
        </Button>
      </div>
      {notice && (
        <div className="flex items-start gap-2 rounded-md border bg-white px-3 py-2 text-xs leading-6 text-muted-foreground dark:bg-card">
          <ShieldAlert className="mt-1 size-4 shrink-0 text-blue-600" />
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
}
