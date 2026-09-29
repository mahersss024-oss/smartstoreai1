'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, QrCode, Share2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

import { isInsideNativeApp, postToNative } from '@/lib/native/app-bridge';
import { Button } from '@ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@ui/dialog';

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
  const [linkCopied, setLinkCopied] = useState(false);
  const [profileUrl] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.href,
  );
  const sellerHandle = useMemo(() => `@${sellerId}`, [sellerId]);

  async function copySellerId() {
    await copyText(sellerId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function copySellerProfileUrl() {
    await copyText(profileUrl || window.location.href);
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1600);
  }

  async function shareSellerProfile() {
    const url = profileUrl || window.location.href;
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
      <Dialog>
        <DialogTrigger asChild>
          <Button
            aria-label="باركود ملف المعلن"
            className="size-8 shrink-0 rounded-md text-blue-600"
            size="icon-sm"
            title="باركود ملف المعلن"
            type="button"
            variant="ghost"
          >
            <QrCode className="size-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-[22rem] rounded-md p-5 text-center" dir="rtl">
          <DialogHeader className="items-center text-center">
            <DialogTitle>مشاركة ملف المعلن</DialogTitle>
            <DialogDescription>
              امسح الباركود أو شارك رابط ملف المعلن.
            </DialogDescription>
          </DialogHeader>

          <div className="mx-auto grid size-48 place-items-center rounded-md border bg-white p-3 shadow-sm">
            {profileUrl ? (
              <QRCodeSVG
                bgColor="#ffffff"
                fgColor="#0f172a"
                level="M"
                size={168}
                value={profileUrl}
              />
            ) : (
              <QrCode className="size-16 text-blue-600" />
            )}
          </div>

          <div className="min-w-0 text-center">
            <div className="truncate text-base font-bold">{sellerName}</div>
            <div className="truncate text-sm font-semibold text-muted-foreground" dir="ltr">
              {sellerHandle}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              className="rounded-md"
              onClick={() => void shareSellerProfile()}
              type="button"
            >
              <Share2 className="size-4" />
              مشاركة
            </Button>
            <Button
              className="rounded-md"
              onClick={() => void copySellerProfileUrl()}
              type="button"
              variant="outline"
            >
              {linkCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {linkCopied ? 'تم النسخ' : 'نسخ الرابط'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <span className="min-w-0 select-all truncate font-semibold" dir="ltr" title={sellerId}>
        {sellerHandle}
      </span>
      <Button
        aria-label="نسخ معرف المستخدم"
        className="size-8 shrink-0 rounded-md"
        onClick={() => void copySellerId()}
        size="icon-sm"
        title="نسخ معرف المستخدم"
        type="button"
        variant="outline"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        <span className="sr-only">{copied ? 'تم النسخ' : 'نسخ'}</span>
      </Button>
      <Button
        aria-label="مشاركة ملف المعلن"
        className="size-8 shrink-0 rounded-md"
        onClick={() => void shareSellerProfile()}
        size="icon-sm"
        title="مشاركة ملف المعلن"
        type="button"
        variant="outline"
      >
        <Share2 className="size-3.5" />
        <span className="sr-only">مشاركة</span>
      </Button>
    </div>
  );
}
