'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@ui/button';

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

export function SellerProfileActions({
  reportListingId,
  sellerName,
}: {
  reportListingId?: string;
  sellerName: string;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const [isReporting, setIsReporting] = useState(false);

  async function reportSellerViaListing() {
    if (!reportListingId) {
      setNotice('لا يوجد إعلان منشور يمكن ربط البلاغ به حاليًا.');
      return;
    }

    setIsReporting(true);
    setNotice('');

    try {
      const response = await fetch(
        `/api/marketplace/listings/${reportListingId}/reports`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': createClientIdempotencyKey('seller-profile-report'),
          },
          body: JSON.stringify({
            reason: 'fraud',
            details: `بلاغ من صفحة المعلن العامة: ${sellerName}.`,
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
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          className="rounded-md"
          disabled
          title="سيتم تفعيل المتابعة في مرحلة لاحقة"
        >
          متابعة
        </Button>
        <Button
          variant="outline"
          className="rounded-md"
          disabled={isReporting}
          onClick={reportSellerViaListing}
        >
          <Flag className="size-4" />
          {isReporting ? 'جار الإبلاغ...' : 'إبلاغ'}
        </Button>
      </div>
      {notice && (
        <p className="text-xs font-semibold text-muted-foreground">{notice}</p>
      )}
    </div>
  );
}
