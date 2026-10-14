import type { NextConfig } from "next";

const CANONICAL_ORIGIN = "https://sealed.page";

// Keep this allow-list exact: matching Vercel hosts broadly would redirect
// deployment-specific URLs away from their own origins.
const NON_CANONICAL_PRODUCTION_HOSTS = [
  "www.sealed.page",
  "address-book-umber-tau.vercel.app",
] as const;

const nextConfig: NextConfig = {
  async redirects() {
    return NON_CANONICAL_PRODUCTION_HOSTS.map((host) => ({
      source: "/:path*",
      has: [
        { type: "host" as const, value: host.replaceAll(".", "\\.") },
      ],
      // Vercel Cron treats a redirect as final, so /api/health would never run.
      missing: [{ type: "header" as const, key: "x-vercel-cron-schedule" }],
      destination: `${CANONICAL_ORIGIN}/:path*`,
      permanent: true,
    }));
  },
  async headers() {
    return [
      {
        // Token update pages must never be indexed: a crawled /u/<token>
        // URL is a live credential. (/b/[slug] is deliberately indexable —
        // the permalink is meant to be shared and is write-only.)
        source: "/u/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
