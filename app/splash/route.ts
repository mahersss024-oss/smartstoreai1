import { NextResponse } from 'next/server';

// Generates lightweight SVG splash images for iOS/Android PWA launch.
// A single route serves every device size via query params so we do not ship
// dozens of binary assets while still covering the common launch screens.
const allowedSizes = new Set([
  '750x1334',
  '828x1792',
  '1125x2436',
  '1170x2532',
  '1179x2556',
  '1242x2208',
  '1242x2688',
  '1284x2778',
  '1290x2796',
  '1536x2048',
  '1668x2388',
  '2048x2732',
]);

function parseSize(value: string | null) {
  if (!value || !allowedSizes.has(value)) {
    return { width: 1170, height: 2532 };
  }

  const [width, height] = value.split('x').map((part) => Number(part));

  return { width, height };
}

function buildSplashSvg(width: number, height: number, dark: boolean) {
  const background = dark ? '#0a111c' : '#e8edf3';
  const foreground = dark ? '#e7f1ff' : '#102036';
  const accent = dark ? '#5ac8ff' : '#3a6fb8';
  const markSize = Math.round(Math.min(width, height) * 0.18);
  const markX = Math.round((width - markSize) / 2);
  const markY = Math.round((height - markSize) / 2) - Math.round(markSize * 0.4);
  const titleSize = Math.round(markSize * 0.34);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${background}"/>
  <rect x="${markX}" y="${markY}" width="${markSize}" height="${markSize}" rx="${Math.round(markSize * 0.24)}" fill="${accent}"/>
  <text x="50%" y="${markY + markSize + titleSize * 1.6}" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="700" fill="${foreground}" text-anchor="middle">سوق حمد</text>
</svg>`;
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const { width, height } = parseSize(url.searchParams.get('size'));
  const dark = url.searchParams.get('theme') === 'dark';

  return new NextResponse(buildSplashSvg(width, height, dark), {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
