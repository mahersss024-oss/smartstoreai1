import { appUrl } from '@/lib/app-url';

export function getPublicSellerPath(sellerId: string) {
  return `/sellers/${encodeURIComponent(sellerId)}`;
}

export function getPublicSellerUrl(sellerId: string, baseUrl = appUrl) {
  return `${baseUrl.replace(/\/+$/, '')}${getPublicSellerPath(sellerId)}`;
}
