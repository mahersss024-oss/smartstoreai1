'use client';

import { useRef, useState } from 'react';
import { MessageCircle, Phone, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@ui/button';

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

export function ListingContactActions({
  listingId,
  sellerPhoneNumber,
}: {
  listingId: string;
  sellerPhoneNumber?: string | null;
}) {
  const router = useRouter();
  const requestKeyRef = useRef<string | null>(null);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isContactSheetOpen, setIsContactSheetOpen] = useState(false);
  const cleanSellerPhoneNumber = sellerPhoneNumber?.trim() ?? '';

  const openConversation = async () => {
    if (isLoading || requestKeyRef.current) {
      return;
    }

    requestKeyRef.current = createClientIdempotencyKey('conversation');
    setIsLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/marketplace/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': requestKeyRef.current,
        },
        body: JSON.stringify({ listingId }),
      });

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (response.status === 409) {
        setMessage('لا يمكن فتح محادثة مع إعلانك أنت.');
        return;
      }

      if (!response.ok) {
        setMessage('تعذر فتح المحادثة لهذا الإعلان.');
        return;
      }

      const payload = (await response.json()) as {
        conversation?: { id?: string };
      };

      if (payload.conversation?.id) {
        setIsContactSheetOpen(false);
        router.push(
          `/conversations/${payload.conversation.id}?listingId=${encodeURIComponent(listingId)}`,
        );
        return;
      }

      setMessage('تم فتح محادثة داخلية بخصوص الإعلان.');
    } catch {
      setMessage('تعذر فتح المحادثة الآن. حاول مرة أخرى.');
    } finally {
      requestKeyRef.current = null;
      setIsLoading(false);
    }
  };

  return (
    <div className="grid gap-3">
      <Button
        className="h-11 rounded-md bg-blue-600 hover:bg-blue-700"
        disabled={isLoading}
        onClick={() => setIsContactSheetOpen(true)}
        type="button"
      >
        <MessageCircle className="size-4" />
        تواصل مع المعلن
      </Button>

      {isContactSheetOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/35 px-4 backdrop-blur-[1px]"
          onClick={() => setIsContactSheetOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border bg-white p-4 text-[#142033] shadow-2xl dark:bg-card dark:text-foreground"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <button
                aria-label="إغلاق"
                className="grid size-9 place-items-center rounded-full text-muted-foreground transition hover:bg-slate-100 dark:hover:bg-white/10"
                onClick={() => setIsContactSheetOpen(false)}
                type="button"
              >
                <X className="size-5" />
              </button>
              <h2 className="text-lg font-black">التواصل مع المعلن</h2>
            </div>

            <div className="grid divide-y rounded-xl border bg-white dark:divide-white/10 dark:bg-background">
              <button
                className="flex h-14 items-center justify-between gap-3 px-4 text-right text-sm font-bold text-blue-700 transition hover:bg-blue-50 dark:text-blue-200 dark:hover:bg-blue-400/10"
                disabled={isLoading}
                onClick={openConversation}
                type="button"
              >
                <span>
                  {isLoading
                    ? 'جار فتح المحادثة...'
                    : 'مراسلة داخل سوق حمد'}
                </span>
                <MessageCircle className="size-5 shrink-0" />
              </button>

              {cleanSellerPhoneNumber && (
                <a
                  className="flex h-14 items-center justify-between gap-3 px-4 text-right text-sm font-bold text-blue-700 transition hover:bg-blue-50 dark:text-blue-200 dark:hover:bg-blue-400/10"
                  dir="ltr"
                  href={`tel:${cleanSellerPhoneNumber}`}
                >
                  <span>{cleanSellerPhoneNumber}</span>
                  <Phone className="size-5 shrink-0" />
                </a>
              )}
            </div>

            {!cleanSellerPhoneNumber && (
              <p className="mt-3 text-center text-xs leading-6 text-muted-foreground">
                المعلن لم يضف رقم جوال في حسابه، يمكنك المراسلة داخل سوق حمد.
              </p>
            )}
          </div>
        </div>
      )}

      {message && (
        <div className="rounded-md border bg-white px-3 py-2 text-sm text-muted-foreground dark:bg-card">
          {message}
        </div>
      )}
    </div>
  );
}
