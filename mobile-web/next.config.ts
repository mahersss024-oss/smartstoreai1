import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  distDir: '.next-mobile',
  assetPrefix: process.env.NEXT_PUBLIC_MOBILE_ASSET_ORIGIN?.trim() || 'https://localhost',
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: path.resolve(__dirname, '..'),
  },
};

export default nextConfig;
