// Web Push endpoints come from the browser's push service, not from arbitrary
// application servers. Trust only these provider-controlled HTTPS hostnames;
// arbitrary DNS names and all IP literals therefore never reach server fetch.
// Apple: developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
// Mozilla: mozilla-services.github.io/autopush-rs/http.html
const exactProviderHosts = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'updates-push.services.mozaws.net',
]);
const providerHostSuffixes = ['.push.apple.com', '.notify.windows.com'];

export function isAllowedWebPushEndpoint(endpoint: string) {
  if (!endpoint || endpoint.length > 2048 || /[\u0000-\u0020\u007f]/.test(endpoint)) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    return exactProviderHosts.has(url.hostname) ||
      providerHostSuffixes.some(suffix => url.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}
