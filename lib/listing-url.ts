import { appUrl } from '@/lib/app-url';

export function getPublicListingPath(listingId: string) {
  return `/listings/${encodeURIComponent(listingId)}`;
}

export function getPublicListingUrl(listingId: string, baseUrl = appUrl) {
  return `${baseUrl.replace(/\/+$/, '')}${getPublicListingPath(listingId)}`;
}
