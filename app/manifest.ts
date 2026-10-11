import type { MetadataRoute } from 'next';

import { appConfig } from './app-config';

const pwaAssetVersion = 'souq-hamad-20261001';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appConfig.metadata.title,
    short_name: 'سوق حمد',
    description: appConfig.metadata.description,
    start_url: '/',
    scope: '/',
    display: 'browser',
    orientation: 'portrait',
    dir: 'rtl',
    lang: 'ar',
    background_color: '#e8edf3',
    theme_color: '#2563eb',
    categories: ['shopping', 'business'],
    icons: [
      {
        src: `/icon.png?v=${pwaAssetVersion}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `/icon.png?v=${pwaAssetVersion}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: `/apple-icon.png?v=${pwaAssetVersion}`,
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
