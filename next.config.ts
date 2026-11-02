import type { NextConfig } from "next";

import { getSecurityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  agentRules: false,
  // Match the largest existing API contract (Hamad's eight image attachments).
  // Each route still enforces its own smaller limit against actual body bytes.
  // The default 10 MiB proxy buffer otherwise truncates valid 12 MiB uploads.
  experimental: { proxyClientMaxBodySize: 140 * 1024 * 1024 },
  // Pin the Turbopack workspace root to this project directory so Next.js does
  // not infer it from an unrelated lockfile located outside the Git repository.
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/admin/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/(.*)",
        headers: getSecurityHeaders(),
      },
      {
        // Service worker must always revalidate and never be cached by a proxy.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
