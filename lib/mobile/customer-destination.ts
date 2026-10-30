import { mobileAppGatewayUrl, mobileAppLaunchUrl } from './app-store-links';

const destinations: Record<string, string> = {
  '/': '/', '/favorites': '/favorites', '/conversations': '/messages',
  '/commissions': '/commissions', '/notifications': '/notifications',
};
export function customerAppDestination(path: string = '/') {
  let webPath = '/';
  let nativePath = '/';
  if (Object.hasOwn(destinations, path)) {
    webPath = path;
    nativePath = destinations[path];
  } else {
    const match = /^\/(listings|sellers|conversations)\/([^/?#\\]+)\/?$/.exec(path);
    if (match) {
      try {
        const id = decodeURIComponent(match[2]);
        if (id && id.length <= 512 && id !== '.' && id !== '..' &&
            !/[\u0000-\u001f\u007f/%?#\\]/.test(id)) {
          webPath = `/${match[1]}/${encodeURIComponent(id)}`;
          nativePath = webPath;
        }
      } catch { /* Malformed destinations fall back to the public gateway. */ }
    }
  }
  return {
    webPath, nativePath,
    launchUrl: nativePath === '/' ? mobileAppLaunchUrl : `smartstore://${nativePath.slice(1)}`,
    webUrl: new URL(webPath, mobileAppGatewayUrl).href,
  };
}
