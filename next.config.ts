import type { NextConfig } from "next";

import { getSecurityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  agentRules: false,
  // Pin the Turbopack workspace root to this project directory so Next.js does
  // not infer it from an unrelated lockfile located outside the Git repository.
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
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
