'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, QrCode, Share2 } from 'lucide-react';

import { isInsideNativeApp, postToNative } from '@/lib/native/app-bridge';
import { Button } from '@ui/button';

type SellerProfileIdentityProps = {
  sellerId: string;
  sellerName: string;
};

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function SellerProfileIdentity({
  sellerId,
  sellerName,
}: SellerProfileIdentityProps) {
  const [copied, setCopied] = useState(false);
  const sellerHandle = useMemo(() => `@${sellerId}`, [sellerId]);

  async function copySellerId() {
    await copyText(sellerId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function shareSellerProfile() {
    const url = window.location.href;
    const title = sellerName.trim() || 'ملف معلن سوق حمد';

    if (isInsideNativeApp() && postToNative({ type: 'share', url, title })) {
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({ title, text: title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
      }
    }

    await copyText(url);
  }

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Button
        aria-label="مشاركة ملف المعلن"
        className="h-8 shrink-0 rounded-md px-2"
        onClick={() => void shareSellerProfile()}
        title="مشاركة ملف المعلن"
        type="button"
        variant="ghost"
      >
        <QrCode className="size-4 text-blue-600" />
      </Button>
      <span className="min-w-0 select-all truncate font-semibold" dir="ltr" title={sellerId}>
        {sellerHandle}
      </span>
      <Button
        aria-label="نسخ معرف المستخدم"
        className="h-8 shrink-0 rounded-md px-2 text-xs"
        onClick={() => void copySellerId()}
        title="نسخ معرف المستخدم"
        type="button"
        variant="outline"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        <span>{copied ? 'تم النسخ' : 'نسخ'}</span>
      </Button>
      <Button
        aria-label="مشاركة ملف المعلن"
        className="h-8 shrink-0 rounded-md px-2 text-xs"
        onClick={() => void shareSellerProfile()}
        title="مشاركة ملف المعلن"
        type="button"
        variant="outline"
      >
        <Share2 className="size-3.5" />
        <span>مشاركة</span>
      </Button>
    </div>
  );
}
