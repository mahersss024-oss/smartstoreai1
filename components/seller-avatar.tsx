'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';

type SellerAvatarProps = {
  alt: string;
  className?: string;
  picture?: string;
};

export function SellerAvatar({ alt, className = 'size-full object-cover', picture }: SellerAvatarProps) {
  const [canShowPicture, setCanShowPicture] = useState(Boolean(picture));

  useEffect(() => {
    setCanShowPicture(Boolean(picture));
  }, [picture]);

  if (!picture || !canShowPicture) {
    return <UserRound aria-hidden="true" className="size-6" />;
  }

  return (
    <img
      alt={alt}
      className={className}
      decoding="async"
      onError={() => setCanShowPicture(false)}
      src={picture}
    />
  );
}
