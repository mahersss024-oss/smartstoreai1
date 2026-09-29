'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from '@ui/button';

type ListingIdCopyButtonProps = {
  listingId: string;
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

export function ListingIdCopyButton({ listingId }: ListingIdCopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await copyText(listingId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Button
      aria-label="نسخ رقم الإعلان"
      className="size-8 shrink-0 rounded-md"
      onClick={() => void handleCopy()}
      size="icon-sm"
      title="نسخ رقم الإعلان"
      type="button"
      variant="outline"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span className="sr-only">{copied ? 'تم النسخ' : 'نسخ'}</span>
    </Button>
  );
}
