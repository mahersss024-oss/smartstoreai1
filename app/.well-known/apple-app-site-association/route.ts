import { mobileAppPackageId } from '@/lib/mobile/app-store-links';
import { noStoreHeaders } from '@/lib/api/no-store';

export const dynamic = 'force-dynamic';

/** Apple's public association document uses the actual signing team and bundle. */
export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const nativeClientId = process.env.APPLE_NATIVE_CLIENT_ID?.trim();
  if (!teamId || !/^[A-Z0-9]{10}$/.test(teamId) ||
      (nativeClientId && nativeClientId !== mobileAppPackageId)) {
    return Response.json({ error: 'apple_app_association_not_configured' }, {
      status: 503, headers: noStoreHeaders,
    });
  }

  // These are the HTTPS destinations declared by the native iOS application.
  // Do not include administration, OAuth tickets, or arbitrary website paths.
  return Response.json({
    applinks: {
      details: [{
        appIDs: [`${teamId}.${mobileAppPackageId}`],
        components: [
          { '/': '/listings/*' },
          { '/': '/sellers/*' },
          { '/': '/conversations/*' },
        ],
      }],
    },
  }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
