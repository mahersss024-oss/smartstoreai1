'use client';

import { useEffect, useState } from 'react';
import { Flag, Star, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@ui/button';

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

export function SellerProfileActions({
  sellerId,
  sellerName,
  initialFollowerCount,
  initialRatingAverage,
  initialRatingCount,
}: {
  sellerId: string;
  sellerName: string;
  initialFollowerCount: number;
  initialRatingAverage: number;
  initialRatingCount: number;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  const [ratingAverage, setRatingAverage] = useState(initialRatingAverage);
  const [ratingCount, setRatingCount] = useState(initialRatingCount);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [canFollow, setCanFollow] = useState(true);
  const [canRate, setCanRate] = useState(true);
  const [isFollowingLoading, setIsFollowingLoading] = useState(false);
  const [isRatingLoading, setIsRatingLoading] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const encodedSellerId = encodeURIComponent(sellerId);

  useEffect(() => {
    let ignore = false;

    async function loadState() {
      const [followResponse, ratingResponse] = await Promise.all([
        fetch(`/api/marketplace/users/${encodedSellerId}/follow`),
        fetch(`/api/marketplace/users/${encodedSellerId}/ratings`),
      ]);

      if (ignore) {
        return;
      }

      if (followResponse.ok) {
        const followState = await followResponse.json();

        setIsFollowing(Boolean(followState.isFollowing));
        setFollowerCount(Number(followState.followerCount ?? initialFollowerCount));
        setCanFollow(Boolean(followState.canFollow));
      } else if (followResponse.status === 401) {
        setCanFollow(true);
      }

      if (ratingResponse.ok) {
        const ratingState = await ratingResponse.json();

        setRatingAverage(Number(ratingState.ratingAverage ?? initialRatingAverage));
        setRatingCount(Number(ratingState.ratingCount ?? initialRatingCount));
        setMyRating(
          typeof ratingState.myRating?.rating === 'number'
            ? ratingState.myRating.rating
            : null,
        );
        setCanRate(ratingState.status !== 'self_rating_blocked');
      } else if (ratingResponse.status === 401) {
        setCanRate(true);
      }
    }

    loadState().catch(() => undefined);

    return () => {
      ignore = true;
    };
  }, [encodedSellerId, initialFollowerCount, initialRatingAverage, initialRatingCount]);

  async function toggleFollow() {
    setIsFollowingLoading(true);
    setNotice('');

    try {
      const response = await fetch(`/api/marketplace/users/${encodedSellerId}/follow`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': createClientIdempotencyKey('seller-follow'),
        },
      });

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (response.status === 409) {
        setCanFollow(false);
        setNotice('لا يمكنك متابعة حسابك.');
        return;
      }

      if (!response.ok) {
        setNotice('تعذر تحديث المتابعة الآن.');
        return;
      }

      const result = await response.json();

      setIsFollowing(Boolean(result.isFollowing));
      setFollowerCount(Number(result.followerCount ?? followerCount));
    } finally {
      setIsFollowingLoading(false);
    }
  }

  async function rate(value: number) {
    setIsRatingLoading(true);
    setNotice('');

    try {
      const response = await fetch(`/api/marketplace/users/${encodedSellerId}/ratings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createClientIdempotencyKey('seller-rating'),
        },
        body: JSON.stringify({ rating: value }),
      });

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (response.status === 409) {
        setCanRate(false);
        setNotice('لا يمكنك تقييم حسابك.');
        return;
      }

      if (!response.ok) {
        setNotice('تعذر حفظ التقييم الآن.');
        return;
      }

      const result = await response.json();

      setMyRating(result.myRating?.rating ?? value);
      setRatingAverage(Number(result.ratingAverage ?? ratingAverage));
      setRatingCount(Number(result.ratingCount ?? ratingCount));
    } finally {
      setIsRatingLoading(false);
    }
  }

  async function reportSeller() {
    setIsReporting(true);
    setNotice('');

    try {
      const response = await fetch(
        `/api/marketplace/users/${encodedSellerId}/reports`,
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
        if (response.status === 409) {
          setNotice('يوجد بلاغ مفتوح لهذا المعلن قيد المراجعة.');
          return;
        }

        setNotice('تعذر إرسال البلاغ الآن.');
        return;
      }

      setNotice('تم إرسال البلاغ للمراجعة.');
    } finally {
      setIsReporting(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={isFollowing ? 'default' : 'outline'}
          className="rounded-md"
          disabled={!canFollow || isFollowingLoading}
          onClick={toggleFollow}
        >
          <UserPlus className="size-4" />
          {isFollowing ? 'متابَع' : 'متابعة'}
        </Button>
        <Button
          variant="outline"
          className="rounded-md"
          disabled={isReporting}
          onClick={reportSeller}
        >
          <Flag className="size-4" />
          {isReporting ? 'جار الإبلاغ...' : 'إبلاغ'}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{followerCount} متابع</span>
        <span>{ratingCount} تقييم</span>
        <span>{ratingAverage.toFixed(1)} / 5</span>
      </div>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            className="rounded-md p-1 text-blue-600 transition hover:bg-blue-500/10 disabled:opacity-50"
            disabled={!canRate || isRatingLoading}
            title={`تقييم ${value}`}
            onClick={() => rate(value)}
          >
            <Star
              className="size-4"
              fill={myRating && value <= myRating ? 'currentColor' : 'none'}
            />
          </button>
        ))}
      </div>
      {notice && (
        <p className="text-xs font-semibold text-muted-foreground">{notice}</p>
      )}
    </div>
  );
}
