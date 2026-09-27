'use client';

/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';
import { UserRound } from 'lucide-react';

type SellerAvatarProps = {
  alt: string;
  className?: string;
  picture?: string;
};

const brokenProfilePictures = new Set<string>();

export function SellerAvatar({ alt, className = 'size-full object-cover', picture }: SellerAvatarProps) {
  const [failedPicture, setFailedPicture] = useState<string | null>(null);
  const canShowPicture = Boolean(
    picture && failedPicture !== picture && !brokenProfilePictures.has(picture),
  );

  if (!picture || !canShowPicture) {
    return <UserRound aria-hidden="true" className="size-6" />;
  }

  return (
    <img
      alt={alt}
      className={className}
      decoding="async"
      onError={() => {
        brokenProfilePictures.add(picture);
        setFailedPicture(picture);
      }}
      src={picture}
    />
  );
}
