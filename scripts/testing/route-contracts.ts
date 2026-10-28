import type { InventoryItem } from './inventory';

// These endpoints intentionally have guest flows or validate a different credential.
// Any new endpoint outside the protected families must be classified explicitly.
export const guestContracts: Record<string, string> = {
  'GET /splash': 'Public splash document',
  'GET /.well-known/apple-app-site-association': 'Public iOS application association, configured with the actual signing team',
  'POST /api/analytics/visit': 'Anonymous visit analytics',
  'GET /api/health': 'Hosting health probe',
  'GET /api/mobile/bootstrap': 'Public native application data and policies',
  'POST /api/internal/image-uploads/[uploadId]/claim': 'Image Worker server credential; never accepts a customer session as authorization',
  'POST /api/internal/image-uploads/[uploadId]/complete': 'Image Worker server credential and bound processing lease',
  'POST /api/internal/image-uploads/cleanup': 'Image Worker server credential for bounded upload lifecycle cleanup',
  'POST /api/internal/notifications/drain': 'Server Worker credential for bounded notification delivery; customer sessions never authorize this route',
  'GET /api/auth/session': 'Anonymous session discovery',
  'POST /api/auth/logout': 'Idempotent logout',
  'POST /api/auth/commission-agreement': 'Agreement before authentication',
  'GET /api/auth/apple/start': 'OAuth start',
  'GET /api/auth/apple/callback': 'OAuth callback state validation',
  'POST /api/auth/apple/callback': 'OAuth form callback state validation',
  'POST /api/auth/apple/native/challenge': 'Native Apple flow proof and commission agreement',
  'POST /api/auth/apple/native': 'Native Apple identity and bound challenge validation',
  'GET /api/auth/google/start': 'OAuth start',
  'GET /api/auth/google/callback': 'OAuth callback state validation',
  'GET /api/auth/google/native-config': 'Native OAuth configuration',
  'POST /api/auth/google/native': 'Native identity token validation',
  'GET /api/auth/mobile/open': 'Mobile deep link',
  'GET /api/auth/mobile/callback': 'Mobile callback token validation',
  'GET /api/auth/mobile/exchange': 'One-time mobile ticket validation',
  'POST /api/chat': 'Guest assistant auth response uses streaming protocol',
  'POST /api/chat/reset': 'Guest search state reset',
  'GET /api/realtime/stream': 'Guest-visible events; private events filtered',
  'GET /api/push/subscribe': 'Public push configuration',
  'POST /api/push/subscribe': 'Anonymous browser subscription supported',
  'DELETE /api/push/subscribe': 'Subscription endpoint identifies device',
  'GET /api/marketplace/listings': 'Public listing search',
  'GET /api/marketplace/listings/[listingId]': 'Public published listing',
  'GET /api/marketplace/listings/[listingId]/contact': 'Published listing contact matching the public website',
  'GET /api/marketplace/users/[userId]/profile': 'Public seller profile and published listings',
};

export function routeContract(endpoint: InventoryItem): 'guest' | 'session' | 'staff' | undefined {
  if (guestContracts[endpoint.id]) return 'guest';
  if (endpoint.path?.startsWith('/api/admin/') || endpoint.path?.startsWith('/api/moderator/')) return 'staff';
  if (endpoint.path?.startsWith('/api/marketplace/') ||
    endpoint.path?.startsWith('/api/account/') ||
    endpoint.path === '/api/notifications' || endpoint.path === '/api/mobile/push/register') return 'session';
  return undefined;
}

export function concretePath(path: string, values: Record<string, string> = {}) {
  return path.replace(/\[([^\]]+)\]/g, (_, name: string) =>
    encodeURIComponent(values[name] ?? `contract-missing-${name}`));
}

export function staffDeniedError(path: string) {
  return /^\/api\/admin\/(commissions|maintenance|site-message)(\/|$)/.test(path)
    ? 'owner_required' : 'admin_required';
}
