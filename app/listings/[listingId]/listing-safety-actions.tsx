'use client';

import { useState } from 'react';
import { Flag, Heart, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@ui/button';

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

export function ListingSafetyActions({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isReporting, setIsReporting] = useState(false);

  const saveFavorite = async () => {
    setIsSaving(true);
    setNotice('');

    try {
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
        router.push('/api/auth/google/start');
        return;
      }

      if (response.status === 409) {
        setNotice('لا يمكن حفظ إعلانك أنت في المفضلة.');
        return;
      }

      if (!response.ok) {
        setNotice('تعذر تحديث المفضلة الآن.');
        return;
      }

      const payload = (await response.json()) as { status?: string };
      setNotice(
        payload.status === 'removed'
          ? 'تمت إزالة الإعلان من المفضلة.'
          : 'تم حفظ الإعلان في المفضلة.',
      );
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
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="rounded-md"
          disabled={isSaving}
          onClick={saveFavorite}
        >
          <Heart className="size-4" />
          حفظ
        </Button>
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
