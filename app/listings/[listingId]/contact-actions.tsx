'use client';

import { useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@ui/button';

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

export function ListingContactActions({ listingId }: { listingId: string }) {
  const router = useRouter();
  const requestKeyRef = useRef<string | null>(null);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
        router.push(`/conversations/${payload.conversation.id}`);
        return;
      }

      setMessage('تم فتح محادثة داخلية بخصوص الإعلان.');
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
        onClick={openConversation}
      >
        <MessageCircle className="size-4" />
        تواصل مع البائع
      </Button>
      {message && (
        <div className="rounded-md border bg-white px-3 py-2 text-sm text-muted-foreground dark:bg-card">
          {message}
        </div>
      )}
    </div>
  );
}
