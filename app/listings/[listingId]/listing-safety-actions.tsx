'use client';

import { useEffect, useState } from 'react';
import { Flag, Heart } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@ui/button';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { useAuthSession } from '@/hooks/use-auth-session';
import { scheduleIdleTask } from '@/lib/client-idle-task';
import { cn } from '@/lib/utils';

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

type FavoriteStatePayload = {
  isFavorite?: boolean;
  canFavorite?: boolean;
};

export function ListingSafetyActions({
  listingId,
  sellerId,
  isOwnListing = false,
  showFavorite = true,
  showReport = true,
}: {
  listingId: string;
  sellerId: string;
  isOwnListing?: boolean;
  showFavorite?: boolean;
  showReport?: boolean;
}) {
  const router = useRouter();
  const { isSessionLoading, session } = useAuthSession();
  const [notice, setNotice] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [canFavorite, setCanFavorite] = useState(!isOwnListing);
  const canShowFavorite = showFavorite && canFavorite && !isOwnListing;
  const canShowReport = showReport && !isOwnListing;

  useEffect(() => {
    let isCurrent = true;

    async function checkFavoritePermission() {
      try {
        if (!session.authenticated || !session.user) {
          if (isCurrent) {
            setCanFavorite(true);
            setIsFavorite(false);
          }
          return;
        }

        if (session.user.id === sellerId) {
          if (isCurrent) {
            setCanFavorite(false);
            setIsFavorite(false);
          }
          return;
        }

        const favoriteResponse = await fetch(
          `/api/marketplace/listings/${listingId}/favorite`,
          { cache: 'no-store' },
        );

        if (!favoriteResponse.ok) {
          if (isCurrent) {
            setCanFavorite(true);
          }
          return;
        }

        const favoriteState = (await favoriteResponse.json()) as FavoriteStatePayload;

        if (isCurrent) {
          setCanFavorite(favoriteState.canFavorite !== false);
          setIsFavorite(Boolean(favoriteState.isFavorite));
        }
      } catch {
        if (isCurrent) {
          setCanFavorite(true);
        }
      }
    }

    let cancelIdleCheck = () => {};

    if (!isSessionLoading) {
      cancelIdleCheck = scheduleIdleTask(() => {
        void checkFavoritePermission();
      });
    }

    return () => {
      isCurrent = false;
      cancelIdleCheck();
    };
  }, [isSessionLoading, listingId, sellerId, session]);

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
      setNotice('تعذر تحديث المفضلة الآن.');
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
    } catch {
      setNotice('تعذر إرسال البلاغ الآن.');
    } finally {
      setIsReporting(false);
    }
  };

  const noticeTone =
    notice.startsWith('تعذر') || notice.startsWith('لا يمكن')
      ? 'danger'
      : 'success';

  return (
    <div className="grid gap-2">
      <FloatingActionNotice
        message={notice}
        onDismiss={() => setNotice('')}
        open={Boolean(notice)}
        tone={noticeTone}
      />
      <div
        className={cn(
          'grid gap-2',
          canShowFavorite && canShowReport
            ? 'grid-cols-2'
            : 'grid-cols-1',
        )}
      >
        {canShowFavorite && (
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
        {canShowReport && (
        <Button
          variant="outline"
          className="rounded-md"
          disabled={isReporting}
          onClick={reportCurrentListing}
        >
          <Flag className="size-4" />
          إبلاغ
        </Button>
        )}
      </div>
    </div>
  );
}
