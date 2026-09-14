'use client';

import { useMemo, useState } from 'react';
import { Check, Share2 } from 'lucide-react';

import { getPublicListingUrl } from '@/lib/listing-url';
import { isInsideNativeApp, postToNative } from '@/lib/native/app-bridge';
import { Button } from '@ui/button';

type ListingShareButtonProps = {
  listingId: string;
  title?: string;
  className?: string;
};

export function ListingShareButton({
  listingId,
  title,
  className,
}: ListingShareButtonProps) {
  const [status, setStatus] = useState<'idle' | 'shared' | 'copied'>('idle');
  const listingUrl = useMemo(() => getPublicListingUrl(listingId), [listingId]);

  async function copyListingUrl() {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(listingUrl);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = listingUrl;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  async function shareListing() {
    const shareTitle = title?.trim() || 'SmartStore AI';

    if (isInsideNativeApp() && postToNative({ type: 'share', url: listingUrl, title: shareTitle })) {
      setStatus('shared');
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareTitle,
          url: listingUrl,
        });
        setStatus('shared');
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
      }
    }

    await copyListingUrl();
    setStatus('copied');
  }

  return (
    <Button
      className={className}
      onClick={() => void shareListing()}
      size="sm"
      type="button"
      variant="outline"
    >
      {status === 'idle' ? (
        <Share2 className="size-3.5" />
      ) : (
        <Check className="size-3.5" />
      )}
      {status === 'copied'
        ? 'تم نسخ الرابط'
        : status === 'shared'
          ? 'تمت المشاركة'
          : 'مشاركة الإعلان'}
    </Button>
  );
}
