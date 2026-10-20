# Push Notifications

سوق حمد supports Web Push (RFC 8030/8188/8291) with VAPID (RFC 8292).
The implementation is self-contained on `node:crypto` and adds no third-party
runtime dependency.

## How it works

1. The service worker registers on launch (`components/service-worker-registrar.tsx`).
2. `components/push-notification-settings.tsx`, mounted on `/notifications`, checks
   `/api/push/subscribe` for support and the VAPID public key, then subscribes the
   browser after the customer chooses to enable notifications.
3. Subscriptions are persisted via `agent/marketplace/push-subscriptions.ts`
   (file store locally, `PushSubscription` table in database mode).
4. Server-side sends use `lib/push/web-push.ts` (aes128gcm encryption + VAPID JWT).

## Required environment variables

| Variable | Purpose |
| --- | --- |
| `SMARTSTORE_VAPID_PUBLIC_KEY` | base64url uncompressed P-256 public point |
| `SMARTSTORE_VAPID_PRIVATE_KEY` | base64url P-256 private scalar |
| `SMARTSTORE_VAPID_SUBJECT` | `mailto:` or `https:` contact for VAPID `sub` |
| `SMARTSTORE_PUSH_TIMEOUT_MS` | optional send timeout, defaults to `10000` |

When these are missing, push stays disabled and `/api/push/subscribe` returns
`configured: false`. The UI degrades gracefully.
Push sends are bounded by `SMARTSTORE_PUSH_TIMEOUT_MS` so slow or stalled push
providers do not hold server work indefinitely.

## Generating VAPID keys


