'use client';

import type { ReactNode } from 'react';
import { preload } from 'react-dom';

import { ImageIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ResilientImage } from './resilient-image';

type ListingCardImageProps = {
  alt: string;
  className?: string;
  eager?: boolean;
  fallback?: ReactNode;
  fallbackSrcs?: string[];
  height?: number;
  maxRetries?: number;
  priority?: boolean;
  sizes?: string;
  src?: string | null;
  width?: number;
};

function DefaultListingImageFallback() {
  return (
    <span className="grid h-full w-full place-items-center text-slate-400">
      <ImageIcon className="size-5" />
    </span>
  );
}

export function ListingCardImage({
  alt,
  className,
  eager = false,
  fallback,
  fallbackSrcs,
  height = 116,
  maxRetries = 0,
  priority = false,
  sizes = '(min-width: 640px) 116px, 100px',
  src,
  width = 116,
}: ListingCardImageProps) {
  if (!src) {
    return fallback ?? <DefaultListingImageFallback />;
  }

  if (priority) {
    preload(src, { as: 'image', fetchPriority: 'high' });
  }

  return (
    <ResilientImage
      alt={alt}
      className={cn('h-full w-full object-cover', className)}
      decoding="async"
      fallback={fallback ?? <DefaultListingImageFallback />}
      fallbackSrcs={fallbackSrcs}
      fetchPriority={priority ? 'high' : 'auto'}
      height={height}
      loading={priority || eager ? 'eager' : 'lazy'}
      maxRetries={maxRetries}
      sizes={sizes}
      src={src}
      width={width}
    />
  );
}
