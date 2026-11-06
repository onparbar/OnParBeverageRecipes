/** @type {import('next').NextConfig} */
const nextConfig = {
  // Verification builds use a separate output directory so they cannot
  // invalidate chunks served by a concurrently running local preview.
  distDir: process.env.ONPAR_NEXT_DIST_DIR || ".next",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // The recipe player is embedded only by this dashboard. Keep all other
        // pages protected by the default frame restrictions above.
        source: "/guided-player/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "base-uri 'self'; frame-ancestors 'self'; object-src 'none'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/dashboard.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
