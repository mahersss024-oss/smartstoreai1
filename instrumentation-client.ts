import { beginPageTransition, type PageNavigationType } from '@/lib/navigation/page-transition';

export function onRouterTransitionStart(url: string, navigationType: PageNavigationType) {
  beginPageTransition(url, navigationType);
}
