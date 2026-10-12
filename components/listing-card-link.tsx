'use client';

import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

type ListingCardLinkProps = {
  children: ReactNode;
  className?: string;
  href: string;
  prefetch?: false;
  waitForImage?: boolean;
};

export function ListingCardLink({
  children,
  className,
  href,
  prefetch = false,
  waitForImage = false,
}: ListingCardLinkProps) {
  const [isImagePending, setIsImagePending] = useState(waitForImage);

  useEffect(() => {
    setIsImagePending(waitForImage);
  }, [href, waitForImage]);

  const stopPendingNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isImagePending) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <Link
      aria-disabled={isImagePending || undefined}
      className={cn(
        'marketplace-listing-card relative',
        isImagePending && 'cursor-wait',
        className,
      )}
      data-image-loading={isImagePending || undefined}
      href={href}
      onClick={stopPendingNavigation}
      onErrorCapture={() => setIsImagePending(false)}
      onLoadCapture={() => setIsImagePending(false)}
      prefetch={prefetch}
      tabIndex={isImagePending ? -1 : 0}
    >
      {children}
    </Link>
  );
}
