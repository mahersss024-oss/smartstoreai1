import type { MetadataRoute } from 'next';

import { appConfig } from './app-config';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appConfig.metadata.title,
    short_name: 'سوق حمد',
    description: appConfig.metadata.description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    dir: 'rtl',
    lang: 'ar',
    background_color: '#e8edf3',
    theme_color: '#2563eb',
    categories: ['shopping', 'business'],
    icons: [
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/apple-icon.png',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}

